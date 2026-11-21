"""EPUB 提取器（纯标准库，不引第三方包）

结构：`zipfile` 打开，`ElementTree` 只读 XML 那几份（container.xml / OPF /
encryption.xml / nav / ncx）；正文 XHTML 先用正则做一遍「转换前整形」，再交给
`html_to_markdown`。正文不用 ElementTree 的原因：EPUB 里的 XHTML 常带 HTML 实体、
未闭合标签、DTD 内部子集，ElementTree 遇到就抛 ParseError，而且序列化回去会加
`ns0:` 前缀，html5 解析器认不出这些前缀。

整形只做五件事：
  1. 图片 URL 换成唯一占位符 `docintake-media-N`（不含点、不含斜杠，不会被当成
     相对路径），真正的 zip 路径放进 metadata["mediaMap"]，由 main.py 的
     save_result 改写成 `{stem}_media/xxx.ext` —— 正文里因此不会残留 `OEBPS/`、
     `../`、`docintake-media-` 这类字样；
  2. `<svg>` 整块拆掉：包内 SVG 常是「一张图套一层 SVG」，直接把内层图片当引用，
     否则转换器会把整段 SVG 序列化成 base64 data URL 塞进正文；
  3. `<table>` 换成占位 token，转换完再贴回 `_utils.markdown_table` 的产物，
     colspan/rowspan 这类转换器会揉成歪表格的情况由我们自己兜住；
  4. `<ruby>` 注音：保留汉字，注音用全角括号跟在后面（丢了注音会丢读音，
     保留 `<ruby>` 又会被转换器吐成裸标签）；
  5. 包内跳转的 `<a>`（脚注 noteref、章节互链）摊平成纯文字：正文里不该出现
     `#n1`、`../text/x.xhtml` 这种既点不动又带包内路径的碎片。
"""
from __future__ import annotations

import posixpath
import re
import zipfile
from typing import Optional
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .emf_converter import extract_and_convert_media
from ._utils import markdown_table
from logger import get_logger

logger = get_logger("epub_extractor")

CONTAINER_PATH = "META-INF/container.xml"
ENCRYPTION_PATH = "META-INF/encryption.xml"
OPF_MEDIA_TYPE = "application/oebps-package+xml"
CONTENT_MEDIA_TYPES = {"application/xhtml+xml", "text/html"}

DC_NS = "http://purl.org/dc/elements/1.1/"
OPS_NS = "http://www.idpf.org/2007/ops"
_OPS_TYPE = "{%s}type" % OPS_NS

# 字体混淆（不是 DRM）：我们不需要字体，照常解析。
FONT_OBFUSCATION_ALGORITHMS = {
    "http://www.idpf.org/2008/embedding",   # IDPF
    "http://ns.adobe.com/pdf/enc#RC",       # Adobe
}

# zip bomb 的两道门槛：单条目解压后 200 MB、单章 20 MB。
MAX_ENTRY_BYTES = 200 * 1024 * 1024
MAX_CHAPTER_BYTES = 20 * 1024 * 1024

MEDIA_PLACEHOLDER_PREFIX = "docintake-media-"

