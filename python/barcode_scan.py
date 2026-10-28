"""媒体里的二维码 / 条码解码与 Markdown 标注。

这里只回答两件事：这张图上有没有码、码说了什么；以及怎么把结论写回 markdown 而不
破坏它的结构。落盘与否、走哪个后端全部由 main.py 决定，本模块不参与。

zxing-cpp 是可选依赖，模块顶层不硬 import：没装扩展的机器上整个提取流程仍然要能跑，
只是少了码内容。
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

try:
    import numpy as np
except Exception:  # numpy 缺失只影响本模块，不能让 import main 的时候炸
    np = None


# 一维码 + 矩阵码的取舍：全格式 5.2MP 要 398ms，这份清单约 147ms，覆盖实际会出现的码型。
# 名字按顺序展开成 zxing 的格式对象，顺序只影响解码内部的尝试次序，不影响正确性。
BARCODE_FORMAT_NAMES = (
    "QRCode", "MicroQRCode", "RMQRCode", "DataMatrix",
    "Code128", "Code39", "Code93", "EAN13", "EAN8", "UPCA", "UPCE", "ITF", "Codabar", "DataBar",
)
BARCODE_FORMATS: list = []  # 首次解码时填充，避免顶层硬 import zxingcpp

_ZXING_UNSET = object()
_ZXING_MODULE = _ZXING_UNSET

# 小文档才值得整页渲染兜底：矢量绘制的码抽不到位图，但一页 150dpi 位图要几十毫秒
_RENDER_MAX_PAGES = 3
_RENDER_MAX_MEDIA = 3

# 行内注释的上限，超了就退到围栏代码块（长 base64 之类不能横着铺满一行）
_MAX_INLINE_CHARS = 120

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".gif"}

_OFFICE_MEDIA_PREFIX = {
    "docx": "word/media/",
    "pptx": "ppt/media/",
    "xlsx": "xl/media/",
    "xlsm": "xl/media/",
}

_TAG_RE = re.compile(r"<[^>]{0,400}>")
_XML_SLIDE_RE = re.compile(r"^ppt/slides/slide\d+\.xml$")

_LABELS = {
    "QRCode": "二维码",
    "MicroQRCode": "二维码（Micro）",
    "RMQRCode": "二维码（rMQR）",
    "DataMatrix": "Data Matrix",
}


@dataclass
class Hit:
    """单个解码命中。readable=False 时 text 恒为 None —— 解错的乱码不能当内容用。"""
    text: Optional[str]
    format_label: str
    ratio: float = 0.0
    readable: bool = True
    error: Optional[str] = None
    source: str = ""


@dataclass
class ScanResult:
    hits: list = field(default_factory=list)
    text_chars: int = 0
    media_count: int = 0
    page_count: int = 0


def _zxing():
    """惰性拿 zxingcpp 模块；导入失败只记住这一次结果，不反复试。"""
    global _ZXING_MODULE
    if _ZXING_MODULE is _ZXING_UNSET:
        try:
            import zxingcpp as module
        except Exception:
            module = None
        _ZXING_MODULE = module
    return _ZXING_MODULE


def _formats() -> list:
    global BARCODE_FORMATS
    if not BARCODE_FORMATS:
        module = _zxing()
        if module is None:
            return []
        BARCODE_FORMATS = [
            getattr(module, name)
            for name in BARCODE_FORMAT_NAMES
            if hasattr(module, name)
        ]
    return BARCODE_FORMATS


def is_available() -> bool:
    return _zxing() is not None


def _to_gray(img):
    """任何口径的图像 → 连续 uint8 灰度。灰度输入比 BGR 快约两成，这步值得做。"""
    if np is None or img is None:
        return None
    array = img if isinstance(img, np.ndarray) else np.asarray(img)
    if array.ndim == 3:
        if array.shape[2] >= 4:
            array = array[:, :, :3]
        if array.shape[2] == 3:
            # BT.601 加权。纯 numpy 算，不为一趟灰度转换引入 opencv 依赖
            weights = np.array([0.114, 0.587, 0.299], dtype=np.float32)
            array = array[:, :, :3].astype(np.float32) @ weights
    if array.dtype != np.uint8:
        array = array.astype(np.uint8)
    if array.ndim != 2:
        return None
    return np.ascontiguousarray(array)


def _format_label(fmt) -> str:
    name = getattr(fmt, "name", "") or ""
    if name in _LABELS:
        return _LABELS[name]
    pretty = str(fmt or "").strip() or "未知格式"
    return f"条码 {pretty}"


def _error_text(result) -> str:
    """把 zxing 的 Error 对象压成短名：'ChecksumError @ QRDecoder.cpp:337' → 'ChecksumError'。"""
    error = getattr(result, "error", None)
    if error is None:
        return ""
    try:
        raw = str(error)
    except Exception:
        return "UnknownError"
    head = raw.split("@")[0].strip()
    return head or "UnknownError"


def _polygon_ratio(position, area: float) -> float:
    """四角点围出的面积占整图的比例。用鞋带公式，结果与 cv2.contourArea 一致但不用装 opencv。"""
    if not area:
        return 0.0
    points = []
    for attr in ("top_left", "top_right", "bottom_right", "bottom_left"):
        point = getattr(position, attr, None)
        if point is None:
            return 0.0
        points.append((float(point.x), float(point.y)))
    total = 0.0
    for index in range(4):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % 4]
        total += x1 * y2 - x2 * y1
    ratio = abs(total) / 2.0 / area
    return min(1.0, ratio)


def decode_array(img) -> list[Hit]:
    """解码一张已载入内存的图像（BGR / RGB / 灰度 numpy 都可）。"""
    module = _zxing()
    gray = _to_gray(img)
    if module is None or gray is None or gray.size == 0:
        return []
    try:
        # return_errors=True 才能拿到「有码但解不出」的信号；默认实现会直接吞成空列表
        results = module.read_barcodes(gray, _formats(), return_errors=True)
    except Exception:
        return []

    height, width = gray.shape[:2]
    area = float(height * width)
    hits: list[Hit] = []
    for result in results or []:
        label = _format_label(getattr(result, "format", None))
        ratio = _polygon_ratio(getattr(result, "position", None), area)
        text = getattr(result, "text", None)
        if getattr(result, "valid", False) and isinstance(text, str) and text.strip():
            hits.append(Hit(text=text.strip(), format_label=label, ratio=ratio))
            continue
        if getattr(result, "valid", False):
            # 解出来了但内容为空：没有可用信息，不记账
            continue
        error = _error_text(result)
        if error:
            # text 保留 None —— 解码失败时 zxing 给的 text 是解错的乱码
            hits.append(
                Hit(text=None, format_label=label, ratio=ratio, readable=False, error=error)
            )
    return hits


def decode_bytes(data: bytes) -> list[Hit]:
    if not data:
        return []
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            gray = np.asarray(image.convert("L")) if np is not None else None
    except Exception:
        return []
    if gray is None:
        return []
    return decode_array(gray)


def decode_path(path: str) -> list[Hit]:
    """按字节读盘再交给 PIL：Windows 下中文路径走 cv2.imread 会直接读不到。"""
    if not path:
        return []
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return []
    return decode_bytes(data)


def scan_image_file(path: str) -> ScanResult:
    source = Path(path).name
    hits = decode_path(path)
    for hit in hits:
        hit.source = source
    return ScanResult(hits=hits, text_chars=0, media_count=1, page_count=1)


def _page_pixmap_array(page):
    """整页渲染成灰度/三通道数组，供矢量绘制码兜底识别。"""
    if np is None:
        return None
    try:
        pixmap = page.get_pixmap(dpi=150)
        buffer = np.frombuffer(pixmap.samples, dtype=np.uint8)
        if pixmap.n == 1:
            return buffer.reshape(pixmap.height, pixmap.width)
        return buffer.reshape(pixmap.height, pixmap.width, pixmap.n)[:, :, :3]
    except Exception:
        return None


def scan_pdf(path: str, max_pages: Optional[int] = None) -> ScanResult:
    """扫 PDF：优先解内嵌位图，小文档再整页渲染兜底（矢量码只能靠渲染拿到像素）。"""
    try:
        import fitz
    except Exception:
        return ScanResult()
    try:
        doc = fitz.open(path)
    except Exception:
        return ScanResult()

    hits: list[Hit] = []
    text_chars = 0
    media_count = 0
    page_count = doc.page_count
    try:
        limit = page_count if max_pages is None else min(page_count, max_pages)
        pages: list[tuple[int, object, list[int]]] = []
        for index in range(limit):
            page = doc[index]
            text_chars += len((page.get_text() or "").strip())
            xrefs: list[int] = []
            seen: set[int] = set()
            for info in page.get_image_info(xrefs=True):
                xref = int(info.get("xref") or 0)
                # xref<=0 是 inline image，PyMuPDF 不暴露原始字节
                if xref > 0 and xref not in seen:
                    seen.add(xref)
                    xrefs.append(xref)
            media_count += len(xrefs)
            pages.append((index, page, xrefs))

        for index, _page, xrefs in pages:
            page_label = f"第 {index + 1} 页"
            for xref in xrefs:
                try:
                    payload = doc.extract_image(xref).get("image") or b""
                except Exception:
                    continue
                for hit in decode_bytes(payload):
                    hit.source = page_label
                    hits.append(hit)

        if page_count <= _RENDER_MAX_PAGES and media_count <= _RENDER_MAX_MEDIA:
            for index, page, _xrefs in pages:
                page_label = f"第 {index + 1} 页"
                for hit in decode_array(_page_pixmap_array(page)):
                    hit.source = page_label
                    hits.append(hit)
    finally:
        try:
            doc.close()
        except Exception:
            pass

    return ScanResult(
        hits=hits,
        text_chars=text_chars,
        media_count=media_count,
        page_count=page_count,
    )


def _is_image_member(name: str) -> bool:
    return Path(name).suffix.lower() in _IMAGE_SUFFIXES


def _xml_text_chars(raw: bytes) -> int:
    """粗估正文长度：去掉标签后数非空白字符。

    直接数原始字节会把 XML 标签算成正文，任何 docx 都能轻易过 20 字符这条线，
    免落盘的短路对 Office 就永远失效了。
    """
    try:
        text = raw.decode("utf-8", "ignore")
    except Exception:
        return 0
    return len(re.sub(r"\s+", "", _TAG_RE.sub("", text)))


def scan_office(path: str, ext: str) -> ScanResult:
    """把 OOXML 当 zip 读，只解 media 目录下的位图，正文长度按 XML 粗估。"""
    suffix = (ext or Path(path).suffix).lower().lstrip(".")
    prefix = _OFFICE_MEDIA_PREFIX.get(suffix)
    if not prefix:
        return ScanResult()

    hits: list[Hit] = []
    media_count = 0
    text_chars = 0
    try:
        with zipfile.ZipFile(path) as archive:
            for member in archive.namelist():
                if member.startswith(prefix) and not member.endswith("/") and _is_image_member(member):
                    media_count += 1
                    try:
                        payload = archive.read(member)
                    except Exception:
                        continue
                    for hit in decode_bytes(payload):
                        hit.source = member.rsplit("/", 1)[-1]
                        hits.append(hit)

            for member in archive.namelist():
                if _office_text_member(suffix, member):
                    try:
                        text_chars += _xml_text_chars(archive.read(member))
                    except Exception:
                        continue
    except (zipfile.BadZipFile, OSError):
        return ScanResult()

    return ScanResult(hits=hits, text_chars=text_chars, media_count=media_count, page_count=0)


def _office_text_member(ext: str, member: str) -> bool:
    if ext == "docx":
        return member == "word/document.xml"
    if ext == "pptx":
        return bool(_XML_SLIDE_RE.match(member))
    if ext in ("xlsx", "xlsm"):
        return member == "xl/sharedStrings.xml"
    return False


def dedupe(hits: Iterable[Hit]) -> list[dict]:
    """按内容合并命中，保留首次出现顺序；不可读的条目单独按 (error, source) 合并。"""
    entries: list[dict] = []
    readable_index: dict[str, dict] = {}
    unreadable_index: dict[tuple, dict] = {}

    for hit in hits or []:
        source = hit.source or ""
        if hit.readable and hit.text and hit.text.strip():
            text = hit.text.strip()
            entry = readable_index.get(text)
            if entry is None:
                entry = {"text": text, "format_label": hit.format_label, "count": 0, "sources": []}
                readable_index[text] = entry
                entries.append(entry)
        elif not hit.readable:
            key = (hit.error or "", source)
            entry = unreadable_index.get(key)
            if entry is None:
                entry = {
                    "text": None,
                    "format_label": hit.format_label,
                    "count": 0,
                    "sources": [],
                    "error": hit.error,
                }
                unreadable_index[key] = entry
                entries.append(entry)
        else:
            continue
        entry["count"] += 1
        if source and source not in entry["sources"]:
            entry["sources"].append(source)

    return entries


def _escape_inline(text: str) -> str:
    """行内安全化。`|` 会撑破表格，`[`/`]` 能伪造链接，`<`/`>` 能注入 HTML 标签。"""
    escaped = text.replace("\\", "\\\\")
    for char in ("|", "[", "]", "<", ">"):
        escaped = escaped.replace(char, "\\" + char)
    return escaped


def code_lines(text: str) -> list[str]:
    """把码内容渲染成若干行：能安全放进行内就一行，否则退回 ```text 围栏。

    内容来自外部，不知道会是什么——长 base64、带换行的 WIFI 串、带反引号的东西都见过，
    直接拼进行内语法必然把文档结构搞坏。
    """
    value = "" if text is None else str(text)
    if "\n" in value or "\r" in value or "`" in value or len(value) > _MAX_INLINE_CHARS:
        body = value.splitlines() or [""]
        return ["```text", *body, "```"]
    return [_escape_inline(value)]


