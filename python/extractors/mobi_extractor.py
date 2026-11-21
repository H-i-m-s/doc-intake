"""MOBI / AZW / AZW3 / PRC 提取器（可选依赖 `mobi`）

这四种扩展名是同一族东西：PalmDB 容器 + PalmDOC / HUFF-CDIC 压缩，外加 MOBI/KF8 那套
包结构。纯手写解码不现实，所以解包交给 PyPI 上的 `mobi`（KindleUnpack 的库化封装，
纯 Python）。它是 GPL-3.0：不 vendor、不打进发布包，只当可选依赖，由用户在设置页
一键装进自己的环境——分发包里因此不含 GPL 代码。没装依赖时这里抛的是可读的安装指引，
不是 ImportError 原文。

两道门槛在调用任何库之前，都只看 PDB 头周围那几十个字节：

  1. type/creator 在文件偏移 `0x3C` 起的 8 字节，Kindle 家族是 `BOOK` + `MOBI`。不是就报
     「这不是 Kindle 电子书」，不让它掉进解包失败的黑箱。
  2. encryption type 在 **record 0 的 PalmDOC 头里**，偏移 `0x0C`（两字节大端）。这里不是
     文件偏移 `0x0C`——那是数据库名字段的中间（这个名字最长 32 字节，本样本那里正好是
     名字里的 `42`）。要先从记录表（`0x4C` 是记录数，随后每条 8 字节，头 4 字节是大端
     偏移）取出 record 0 的起始位置，再加上 `0x0C` 去读。非 0 就是 DRM：直接失败、不解密、
     也不把文件交给库去试——库对 DRM 书只会吐一堆看不懂的解压错误，把「有保护」伪装成
     「文件损坏」。

解出来可能是三种东西，各走各的路：

  - `.epub`（KF8 / AZW3）：整份交给 `EpubExtractor`，章节、媒体、目录都按 EPUB 那套走；
  - `.html`（MOBI7 / PalmDOC）：库只合成一份 `book.html`，自己走 `html_to_markdown`，
    图片按相对路径从临时目录取字节、换成占位符、进 mediaMap；
  - `.pdf`（Print Replica）：里面是原始 PDF，这里不做提取，让人先用 Calibre 之类取出来。

解出来的文件会重命名成 `{原文件 stem}{扩展名}`。EPUB 提取器与这边都按 `path.stem` 给
`{stem}_media` 命名，不改名的话媒体目录会跟着库的临时文件名走（`book_media/`），跟
原书对不上，正文引用和落盘文件名也会错位。
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .epub_extractor import EpubExtractor
from ._media_placeholders import (
    MAX_MEDIA_BYTES,
    MediaPlaceholders,
    build_media_map,
    drop_unresolved_media,
    write_media_bytes,
)
from ._utils import ExtractedMedia, classify_media

# PalmDB 头 78 字节：名字(32) 属性(2) 版本(2) 三个时间戳(12) 修改号(4)
# 应用信息(4) 排序信息(4) type(4) creator(4) uniqueIDseed(4) nextRecordList(4) 记录数(2)。
# 记录数后面紧跟记录表，每条 8 字节：偏移(4，大端) 属性(1) uniqueID(3)。
PDB_HEADER_BYTES = 78
PDB_RECORD_COUNT_OFFSET = 0x4C
PDB_RECORD_ENTRY_BYTES = 8
TYPE_CREATOR_OFFSET = 0x3C
# PalmDOC 头：压缩方式(2) 未用(2) 正文长度(4) 记录数(2) 记录大小(2) encryption(2)。
# 这 16 字节在 record 0 的最前面，所以 encryption 是 record0 + 0x0C，不是文件 0x0C。
PALMDOC_ENCRYPTION_OFFSET = 0x0C
PALMDOC_HEADER_BYTES = 16
PDB_TYPE_BOOK = b"BOOK"
PDB_CREATOR_MOBI = b"MOBI"

# 单文件 500 MB：再大的 MOBI 几乎都是内嵌整套扫描图的 Print Replica，
# 解到内存里就是把宿主拖垮。
MAX_SOURCE_BYTES = 500 * 1024 * 1024

MISSING_DEP_MESSAGE = (
    "解析 MOBI/AZW3 需要可选依赖 `mobi`（GPL-3.0，插件不打包它）。"
    "到「设置 → 应用 → Doc Intake → 环境依赖」点一键安装，"
    "或在你的 Python 环境里执行 `pip install mobi`。"
)

_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_SRC_ATTR_RE = re.compile(r"\bsrc\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.IGNORECASE)
_ATTR_RE_CACHE: dict[str, re.Pattern[str]] = {}

DC_NAMESPACE = "http://purl.org/dc/elements/1.1/"


class MobiError(RuntimeError):
    """MOBI 读不成时抛这个：main.py 会把它折进结构化错误，不会吐 traceback。"""


def _collapse(text: str) -> str:
    return " ".join((text or "").split())


def _attr_text(markup: str, name: str) -> str:
    """从一个标签片段里取属性值（大小写不敏感，引号可有可无）。"""
    pattern = _ATTR_RE_CACHE.get(name)
    if pattern is None:
        pattern = re.compile(
            rf"\b{re.escape(name)}\s*=\s*(\"([^\"]*)\"|'([^']*)'|([^\s>]+))",
            re.IGNORECASE,
        )
        _ATTR_RE_CACHE[name] = pattern
    match = pattern.search(markup)
    if not match:
        return ""
    return (match.group(2) or match.group(3) or match.group(4) or "").strip()


def _convert_output_text(convert_result) -> str:
    """html_to_markdown 的返回体在不同版本里是对象 / dict / str，统一取正文。"""
    if hasattr(convert_result, "content"):
        return convert_result.content
    if isinstance(convert_result, dict):
        return convert_result.get("content", "")
    if isinstance(convert_result, str):
        return convert_result
    return str(convert_result)


def _ensure_size_within_limit(size: int, display: str) -> None:
    """500 MB 门槛。单独成一个函数，是为了能在自测里塞一个假 size，不用真造大文件。"""
    if size > MAX_SOURCE_BYTES:
        raise MobiError(
            f"《{display}》有 {size / (1024 * 1024):.0f} MB，"
            f"超过单文件 {MAX_SOURCE_BYTES // (1024 * 1024)} MB 上限，没有解析"
        )


def _read_type_creator(path: Path) -> bytes:
    """文件偏移 0x3C 起的 8 字节 type/creator。"""
    with open(path, "rb") as handle:
        head = handle.read(PDB_HEADER_BYTES)
    if len(head) < PDB_HEADER_BYTES:
        raise MobiError(
            f"《{path.name}》只有 {len(head)} 字节，连 PalmDB 头都不够，不是 Kindle 电子书"
        )
    return head[TYPE_CREATOR_OFFSET:TYPE_CREATOR_OFFSET + 8]


def _read_encryption(path: Path) -> int:
    """record 0 的 PalmDOC 头里那个 encryption type（两字节大端）。"""
    with open(path, "rb") as handle:
        head = handle.read(PDB_HEADER_BYTES)
        if len(head) < PDB_HEADER_BYTES:
            raise MobiError(
                f"《{path.name}》只有 {len(head)} 字节，连 PalmDB 头都不够，不是 Kindle 电子书"
            )
        record_count = int.from_bytes(
            head[PDB_RECORD_COUNT_OFFSET:PDB_RECORD_COUNT_OFFSET + 2], "big"
        )
        if record_count < 1:
            raise MobiError(f"《{path.name}》的 PalmDB 记录表是空的，不是完整的 Kindle 电子书")
        entry = handle.read(PDB_RECORD_ENTRY_BYTES)
        if len(entry) < PDB_RECORD_ENTRY_BYTES:
            raise MobiError(f"《{path.name}》的 PalmDB 记录表被截断了，不是完整的 Kindle 电子书")
        record0 = int.from_bytes(entry[:4], "big")
        size = os.fstat(handle.fileno()).st_size
        if record0 < PDB_HEADER_BYTES or record0 + PALMDOC_HEADER_BYTES > size:
            raise MobiError(
                f"《{path.name}》的 PalmDB 记录表指到文件外面，不是完整的 Kindle 电子书"
            )
        handle.seek(record0 + PALMDOC_ENCRYPTION_OFFSET)
        raw = handle.read(2)
    if len(raw) < 2:
        raise MobiError(f"《{path.name}》读不到 PalmDOC 头，不是完整的 Kindle 电子书")
    return int.from_bytes(raw, "big")


def _check_kindle_type(type_creator: bytes, display: str) -> None:
    """第一道门：不是 BOOK/MOBI 就不是 Kindle 电子书。"""
    if type_creator[:4] != PDB_TYPE_BOOK or type_creator[4:] != PDB_CREATOR_MOBI:
        printable = type_creator.decode("ascii", "replace").strip("\x00 ") or "空"
        raise MobiError(
            f"这不是 Kindle 电子书（PalmDB 头里的 type/creator 是 {printable}）"
        )


def _check_no_drm(encryption: int, display: str) -> None:
    """第二道门：encryption 非 0 就是 DRM。不解密，只把「为什么读不了」说清楚。"""
    if encryption != 0:
        raise MobiError(f"《{display}》有 DRM 保护（encryption type {encryption}），无法解析")


def _import_mobi():
    """延迟 import：没装依赖的环境里整个包还得能起来，只有真解析 Kindle 时才碰它。"""
    try:
        import mobi
    except ImportError as exc:
        raise MobiError(MISSING_DEP_MESSAGE) from exc
    return mobi


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def _read_opf_metadata(opf_path: Path) -> dict:
    """读 mobi7 那份 content.opf 的 dc:title / dc:creator / dc:language。

    读不出来就当没有：元数据缺了不该挡住正文，标题还有 html 的 <title> 与文件名兜底。
    """
    info: dict = {"title": "", "creators": [], "language": ""}
    try:
        root = ET.fromstring(opf_path.read_text(encoding="utf-8", errors="replace"))
    except (ET.ParseError, OSError, ValueError):
        return info

    prefix = "{%s}" % DC_NAMESPACE
    for element in root.iter():
        tag = element.tag
        if not isinstance(tag, str) or not tag.startswith(prefix):
            continue
        name = tag[len(prefix):]
        text = _collapse("".join(element.itertext()))
        if not text:
            continue
        if name == "title" and not info["title"]:
            info["title"] = text
        elif name == "creator":
            info["creators"].append(text)
        elif name == "language" and not info["language"]:
            info["language"] = text
    return info


def _count_nav_points(ncx_path: Path) -> int:
    try:
        root = ET.fromstring(ncx_path.read_text(encoding="utf-8", errors="replace"))
    except (ET.ParseError, OSError, ValueError):
        return 0
    return sum(
        1 for element in root.iter()
        if isinstance(element.tag, str) and element.tag.split("}")[-1] == "navPoint"
    )


def _is_inside(candidate: str, directory: str) -> bool:
    """解出来的 html 是不可信内容：相对路径不许指到临时目录外面去。"""
    try:
        return os.path.commonpath([os.path.abspath(candidate), os.path.abspath(directory)]) == os.path.abspath(directory)
    except ValueError:  # 跨盘符时 commonpath 直接抛，那就是不在一起
        return False


class MobiExtractor(BaseExtractor):
    """MOBI/AZW/AZW3/PRC 提取器：解包成 epub 或 html，再交给现成的路走。"""

    name = "mobi"

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        path = self._check_file_exists(source)
        stem = path.stem

        # 顺序是硬性的：先看头（大小 -> type/creator -> DRM），再谈依赖与解包。
        # 头里能判死的错误不该走到 import 那一步，更不该让库去试。
        _ensure_size_within_limit(path.stat().st_size, path.name)
        _check_kindle_type(_read_type_creator(path), path.name)
        _check_no_drm(_read_encryption(path), path.name)

        mobi_module = _import_mobi()

        tempdir = ""
        container = ""
        try:
            tempdir, unpacked, container = self._unpack(mobi_module, path, stem)

            if container == "epub":
                result = EpubExtractor(self.settings).extract(
                    unpacked,
                    output_dir=output_dir,
                    include_images=include_images,
                )
            elif container in ("html", "htm"):
                result = ExtractionResult()
                self._extract_html(
                    Path(unpacked), tempdir, stem, output_dir, include_images, result
                )
            elif container == "pdf":
                raise MobiError(
                    f"《{path.name}》是 Print Replica 版（书里装的是原始 PDF），这里不做提取："
                    "请先用 Calibre 之类把里面的 PDF 取出来，再当 PDF 提取"
                )
            else:
                raise MobiError(
                    f"《{path.name}》解出来的东西是 {container or '未知类型'}，这条提取路不支持"
                )
        finally:
            if tempdir:
                shutil.rmtree(tempdir, ignore_errors=True)

        result.metadata = result.metadata or {}
        result.metadata["format"] = "mobi"
        result.metadata["reader"] = "mobi-local"
        # 记一笔「它是被解成什么之后转出来的」：同一个 .mobi，KF8 与 MOBI7 走的完全是两条路。
        result.metadata["containerFormat"] = container
        return result

    # ── 解包与改名 ──────────────────────────────────────────────────────

    def _unpack(self, mobi_module, path: Path, stem: str) -> tuple[str, str, str]:
        """返回 (临时目录, 解出来的文件, 容器格式)。失败时自己先把临时目录清掉。"""
        tempdir = ""
        try:
            try:
                tempdir, unpacked = mobi_module.extract(str(path))
            except Exception as exc:
                # 库的异常类型很杂（UnicodeDecodeError、struct.error、自家异常都有），
                # 一律包成一句人话，别让 traceback 冒到 stdout。
                raise MobiError(f"这个文件解不开：{exc}") from exc

            if not tempdir or not os.path.isdir(tempdir):
                raise MobiError("这个文件解不开：解包没有给出临时目录")
            if not unpacked or not os.path.isfile(unpacked):
                raise MobiError("这个文件解不开：解出来的结果里没有可读的文件")

            suffix = os.path.splitext(unpacked)[1].lower()
            # 改成原书的名字，解出来的 epub/html 里的媒体目录才会是 {stem}_media。
            target = os.path.join(os.path.dirname(unpacked), f"{stem}{suffix}")
            if os.path.abspath(target) != os.path.abspath(unpacked):
                os.replace(unpacked, target)
                unpacked = target
            return tempdir, unpacked, suffix.lstrip(".")
        except BaseException:
            if tempdir:
                shutil.rmtree(tempdir, ignore_errors=True)
            raise

    # ── MOBI7：一份合并好的 html ────────────────────────────────────────

    def _extract_html(
        self,
        html_path: Path,
        tempdir: str,
        stem: str,
        output_dir: Optional[str],
        include_images: bool,
        result: ExtractionResult,
    ) -> None:
        text = _read_text(html_path)
        base_dir = html_path.parent

        media = MediaPlaceholders()
        extracted: list[ExtractedMedia] = []
        written: dict[str, str] = {}
        counter = 0

        def resolve(src: str) -> Optional[str]:
            """返回占位符；'' 表示这条引用要删掉；None 表示原样保留（外链 / data URL）。"""
            nonlocal counter
            if not src or src.startswith(
                ("data:", "http://", "https://", "//", "mailto:", "#")
            ):
                return None
            raw = unquote(src.split("#", 1)[0]).replace("\\", "/").strip()
            if not raw:
                return None
            candidate = os.path.normpath(os.path.join(str(base_dir), raw))
            if candidate in written:
                return written[candidate]
            if not _is_inside(candidate, tempdir):
                result.warnings.append(f"正文引用的图片指到临时目录外面了，已跳过：{src}")
                return ""
            if not os.path.isfile(candidate):
                result.warnings.append(f"正文引用的图片解出来找不到：{src}")
                return ""
            ext = os.path.splitext(candidate)[1].lower()
            if not ext or classify_media(ext) != "image":
                result.warnings.append(f"认不出这是什么媒体，已跳过：{src}")
                return ""
            try:
                data = Path(candidate).read_bytes()
            except OSError as exc:
                result.warnings.append(f"图片读不出来（{exc}），已跳过：{src}")
                return ""
            if len(data) > MAX_MEDIA_BYTES:
                result.warnings.append(
                    f"{raw} 有 {len(data)} 字节，超过单张 {MAX_MEDIA_BYTES // (1024 * 1024)} MB 上限，已跳过"
                )
                return ""
            counter += 1
            extracted.append(write_media_bytes(
                data,
                ext,
                original_path=candidate,
                output_dir=output_dir,
                stem=stem,
                counter=counter,
            ))
            placeholder = media.placeholder_for(candidate)
            written[candidate] = placeholder
            return placeholder

        def image_replacement(match: re.Match[str]) -> str:
            tag = match.group(0)
            src = _attr_text(tag, "src")
            if not src:
                return tag
            placeholder = resolve(src) if include_images else ""
            if placeholder is None:
                return tag
            if not placeholder:
                return ""
            return _SRC_ATTR_RE.sub(f'src="{placeholder}"', tag, count=1)

        prepared = _IMG_TAG_RE.sub(image_replacement, text)

        try:
            from html_to_markdown import ConversionOptions, convert
        except ImportError as exc:
            raise MobiError("需要安装 html-to-markdown: pip install html-to-markdown") from exc

        options = ConversionOptions(
            heading_style="ATX",
            extract_metadata=False,
            skip_images=not include_images,
        )
        try:
            markdown = _convert_output_text(convert(prepared, options))
        except Exception as exc:
            raise MobiError(f"这个文件解不开：正文转换失败（{exc}）") from exc

        media_map = build_media_map(extracted, media)
        markdown = drop_unresolved_media(markdown, media, media_map)
        markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()

        info = _read_opf_metadata(base_dir / "content.opf")
        html_title = _TITLE_RE.search(text)
        title = info["title"] or _collapse(html_title.group(1) if html_title else "") or stem
        # MOBI7 只有一份 html，`book.html` 本身就是整本书：章节数只能按 toc.ncx 的
        # navPoint 估，一个都没有就记 1（整份文档算一章），记 0 会让人以为没读出来。
        chapters = max(_count_nav_points(base_dir / "toc.ncx"), 1)

        result.markdown = markdown + "\n" if markdown else ""
        result.images = [item.local_path for item in extracted]
        result.metadata = {
            "format": "mobi",
            "reader": "mobi-local",
            "title": title,
            "author": "、".join(info["creators"]),
            "language": info["language"],
            "chapterCount": chapters,
            "mediaMap": media_map,
        }