_XML_DECL_RE = re.compile(r"<\?xml[^>]*\?>", re.IGNORECASE)
_DOCTYPE_RE = re.compile(r"<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*>", re.IGNORECASE)
_HEAD_RE = re.compile(r"<head\b[^>]*>[\s\S]*?</head>", re.IGNORECASE)
_STYLE_RE = re.compile(r"<style\b[^>]*>[\s\S]*?</style>", re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script\b[^>]*>[\s\S]*?</script>", re.IGNORECASE)
_HEADING_TAG_RE = re.compile(r"<h[1-6][\s>]", re.IGNORECASE)

_SVG_RE = re.compile(r"<svg\b[^>]*>[\s\S]*?</svg>", re.IGNORECASE)
_SVG_HREF_RE = re.compile(r"\b(?:xlink:)?href\s*=\s*[\"']([^\"']*)[\"']", re.IGNORECASE)
_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_SRC_ATTR_RE = re.compile(r"\bsrc\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)
_ATTR_RE_CACHE: dict[str, re.Pattern[str]] = {}

_TABLE_RE = re.compile(r"<table\b[^>]*>[\s\S]*?</table>", re.IGNORECASE)
_TR_RE = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
_CELL_RE = re.compile(r"<t[hd]\b[^>]*>([\s\S]*?)</t[hd]>", re.IGNORECASE)
_BR_RE = re.compile(r"<br\b[^>]*>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")

_RUBY_RE = re.compile(r"<ruby\b[^>]*>([\s\S]*?)</ruby>", re.IGNORECASE)
_RT_RE = re.compile(r"<rt\b[^>]*>([\s\S]*?)</rt>", re.IGNORECASE)
_RP_RE = re.compile(r"<rp\b[^>]*>[\s\S]*?</rp>", re.IGNORECASE)

_ANCHOR_RE = re.compile(r"<a\b([^>]*)>([\s\S]*?)</a>", re.IGNORECASE)
_EXTERNAL_HREF_PREFIXES = ("http://", "https://", "mailto:")


class EpubError(RuntimeError):
    """EPUB 无法解析时抛这个：main.py 会把它折进结构化错误，不会吐 traceback。"""


def _split_tag(tag: str) -> tuple[str, str]:
    """把 `{uri}local` 拆成 (uri, local)；没有命名空间时 uri 为空。"""
    if tag.startswith("{"):
        uri, _, local = tag[1:].partition("}")
        return uri, local
    return "", tag


def _local(tag: str) -> str:
    return _split_tag(tag)[1]


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


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _ruby_replacement(match: re.Match[str]) -> str:
    """`漢字 + （かんじ）`：汉字留着，注音用全角括号跟在后面。"""
    inner = match.group(1)
    base = _RT_RE.sub("", inner)
    base = _RP_RE.sub("", base)
    notes = "".join(_TAG_RE.sub("", note) for note in _RT_RE.findall(inner)).strip()
    if not notes:
        return base
    return f"{base}（{notes}）"


def _cell_text(markup: str) -> str:
    """表格单元格 -> 一行文本；单元格里的图保留成 markdown 图片引用。"""

    def image_ref(tag_match: re.Match[str]) -> str:
        tag = tag_match.group(0)
        return f'![{_attr_text(tag, "alt")}]({_attr_text(tag, "src")})'

    value = _IMG_TAG_RE.sub(image_ref, markup)
    value = _BR_RE.sub(" ", value)
    value = _TAG_RE.sub("", value)
    return _collapse(value)


def _table_rows(markup: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in _TR_RE.finditer(markup):
        cells = [_cell_text(cell.group(1)) for cell in _CELL_RE.finditer(row.group(1))]
        if any(cell for cell in cells):
            rows.append(cells)
    return rows


def _convert_output_text(convert_result) -> str:
    """html_to_markdown 的返回体在不同版本里是对象 / dict / str，统一取正文。"""
    if hasattr(convert_result, "content"):
        return convert_result.content
    if isinstance(convert_result, dict):
        return convert_result.get("content", "")
    if isinstance(convert_result, str):
        return convert_result
    return str(convert_result)


class _MediaState:
    """一次提取里的占位符账本。

    同一个 zip 内路径只发一个占位符：同一张图被两处引用时复用，否则
    extract_and_convert_media 会把它解两遍、编号也翻倍。
    """

    def __init__(self) -> None:
        self.placeholder_by_path: dict[str, str] = {}
        self.path_by_placeholder: dict[str, str] = {}
        self.order: list[str] = []
        self.counter = 0

    def add_path(self, zip_path: str) -> str:
        """登记一个要解出来的媒体（不产生正文引用），返回空串。"""
        if zip_path not in self.placeholder_by_path:
            self.placeholder_by_path[zip_path] = ""
            self.order.append(zip_path)
        return ""

    def placeholder_for(self, zip_path: str) -> str:
        existing = self.placeholder_by_path.get(zip_path)
        if existing:
            return existing
        self.counter += 1
        placeholder = f"{MEDIA_PLACEHOLDER_PREFIX}{self.counter}"
        self.placeholder_by_path[zip_path] = placeholder
        self.path_by_placeholder[placeholder] = zip_path
        self.order.append(zip_path)
        return placeholder


class EpubExtractor(BaseExtractor):
    """EPUB 提取器：spine 顺序 -> 一份 Markdown，媒体落到 `{stem}_media/`。"""

    name = "epub"

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
        result = ExtractionResult()

        try:
            zf = zipfile.ZipFile(path)
        except zipfile.BadZipFile as exc:
            raise EpubError("这不是一个合法的 EPUB（文件不是有效的 zip 压缩包）") from exc

        with zf:
            names = set(zf.namelist())
            opf_path = self._locate_opf(zf, names, result)
            try:
                package = ET.fromstring(zf.read(opf_path))
            except (ET.ParseError, KeyError) as exc:
                raise EpubError(f"这不是一个合法的 EPUB（{opf_path} 读不出来）") from exc

            opf_dir = posixpath.dirname(opf_path)
            info = self._read_package_metadata(package)
            font_obfuscated = self._check_encryption(zf, names, info["title"])
            manifest = self._read_manifest(package, opf_dir, names, result)
            spine_docs = self._read_spine(package, manifest, result)
            if not spine_docs:
                raise EpubError("EPUB 的 spine 是空的")

            nav_titles = self._read_nav_titles(zf, package, manifest, names, result)

            media = _MediaState()
            blocks: list[str] = []
            if info["title"]:
                blocks.append(f"# {info['title']}")

            for doc_path in spine_docs:
                chapter, has_heading = self._convert_chapter(
                    zf, doc_path, names, media, include_images, result
                )
                if chapter is None:
                    blocks.append(f"（本章解析失败：{posixpath.basename(doc_path)}）")
                    continue
                chapter = chapter.strip()
                if not chapter:
                    continue
                nav_title = nav_titles.get(doc_path, "")
                # 只有整篇一个 h1-h6 都没有时才补目录标题，否则会跟正文标题重复一遍。
                if nav_title and not has_heading:
                    chapter = f"## {nav_title}\n\n{chapter}"
                blocks.append(chapter)

            cover_path = self._find_cover(package, manifest)
            if include_images and cover_path:
                media.add_path(cover_path)

            media_map = self._extract_media(zf, media, output_dir, stem, include_images, result)

            markdown = "\n\n".join(block for block in blocks if block.strip())
            markdown = self._drop_unresolved_media(markdown, media, media_map)
            result.markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip() + "\n"

        fixed_layout = self._is_fixed_layout(package)
        if fixed_layout:
            result.warnings.append("这是固定版式 EPUB（多为漫画/绘本），正文可能只剩图片")

        result.metadata = {
            "format": "epub",
            "reader": "epub-local",
            "title": info["title"],
            "author": "、".join(info["creators"]),
            "language": info["language"],
            "epubVersion": info["version"],
            "chapterCount": len(spine_docs),
            "fixedLayout": fixed_layout,
            "mediaMap": media_map,
        }
        for key in ("publisher", "date", "identifier", "description"):
            if info[key]:
                result.metadata[key] = info[key]
        if font_obfuscated:
            # 字体混淆不是 DRM，正文与图片都是明文；记一笔只为解释「为什么字体文件读不开」。
            result.metadata["fontObfuscated"] = True
        return result

    # ── 定位与元数据 ────────────────────────────────────────────────────

    def _locate_opf(self, zf: zipfile.ZipFile, names: set[str], result: ExtractionResult) -> str:
        """container.xml 里取 OPF；读不出来就在 zip 里按深度找 *.opf。"""
        if CONTAINER_PATH in names:
            try:
                root = ET.fromstring(zf.read(CONTAINER_PATH))
            except (ET.ParseError, KeyError):
                root = None
            if root is not None:
                fallback = ""
                for element in root.iter():
                    if _local(element.tag) != "rootfile":
                        continue
                    full_path = (element.get("full-path") or "").strip()
                    if not full_path:
                        continue
                    resolved = self._normalize_entry_path(full_path)
                    if resolved not in names:
                        continue
                    if (element.get("media-type") or "").strip() == OPF_MEDIA_TYPE:
                        return resolved
                    if not fallback:
                        fallback = resolved
                if fallback:
                    return fallback
        # 深度不超过 3 层：OPF 一定在包内浅处，深挖等于给恶意包送成本。
        candidates = sorted(
            name for name in names
            if name.lower().endswith(".opf") and name.count("/") <= 2
        )
        if candidates:
            result.warnings.append(
                f"container.xml 里定位不到 OPF，已按包内 *.opf 兜底：{candidates[0]}"
            )
            return candidates[0]
        raise EpubError("这不是一个合法的 EPUB（找不到 OPF）")

    @staticmethod
    def _normalize_entry_path(raw: str) -> str:
        return posixpath.normpath(raw.replace("\\", "/").lstrip("/"))

    def _read_package_metadata(self, package: ET.Element) -> dict:
        info = {
            "title": "",
            "creators": [],
            "language": "",
            "publisher": "",
            "date": "",
            "identifier": "",
            "description": "",
            "version": (package.get("version") or "").strip(),
        }
        for metadata in package.iter():
            if _local(metadata.tag) != "metadata":
                continue
            for child in metadata:
                namespace, tag = _split_tag(child.tag)
                # dc: 前缀可以换绑，只认命名空间 URI。
                if namespace != DC_NS:
                    continue
                text = _collapse("".join(child.itertext()))
                if not text:
                    continue
                if tag == "title" and not info["title"]:
                    info["title"] = text
                elif tag == "creator":
                    info["creators"].append(text)
                elif tag == "language" and not info["language"]:
                    info["language"] = text
                elif tag == "publisher" and not info["publisher"]:
                    info["publisher"] = text
                elif tag == "date" and not info["date"]:
                    info["date"] = text
                elif tag == "identifier" and not info["identifier"]:
                    info["identifier"] = text
                elif tag == "description" and not info["description"]:
                    info["description"] = text
            break
        return info

    def _check_encryption(self, zf: zipfile.ZipFile, names: set[str], title: str) -> bool:
        """返回是否只做了字体混淆；内容加密直接抛错。"""
        if ENCRYPTION_PATH not in names:
            return False
        try:
            root = ET.fromstring(zf.read(ENCRYPTION_PATH))
        except (ET.ParseError, KeyError):
            logger.warning("encryption.xml 读不出来，按未加密处理")
            return False

        font_obfuscated = False
        for element in root.iter():
            if _local(element.tag) != "EncryptionMethod":
                continue
            algorithm = (element.get("Algorithm") or "").strip()
            if not algorithm:
                continue
            if algorithm in FONT_OBFUSCATION_ALGORITHMS:
                font_obfuscated = True
                continue
            book = f"：《{title}》" if title else ""
            raise EpubError(f"这本书有 DRM 保护（算法 {algorithm}），无法解析{book}")
        return font_obfuscated

    @staticmethod
    def _is_fixed_layout(package: ET.Element) -> bool:
        for element in package.iter():
            if _local(element.tag) != "meta":
                continue
            if (element.get("property") or "").strip() == "rendition:layout":
                return _collapse(element.text or "").lower() == "pre-paginated"
        return False

    @staticmethod
    def _resolve_href(base_dir: str, href: str, names: set[str]) -> Optional[str]:
        """把包内相对 href 还原成 zip 条目名：解百分号编码、去锚点、跳跃 ../。"""
        if not href:
            return None
        raw = unquote(href.strip()).replace("\\", "/")
        raw = raw.split("#", 1)[0].strip()
        if not raw:
            return None
        if raw.startswith("//"):
            return None
        joined = posixpath.normpath(posixpath.join(base_dir, raw) if base_dir else raw)
        joined = joined.lstrip("/")
        # 大小写敏感：EPUB 的条目名就是路径本身，替作者猜大小写会把两个文件混成一个。
        return joined if joined in names else None

    def _read_manifest(
        self,
        package: ET.Element,
        opf_dir: str,
        names: set[str],
        result: ExtractionResult,
    ) -> dict[str, dict]:
        manifest: dict[str, dict] = {}
        for element in package.iter():
            if _local(element.tag) != "item":
                continue
            item_id = (element.get("id") or "").strip()
            href = element.get("href") or ""
            media_type = (element.get("media-type") or "").strip().lower()
            zip_path = self._resolve_href(opf_dir, href, names)
            if zip_path is None:
                # 字体/样式缺失不影响正文，只对会进正文的条目发声。
                if media_type in CONTENT_MEDIA_TYPES or media_type.startswith("image/"):
                    result.warnings.append(f"manifest 里的 {href} 在包内找不到")
                continue
            manifest[item_id] = {
                "zip_path": zip_path,
                "media_type": media_type,
                "properties": (element.get("properties") or "").strip(),
            }
        return manifest

    def _read_spine(
        self,
        package: ET.Element,
        manifest: dict[str, dict],
        result: ExtractionResult,
    ) -> list[str]:
        docs: list[str] = []
        seen: set[str] = set()
        for element in package.iter():
            if _local(element.tag) != "itemref":
                continue
            # linear="no" 是「不在阅读主线上」的辅助文档，按约定跳过。
            if (element.get("linear") or "").strip().lower() == "no":
                continue
            idref = (element.get("idref") or "").strip()
            if not idref or idref in seen:
                continue
            item = manifest.get(idref)
            if item is None:
                result.warnings.append(f"spine 里的 {idref} 在 manifest 里找不到，已跳过")
                continue
            if item["media_type"] not in CONTENT_MEDIA_TYPES:
                continue
            seen.add(idref)
            docs.append(item["zip_path"])
        return docs

    # ── 目录标题（EPUB3 nav 文档 / EPUB2 NCX）────────────────────────────

    def _read_nav_titles(
        self,
        zf: zipfile.ZipFile,
        package: ET.Element,
        manifest: dict[str, dict],
        names: set[str],
        result: ExtractionResult,
    ) -> dict[str, str]:
        titles = self._titles_from_nav(zf, manifest, names, result)
        if titles:
            return titles
        return self._titles_from_ncx(zf, package, manifest, names, result)

    def _titles_from_nav(
        self,
        zf: zipfile.ZipFile,
        manifest: dict[str, dict],
        names: set[str],
        result: ExtractionResult,
    ) -> dict[str, str]:
        nav_item = next(
            (item for item in manifest.values() if "nav" in item["properties"].split()),
            None,
        )
        if not nav_item or nav_item["zip_path"] not in names:
            return {}
        nav_path = nav_item["zip_path"]
        try:
            root = ET.fromstring(zf.read(nav_path))
        except (ET.ParseError, KeyError):
            result.warnings.append(f"目录文档 {nav_path} 读不出来，章节标题按正文标题走")
            return {}

        navs = [element for element in root.iter() if _local(element.tag) == "nav"]
        toc = next((element for element in navs if element.get(_OPS_TYPE) == "toc"), navs[0] if navs else None)
        if toc is None:
            return {}

        titles: dict[str, str] = {}
        for element in toc.iter():
            if _local(element.tag) != "a":
                continue
            target = self._resolve_href(posixpath.dirname(nav_path), element.get("href") or "", names)
            text = _collapse("".join(element.itertext()))
            if target and text and target not in titles:
                titles[target] = text
        return titles

    def _titles_from_ncx(
        self,
        zf: zipfile.ZipFile,
        package: ET.Element,
        manifest: dict[str, dict],
        names: set[str],
        result: ExtractionResult,
    ) -> dict[str, str]:
        ncx_path = ""
        for element in package.iter():
            if _local(element.tag) != "spine":
                continue
            item = manifest.get((element.get("toc") or "").strip())
            if item:
                ncx_path = item["zip_path"]
            break
        if not ncx_path:
            ncx_item = next(
                (item for item in manifest.values()
                 if item["media_type"] == "application/x-dtbncx+xml"),
                None,
            )
            ncx_path = ncx_item["zip_path"] if ncx_item else ""
        if not ncx_path or ncx_path not in names:
            return {}

        try:
            root = ET.fromstring(zf.read(ncx_path))
        except (ET.ParseError, KeyError):
            result.warnings.append(f"NCX 目录 {ncx_path} 读不出来，章节标题按正文标题走")
            return {}

        titles: dict[str, str] = {}
        for point in root.iter():
            if _local(point.tag) != "navPoint":
                continue
            src, label = "", ""
            for child in point:
                name = _local(child.tag)
                if name == "content":
                    src = child.get("src") or ""
                elif name == "navLabel":
                    label = _collapse("".join(child.itertext()))
            target = self._resolve_href(posixpath.dirname(ncx_path), src, names)
            if target and label and target not in titles:
                titles[target] = label
        return titles

    # ── 章节正文 ────────────────────────────────────────────────────────

    def _convert_chapter(
        self,
        zf: zipfile.ZipFile,
        doc_path: str,
        names: set[str],
        media: _MediaState,
        include_images: bool,
        result: ExtractionResult,
    ) -> tuple[Optional[str], bool]:
        try:
            entry = zf.getinfo(doc_path)
        except KeyError:
            result.warnings.append(f"spine 里的 {doc_path} 在包内找不到，已跳过")
            return None, False
        if entry.file_size > MAX_CHAPTER_BYTES:
            result.warnings.append(
                f"{doc_path} 解压后 {entry.file_size} 字节，超过单章上限 20 MB，已跳过"
            )
            return None, False

        html_text = self._decode(zf.read(doc_path), doc_path, result)
        has_heading = bool(_HEADING_TAG_RE.search(html_text))
        prepared, tables = self._prepare_html(
            html_text, doc_path, names, media, include_images, result
        )

        try:
            from html_to_markdown import ConversionOptions, convert
        except ImportError as exc:
            raise EpubError("需要安装 html-to-markdown: pip install html-to-markdown") from exc

        options = ConversionOptions(
            heading_style="ATX",
            extract_metadata=False,
            skip_images=not include_images,
        )
        try:
            markdown = _convert_output_text(convert(prepared, options))
        except Exception as exc:  # 单章失败不拖垮整本书
            result.warnings.append(f"{doc_path} 正文转换失败：{exc}")
            return None, has_heading

        for token, table in tables.items():
            if token in markdown:
                markdown = markdown.replace(token, f"\n\n{table}\n\n")
        return markdown, has_heading

    @staticmethod
    def _decode(raw: bytes, doc_path: str, result: ExtractionResult) -> str:
        declared = re.match(
            rb"<\?xml[^>]*?encoding\s*=\s*[\"']([A-Za-z0-9._\-]+)[\"']",
            raw[:300],
            re.IGNORECASE,
        )
        candidates: list[str] = []
        if declared:
            candidates.append(declared.group(1).decode("ascii", "ignore"))
        candidates += ["utf-8-sig", "utf-8", "gb18030"]
        for encoding in dict.fromkeys(candidates):
            try:
                return raw.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        result.warnings.append(f"{doc_path} 的编码认不出来，已用替换字符解码")
        return raw.decode("utf-8", "replace")

    def _prepare_html(
        self,
        html_text: str,
        doc_path: str,
        names: set[str],
        media: _MediaState,
        include_images: bool,
        result: ExtractionResult,
    ) -> tuple[str, dict[str, str]]:
        text = _XML_DECL_RE.sub("", html_text)
        text = _DOCTYPE_RE.sub("", text)
        text = _HEAD_RE.sub("", text)
        text = _STYLE_RE.sub("", text)
        text = _SCRIPT_RE.sub("", text)

        tables: dict[str, str] = {}
        doc_dir = posixpath.dirname(doc_path)

        def resolve_image(href: str) -> Optional[str]:
            """返回占位符；'' 表示引用不成立要删掉；None 表示原样保留。"""
            if not href or href.startswith(("data:", "http://", "https://")):
                return None
            zip_path = self._resolve_href(doc_dir, href, names)
            if zip_path is None:
                result.warnings.append(f"{doc_path} 引用的图片在包内找不到：{href}")
                return ""
            return media.placeholder_for(zip_path)

        def svg_replacement(match: re.Match[str]) -> str:
            block = match.group(0)
            if not include_images:
                return ""
            inside = _SVG_HREF_RE.search(block)
            if not inside or inside.group(1).startswith("#"):
                return ""
            placeholder = resolve_image(inside.group(1))
            if not placeholder:
                return ""
            return f'<img src="{placeholder}" alt=""/>'

        def image_replacement(match: re.Match[str]) -> str:
            tag = match.group(0)
            src = _attr_text(tag, "src")
            if not src:
                return tag
            placeholder = resolve_image(src)
            if placeholder is None:
                return tag
            if not placeholder:
                return ""
            return _SRC_ATTR_RE.sub(f'src="{placeholder}"', tag, count=1)

        def table_replacement(match: re.Match[str]) -> str:
            rows = _table_rows(match.group(0))
            if not rows:
                return ""
            token = f"DOCINTAKE-TABLE-{len(tables)}"
            tables[token] = markdown_table(rows)
            return f"<p>{token}</p>"

        if include_images:
            # 先处理 img 再拆 svg：拆 svg 生成的是一个带占位符的 <img>，反过来会被
            # 图片那一道再解一次（占位符当成 href）。
            text = _IMG_TAG_RE.sub(image_replacement, text)
            text = _SVG_RE.sub(svg_replacement, text)
        else:
            # skip_images 只管 img；SVG 会被转换器整段序列化成 base64，必须自己删掉。
            text = _SVG_RE.sub("", text)
            text = _IMG_TAG_RE.sub("", text)

        text = _TABLE_RE.sub(table_replacement, text)
        text = _RUBY_RE.sub(_ruby_replacement, text)
        text = _ANCHOR_RE.sub(self._flatten_anchor, text)
        return text, tables

    @staticmethod
    def _flatten_anchor(match: re.Match[str]) -> str:
        """包内跳转只留文字：`#n1`、`../text/x.xhtml` 这类碎片不进正文。"""
        attrs, inner = match.group(1), match.group(2)
        href = _attr_text(attrs, "href")
        if href.startswith(_EXTERNAL_HREF_PREFIXES):
            return match.group(0)
        return inner

    # ── 媒体 ────────────────────────────────────────────────────────────

    def _extract_media(
        self,
        zf: zipfile.ZipFile,
        media: _MediaState,
        output_dir: Optional[str],
        stem: str,
        include_images: bool,
        result: ExtractionResult,
    ) -> dict[str, dict]:
        if not include_images or not media.order:
            return {}

        # 单个条目 200 MB 是硬上限：媒体是唯一可能灌进来的大块头，超过就不解了。
        oversized: list[str] = []
        for zip_path in list(media.order):
            try:
                size = zf.getinfo(zip_path).file_size
            except KeyError:
                oversized.append(zip_path)   # zip 里其实没有，按缺图处理
                continue
            if size > MAX_ENTRY_BYTES:
                result.warnings.append(
                    f"{zip_path} 解压后 {size} 字节，超过单条目上限 200 MB，已跳过"
                )
                oversized.append(zip_path)
        # 超限的不进解包列表；占位符账本保留，好让 _drop_unresolved_media 把正文引用清掉。
        for zip_path in oversized:
            media.order.remove(zip_path)
        if not media.order:
            return {}

        try:
            extracted = extract_and_convert_media(list(media.order), zf, output_dir or "", stem)
        except Exception as exc:
            result.warnings.append(f"媒体解包失败：{exc}")
            return {}

        by_original = {item.original_path: item for item in extracted}
        media_map: dict[str, dict] = {}
        for placeholder, zip_path in media.path_by_placeholder.items():
            item = by_original.get(zip_path)
            if item is None:
                continue
            # 交给 main.py 的 save_result：它按 local_path 的文件名重写成 {stem}_media/xxx.ext。
            media_map[placeholder] = {
                "local_path": item.local_path,
                "original_path": item.original_path,
                "kind": item.kind,
                "ext": item.ext,
            }
        result.images = [item.local_path for item in extracted]
        return media_map

    @staticmethod
    def _drop_unresolved_media(
        markdown: str,
        media: _MediaState,
        media_map: dict[str, dict],
    ) -> str:
        """占位符没换成真媒体（包内缺图、解包失败）时清掉引用，别让占位符漏进正文。"""
        unresolved = [
            placeholder for placeholder in media.path_by_placeholder
            if placeholder not in media_map
        ]
        for placeholder in unresolved:
            escaped = re.escape(placeholder)
            markdown = re.sub(rf"!\[[^\]]*\]\(\s*{escaped}\s*\)", "", markdown)
            markdown = re.sub(rf"<img\b[^>]*\bsrc=\"{escaped}\"[^>]*>", "", markdown)
        return markdown

    @staticmethod
    def _find_cover(package: ET.Element, manifest: dict[str, dict]) -> str:
        for item in manifest.values():
            if "cover-image" in item["properties"].split():
                return item["zip_path"]
        cover_id = ""
        for element in package.iter():
            if _local(element.tag) == "meta" and (element.get("name") or "").strip() == "cover":
                cover_id = (element.get("content") or "").strip()
                break
        item = manifest.get(cover_id)
        return item["zip_path"] if item else ""