def _annotation_block(hits: list, seen_texts: set) -> list[str]:
    """一张媒体的注释块。已出现过的内容只写「同上」，不重复铺内容。"""
    fresh: list[tuple[str, str]] = []
    unreadable: list[tuple[str, str]] = []
    repeated: list[str] = []

    for hit in hits or []:
        text = (hit.text or "").strip() if hit.readable else ""
        if text:
            if text in seen_texts:
                repeated.append(hit.format_label)
                continue
            seen_texts.add(text)
            fresh.append((hit.format_label, text))
        elif not hit.readable:
            unreadable.append((hit.format_label, hit.error or "未知错误"))

    if not fresh and not unreadable:
        if repeated:
            return [f"> {repeated[0]}：同上"]
        return []

    items: list[tuple[str, list[str]]] = []
    for label, text in fresh:
        items.append((label, code_lines(text)))
    for label, error in unreadable:
        items.append((label, [f"无法解码（{_escape_inline(error)}）"]))
    if repeated:
        items.append((repeated[0], ["同上"]))

    if len(items) == 1:
        label, body = items[0]
        if len(body) == 1:
            return [f"> {label}：{body[0]}"]
        # 围栏块每一行都要带引用前缀，否则代码块会掉到引用外面
        return [f"> {label}：", *[f"> {line}" for line in body]]

    labels = {label for label, _body in items}
    head_label = items[0][0] if len(labels) == 1 else "码"
    block = [f"> {head_label}（{len(items)} 个）："]
    for index, (label, body) in enumerate(items, start=1):
        if len(body) == 1:
            block.append(f"> {index}. {body[0]}")
        else:
            block.append(f"> {index}. {label}：")
            block.extend(f">    {line}" for line in body)
    return block


def annotate_markdown(markdown: str, per_media: dict, seen_texts: set) -> str:
    """把每张媒体的码内容插到引用它的那一行下面。

    用 basename 匹配：调用方在媒体路径重写之后才调这里，此时 markdown 里的引用已经是
    `{stem}_media/<basename>`，和 per_media 的键天然对得上。
    seen_texts 会被就地更新，调用方传同一个集合就能跨媒体做「同上」。
    """
    if not markdown or not per_media:
        return markdown

    seen = seen_texts if isinstance(seen_texts, set) else set()
    lines = markdown.split("\n")
    out: list[str] = []
    for line in lines:
        out.append(line)
        for name, hits in per_media.items():
            if name and name in line:
                out.extend(_annotation_block(hits, seen))
    return "\n".join(out)
