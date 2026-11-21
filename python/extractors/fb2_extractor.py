"""FB2 / FBZ 提取器（纯标准库，不引第三方包）

FB2 是一份 XML（根 `<FictionBook>`），FBZ 是「zip 里装一份 fb2」。两种扩展名映射到
同一个细类型 `fb2`，所以这里自己看文件头：PK\x03\x04 就当 zip 拆，否则当裸 XML 读。

几条一以贯之的判据：

  1. 元素和属性一律按**本地名**匹配（`tag.split("}")[-1]`）。FictionBook 2.0/2.1 有带
     `xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"` 的，也有完全不带命名空间的，
     还有把 xlink 绑到别的前缀上的；写死命名空间会在真实书库里一半读不出来。
  2. 图片是 `<binary id="x" content-type="image/jpeg">base64</binary>` 里的一坨 base64，
     正文用 `<image l:href="#x"/>` 引用。转换前先换成占位符（`_media_placeholders` 那套），
     正文里因此不会残留 `#x`、base64、占位符字样，真实文件落进 `{stem}_media/`。
  3. `body name="notes"` 是尾注，整体挪到全文最后，给 `## 注释`；里面的 section 按自己的
     title 输出（通常是编号），级别顺延一级。
  4. 标题级别由 section 嵌套深度决定：顶层 section 的 title 是 `##`，往下每层加一级，
     最深封到 `######`。书名（`title-info/book-title`）用 `#`。
  5. 编码按 XML 声明走；没声明就 utf-8-sig → windows-1251 → gb18030 依次试。俄语圈的
     FB2 大量是 windows-1251。

行内与块级的几处取舍（工单允许二选一，选完写在这里）：
  - `<text-author>`（epigraph / cite / poem 的署名）写成引用块或诗块末尾的一行斜体
    `*—— 署名*`，不用「段落 —— 署名」拼接：署名不是正文的一部分，拼进去以后没法再分开。
  - `<code>` 当块级元素（section/body 的直接子元素）时输出围栏代码块；当行内元素
    （在 `<p>` 里，真实书里很常见，比如一个行内公式）时输出反引号行内代码。把行内
    代码硬掰成围栏会把一段话劈成三段。
  - `<poem>` 的每行用「两个空格 + 换行」硬换行，stanza 之间空行：这样源文件里一行对
    一行，渲染出来也真的换行。
  - `<empty-line/>` 只表达段落间距，正文块之间本来就是空行，所以它与相邻空行合并。
"""
from __future__ import annotations

import base64
import binascii
import re
import zipfile
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from ._media_placeholders import (
    MAX_MEDIA_BYTES,
    MediaPlaceholders,
    build_media_map,
    drop_unresolved_media,
    write_media_bytes,
)
from ._utils import markdown_table

ZIP_MAGIC = b"PK\x03\x04"
MAX_HEADING_LEVEL = 6
NOTES_BODY_NAME = "notes"

_XML_DECL_RE = re.compile(r"<\?xml[^>]*\?>", re.IGNORECASE)
_DOCTYPE_RE = re.compile(r"<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*>", re.IGNORECASE)
_DECLARED_ENCODING_RE = re.compile(
    rb"<\?xml[^>]*?encoding\s*=\s*[\"']([A-Za-z0-9._\-]+)[\"']", re.IGNORECASE
)
_WHITESPACE_RE = re.compile(r"\s+")

# content-type -> 落盘扩展名。认不出的再看二进制头，两头都认不出就记 warning 跳过。
CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/webp": ".webp",
    "image/tiff": ".tiff",
    "image/svg+xml": ".svg",
}

_EXTERNAL_HREF_PREFIXES = ("http://", "https://", "mailto:", "ftp://")

# 行内标记：FB2 元素名 -> (前, 后)
_INLINE_WRAP = {
    "strong": ("**", "**"),
    "emphasis": ("*", "*"),
    "strikethrough": ("~~", "~~"),
}


class Fb2Error(RuntimeError):
    """FB2 读不成时抛这个：main.py 会把它折进结构化错误，不会吐 traceback。"""


def _local(tag: object) -> str:
    """XML 本地名：`{uri}p` -> `p`；没有命名空间时原样返回。"""
    if not isinstance(tag, str):
        return ""
    return tag.split("}")[-1] if "}" in tag else tag


def _attr(element: ET.Element, name: str) -> str:
    """按属性本地名取值：`href` / `l:href` / 任意前缀的 href 都认。"""
    for key, value in element.attrib.items():
        if _local(key) == name:
            return (value or "").strip()
    return ""


def _collapse(text: str) -> str:
    return " ".join((text or "").split())


def _plain(element: ET.Element) -> str:
    """元素里的全部文字（含子元素），压成一行。"""
    return _collapse("".join(element.itertext()))


def _first_child(element: ET.Element, name: str) -> Optional[ET.Element]:
    for child in element:
        if _local(child.tag) == name:
            return child
    return None


def _find(element: ET.Element, name: str) -> Optional[ET.Element]:
    """深度优先找第一个本地名匹配的后代（不含自己）。"""
    for child in element.iter():
        if child is element:
            continue
        if _local(child.tag) == name:
            return child
    return None


def _body_name(body: ET.Element) -> str:
    return _attr(body, "name").strip().lower()


def _signature(author: str) -> str:
    return f"—— {author}" if author else ""


class _Binary:
    """一个 `<binary>`：图片的 base64 原文与声明类型，字节等真要落盘时再解。"""

    __slots__ = ("binary_id", "content_type", "payload")

    def __init__(self, binary_id: str, content_type: str, payload: str) -> None:
        self.binary_id = binary_id
        self.content_type = content_type
        self.payload = payload


class _Ctx:
    """一次渲染的上下文：图片账本、警告出口、当前章节（warning 里要写清在哪一节）。"""

    def __init__(self, binaries: dict[str, _Binary], include_images: bool,
                 result: ExtractionResult) -> None:
        self.binaries = binaries
        self.include_images = include_images
        self.placeholders = MediaPlaceholders()
        self.result = result
        self.section_titles: list[str] = []
        self.warned_ids: set[str] = set()

    @property
    def where(self) -> str:
        return self.section_titles[-1] if self.section_titles else "书名页"

    def warn(self, message: str) -> None:
        self.result.warnings.append(message)


class Fb2Extractor(BaseExtractor):
    """FB2/FBZ 提取器：FictionBook XML -> 一份 Markdown，媒体落到 `{stem}_media/`。"""

    name = "fb2"

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

        raw = self._read_payload(path)
        text = self._decode(raw, path.name, result)
        root = self._parse(text, path.name)

        bodies = [child for child in root if _local(child.tag) == "body"]
        if not bodies:
            raise Fb2Error(f"《{path.name}》里没有任何 <body>：这份 FB2 没有正文可提取")

        info = self._read_description(root)
        ctx = _Ctx(self._collect_binaries(root), include_images, result)

        main_bodies = [body for body in bodies if _body_name(body) == ""]
        other_bodies = [body for body in bodies if _body_name(body) not in ("", NOTES_BODY_NAME)]
        notes_bodies = [body for body in bodies if _body_name(body) == NOTES_BODY_NAME]

        # 书名优先级：title-info 的 book-title > 书名页 <title> 的第一段 > 文件名。
        # 书名页的 <title> 里第二段起是要跟在书名下面的副标题行，所以这里提前拆开：
        # 它得紧跟着 `#` 书名出现，不能隔着一整段简介才露面。
        first_title = self._body_title_parts(main_bodies[:1], ctx)
        title = info["title"] or first_title[0] or stem

        blocks: list[str] = [f"# {title}"]
        subtitle = first_title[1] or (first_title[0] if first_title[0] and first_title[0] != title else "")
        if subtitle:
            blocks.append(f"*{subtitle}*")
        if info["annotation"] is not None:
            blocks.extend(self._blocks(info["annotation"], ctx, 1))

        for index, body in enumerate(main_bodies):
            blocks.extend(self._body_blocks(body, ctx, skip_title=index == 0))
        for body in other_bodies:
            blocks.extend(self._named_body_blocks(body, ctx, _body_name(body)))
        for body in notes_bodies:
            blocks.extend(self._notes_blocks(body, ctx))

        # 封面即使正文没引用也要落盘（与 EPUB 的 cover-image 行为一致）：reserve 只登记
        # 解包、不发正文引用，所以它不进 mediaMap，也就不会在正文里多出一条图片。
        cover_id = info["cover_id"]
        if include_images and cover_id:
            if cover_id in ctx.binaries:
                ctx.placeholders.reserve(cover_id)
            else:
                ctx.warn(f"封面引用的图片 id 不存在：#{cover_id}")

        media_map = self._write_media(ctx, output_dir, stem, result)

        markdown = "\n\n".join(block for block in blocks if block.strip())
        markdown = drop_unresolved_media(markdown, ctx.placeholders, media_map)
        result.markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip() + "\n"

        section_count = sum(
            1 for body in main_bodies for child in body if _local(child.tag) == "section"
        )
        result.metadata = {
            "format": "fb2",
            "reader": "fb2-local",
            "title": title,
            "author": "、".join(info["authors"]),
            "language": info["language"],
            "sectionCount": section_count,
            "mediaMap": media_map,
        }
        if info["genres"]:
            result.metadata["genre"] = "、".join(info["genres"])
        for key, meta_key in (
            ("date", "date"),
            ("document_id", "documentId"),
            ("version", "version"),
            ("program_used", "programUsed"),
        ):
            if info[key]:
                result.metadata[meta_key] = info[key]
        return result

    # ── 读字节 / 解编码 / 解析 ──────────────────────────────────────────

    def _read_payload(self, path: Path) -> bytes:
        """FBZ 是 zip，FB2 是裸 XML；两种扩展名都可能装着对方，所以只看文件头。"""
        raw = path.read_bytes()
        if not raw.startswith(ZIP_MAGIC):
            return raw

        try:
            zf = zipfile.ZipFile(path)
        except zipfile.BadZipFile as exc:
            raise Fb2Error(
                f"《{path.name}》看起来是 FBZ 压缩包，但打不开（文件可能损坏）"
            ) from exc

        with zf:
            entries = [info for info in zf.infolist() if not info.is_dir()]
            if not entries:
                raise Fb2Error(f"《{path.name}》是个空压缩包，里面没有 .fb2")
            chosen = (
                next((item for item in entries if item.filename.lower().endswith(".fb2")), None)
                or next((item for item in entries
                         if item.filename.lower().endswith((".xml", ".txt"))), None)
                or entries[0]
            )
            if chosen.file_size > MAX_MEDIA_BYTES:
                raise Fb2Error(
                    f"《{path.name}》里的 {chosen.filename} 解压后 {chosen.file_size} 字节，"
                    f"超过 {MAX_MEDIA_BYTES // (1024 * 1024)} MB 上限，没有解"
                )
            try:
                return zf.read(chosen)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
                raise Fb2Error(
                    f"《{path.name}》里的 {chosen.filename} 解不开（{exc}）"
                ) from exc

    @staticmethod
    def _decode(raw: bytes, display: str, result: ExtractionResult) -> str:
        declared = _DECLARED_ENCODING_RE.match(raw[:300])
        candidates: list[str] = []
        if declared:
            candidates.append(declared.group(1).decode("ascii", "ignore"))
        # windows-1251 几乎能解任何字节序列，所以必须排在 utf-8 后面：
        # 顺序反了的话，所有 UTF-8 的 FB2 都会变成一堆乱码，而且不报错。
        candidates += ["utf-8-sig", "utf-8", "windows-1251", "gb18030"]
        for encoding in dict.fromkeys(candidates):
            try:
                return raw.decode(encoding)
            except (UnicodeDecodeError, LookupError):
                continue
        result.warnings.append(f"{display} 的编码认不出来，已用替换字符解码")
        return raw.decode("utf-8", "replace")

    @staticmethod
    def _parse(text: str, display: str) -> ET.Element:
        """解析成 ElementTree。XML 声明与 DOCTYPE 先摘掉：声明里的 encoding 会让
        fromstring 在「已经是 str」的输入上直接报错，DTD 则会把实体解析带进外部文件。"""
        cleaned = _XML_DECL_RE.sub("", text, count=1)
        cleaned = _DOCTYPE_RE.sub("", cleaned)
        try:
            root = ET.fromstring(cleaned)
        except ET.ParseError as exc:
            line, column = exc.position
            raise Fb2Error(
                f"《{display}》不是合法的 FB2：XML 在第 {line} 行第 {column} 列附近读不通"
                f"（{exc}）"
            ) from exc
        if _local(root.tag) != "FictionBook":
            raise Fb2Error(
                f"《{display}》不是合法的 FB2：根元素是 <{_local(root.tag) or root.tag}>，"
                f"不是 <FictionBook>"
            )
        return root

    # ── 元数据 ──────────────────────────────────────────────────────────

    def _read_description(self, root: ET.Element) -> dict:
        info = {
            "title": "",
            "authors": [],
            "language": "",
            "genres": [],
            "date": "",
            "annotation": None,
            "cover_id": "",
            "document_id": "",
            "version": "",
            "program_used": "",
        }
        title_info = _find(root, "title-info")
        if title_info is not None:
            for child in title_info:
                tag = _local(child.tag)
                if tag == "book-title" and not info["title"]:
                    info["title"] = _plain(child)
                elif tag == "author":
                    name = self._author_name(child)
                    if name:
                        info["authors"].append(name)
                elif tag == "lang" and not info["language"]:
                    info["language"] = _plain(child)
                elif tag == "genre":
                    genre = _plain(child)
                    if genre:
                        info["genres"].append(genre)
                elif tag == "date" and not info["date"]:
                    info["date"] = _plain(child) or _attr(child, "value")
                elif tag == "annotation" and info["annotation"] is None:
                    info["annotation"] = child
                elif tag == "coverpage":
                    image = _find(child, "image")
                    href = _attr(image, "href") if image is not None else ""
                    if href:
                        info["cover_id"] = href[1:] if href.startswith("#") else href

        document_info = _find(root, "document-info")
        if document_info is not None:
            for child in document_info:
                tag = _local(child.tag)
                if tag == "id" and not info["document_id"]:
                    info["document_id"] = _plain(child)
                elif tag == "version" and not info["version"]:
                    info["version"] = _plain(child)
                elif tag == "program-used" and not info["program_used"]:
                    info["program_used"] = _plain(child)
        return info

    @staticmethod
    def _author_name(author: ET.Element) -> str:
        parts = []
        for name in ("first-name", "middle-name", "last-name"):
            element = _first_child(author, name)
            if element is not None:
                parts.append(_plain(element))
        full = " ".join(part for part in parts if part)
        if full:
            return full
        nickname = _first_child(author, "nickname")
        return _plain(nickname) if nickname is not None else ""

    def _collect_binaries(self, root: ET.Element) -> dict[str, _Binary]:
        binaries: dict[str, _Binary] = {}
        for element in root.iter():
            if _local(element.tag) != "binary":
                continue
            binary_id = _attr(element, "id")
            if not binary_id or binary_id in binaries:
                continue
            binaries[binary_id] = _Binary(
                binary_id,
                _attr(element, "content-type").lower(),
                element.text or "",
            )
        return binaries

    # ── 结构：body / section ────────────────────────────────────────────

    def _body_title_parts(self, bodies: list[ET.Element], ctx: _Ctx) -> tuple[str, str]:
        """书名页 `<title>`：第一段当书名，其余当副标题（title-info 没有 book-title 时兜底）。"""
        for body in bodies:
            title_element = _first_child(body, "title")
            if title_element is None:
                continue
            heading, extra = self._title_parts(title_element, ctx)
            if heading or extra:
                return heading, extra
        return "", ""

    def _body_blocks(self, body: ET.Element, ctx: _Ctx, *, skip_title: bool) -> list[str]:
        """正文主体。第一个 body 的 title 已经变成最前面的书名，不重复第二遍。"""
        blocks: list[str] = []
        title_element = _first_child(body, "title")
        if title_element is not None and not skip_title:
            heading, extra = self._title_parts(title_element, ctx)
            if heading:
                blocks.append(f"# {heading}")
            if extra:
                blocks.append(f"*{extra}*")
        for child in body:
            if child is title_element:
                continue
            blocks.extend(self._element(child, ctx, 1))
        return blocks

    def _named_body_blocks(self, body: ET.Element, ctx: _Ctx, name: str) -> list[str]:
        """非 notes 的命名 body（comments 之类）：给它自己的 title 一个 `##`。"""
        blocks: list[str] = []
        title_element = _first_child(body, "title")
        heading = name
        if title_element is not None:
            title_text, extra = self._title_parts(title_element, ctx)
            heading = title_text or name
            if extra:
                blocks.append(f"*{extra}*")
        blocks.insert(0, f"## {heading}")
        for child in body:
            if child is title_element:
                continue
            blocks.extend(self._element(child, ctx, 2))
        return blocks

    def _notes_blocks(self, body: ET.Element, ctx: _Ctx) -> list[str]:
        """`body name="notes"`：整体挪到全文最后，`## 注释` 起头，里面的 section 降一级。

        标题固定写「注释」（不管书里那张注释页叫什么），书里原来的 title 与它不一样时
        作为一行斜体跟在后头：既守住了「注释固定在最后、标题叫注释」这个形状，也不丢
        原书自己写的那个名字。
        """
        blocks: list[str] = []
        title_element = _first_child(body, "title")
        if title_element is not None:
            title_text, extra = self._title_parts(title_element, ctx)
            if title_text and title_text != "注释":
                blocks.append(f"*{title_text}*")
            if extra:
                blocks.append(f"*{extra}*")
        blocks.insert(0, "## 注释")
        for child in body:
            if child is title_element:
                continue
            blocks.extend(self._element(child, ctx, 2))
        return blocks

    def _section(self, element: ET.Element, ctx: _Ctx, depth: int) -> list[str]:
        """section 的 title 级别 = 嵌套深度：顶层 `##`，每深一层加一级，封顶 `######`。"""
        blocks: list[str] = []
        title_element = _first_child(element, "title")
        heading, extra = "", ""
        if title_element is not None:
            heading, extra = self._title_parts(title_element, ctx)

        ctx.section_titles.append(heading or (ctx.section_titles[-1] if ctx.section_titles else "正文"))
        try:
            level = min(depth + 1, MAX_HEADING_LEVEL)
            if heading:
                blocks.append(f"{'#' * level} {heading}")
            if extra:
                blocks.append(f"*{extra}*")
            for child in element:
                if child is title_element:
                    continue
                blocks.extend(self._element(child, ctx, depth + 1))
        finally:
            ctx.section_titles.pop()
        return blocks

    def _title_parts(self, title_element: ET.Element, ctx: _Ctx) -> tuple[str, str]:
        """`<title>` 里第一个 `<p>` 是标题，其余是标题下面的一行斜体。"""
        parts: list[str] = []
        for child in title_element:
            if _local(child.tag) != "p":
                continue
            text = self._inline(child, ctx)
            if text:
                parts.append(text)
        if parts:
            return parts[0], " ".join(parts[1:])
        return self._inline(title_element, ctx), ""

    # ── 块级元素 ────────────────────────────────────────────────────────

    def _blocks(self, container: ET.Element, ctx: _Ctx, depth: int) -> list[str]:
        blocks: list[str] = []
        for child in container:
            blocks.extend(self._element(child, ctx, depth))
        return blocks

    def _element(self, element: ET.Element, ctx: _Ctx, depth: int) -> list[str]:
        tag = _local(element.tag)

        if tag == "section":
            return self._section(element, ctx, depth)
        if tag == "p":
            text = self._inline(element, ctx)
            return [text] if text else []
        if tag == "subtitle":
            text = self._inline(element, ctx)
            return [f"**{text}**"] if text else []
        if tag == "empty-line":
            # 只表达段落间距：块之间本来就是空行，交给最后的换行合并去收。
            return [""]
        if tag in ("epigraph", "cite"):
            return self._quote(element, ctx)
        if tag == "poem":
            return self._poem(element, ctx)
        if tag == "table":
            return self._table(element, ctx)
        if tag == "code":
            return self._code_block(element)
        if tag == "image":
            reference = self._image(element, ctx)
            return [reference] if reference else []
        if tag == "text-author":
            # 裸在 body/section 里的署名（少见）：单独一行斜体。
            text = self._inline(element, ctx)
            return [f"*{_signature(text)}*"] if text else []
        if tag == "title":
            heading, extra = self._title_parts(element, ctx)
            blocks = [f"{'#' * min(depth + 1, MAX_HEADING_LEVEL)} {heading}"] if heading else []
            if extra:
                blocks.append(f"*{extra}*")
            return blocks
        if tag == "annotation":
            return self._blocks(element, ctx, depth)

        if len(element):
            return self._blocks(element, ctx, depth)
        text = self._inline(element, ctx)
        return [text] if text else []

    def _quote(self, element: ET.Element, ctx: _Ctx) -> list[str]:
        """`<epigraph>` / `<cite>` -> 引用块；`<text-author>` 做成块尾的斜体署名行。"""
        lines: list[str] = []
        author = ""
        for child in element:
            if _local(child.tag) == "text-author":
                author = self._inline(child, ctx)
                continue
            lines.extend(block for block in self._element(child, ctx, 1) if block.strip())
        if author:
            lines.append(f"*{_signature(author)}*")
        if not lines:
            return []
        body = "\n\n".join(lines)
        quoted = "\n".join(f"> {line}" if line.strip() else ">" for line in body.split("\n"))
        return [quoted]

    def _poem(self, element: ET.Element, ctx: _Ctx) -> list[str]:
        """诗：每行一行文本（两个空格硬换行），stanza 之间空行，署名收在诗末。"""
        stanzas: list[list[str]] = []
        author = ""
        for child in element:
            tag = _local(child.tag)
            if tag == "stanza":
                lines = []
                for verse in child:
                    if _local(verse.tag) not in ("v", "line", "p"):
                        continue
                    text = self._inline(verse, ctx)
                    if text:
                        lines.append(text)
                if lines:
                    stanzas.append(lines)
            elif tag == "text-author":
                author = self._inline(child, ctx)
            elif tag == "title":
                heading, extra = self._title_parts(child, ctx)
                if heading:
                    stanzas.append([f"**{heading}**"])
                if extra:
                    stanzas.append([f"*{extra}*"])
            elif tag == "subtitle":
                text = self._inline(child, ctx)
                if text:
                    stanzas.append([f"*{text}*"])
            else:
                for block in self._element(child, ctx, 1):
                    if block.strip():
                        stanzas.append([block])
        if author:
            stanzas.append([f"*{_signature(author)}*"])
        blocks = ["  \n".join(lines) for lines in stanzas]
        return ["\n\n".join(blocks)] if blocks else []

    def _table(self, element: ET.Element, ctx: _Ctx) -> list[str]:
        rows: list[list[str]] = []
        for row in element.iter():
            if _local(row.tag) != "tr":
                continue
            cells = [
                self._inline(cell, ctx)
                for cell in row
                if _local(cell.tag) in ("td", "th")
            ]
            if any(cell.strip() for cell in cells):
                rows.append(cells)
        if not rows:
            return []
        return [markdown_table(rows)]

    def _code_block(self, element: ET.Element) -> list[str]:
        text = "".join(element.itertext()).strip("\n")
        if not text.strip():
            return []
        fence = "```" if "```" not in text else "````"
        return [f"{fence}\n{text}\n{fence}"]

    # ── 行内元素 ────────────────────────────────────────────────────────

    def _inline(self, element: ET.Element, ctx: _Ctx) -> str:
        parts: list[str] = [_WHITESPACE_RE.sub(" ", element.text or "")]
        for child in element:
            tag = _local(child.tag)
            inner = self._inline(child, ctx)

            if tag in _INLINE_WRAP:
                before, after = _INLINE_WRAP[tag]
                parts.append(f"{before}{inner}{after}" if inner.strip() else inner)
            elif tag == "sub":
                parts.append(f"<sub>{inner}</sub>" if inner.strip() else inner)
            elif tag == "sup":
                parts.append(f"<sup>{inner}</sup>" if inner.strip() else inner)
            elif tag == "code":
                parts.append(self._inline_code(inner))
            elif tag == "a":
                parts.append(self._anchor(child, inner))
            elif tag == "image":
                parts.append(self._image(child, ctx))
            else:
                # style / p / 未知的排版元素：只留文字，不猜语义。
                parts.append(inner)

            parts.append(_WHITESPACE_RE.sub(" ", child.tail or ""))
        return "".join(parts).strip()

    @staticmethod
    def _inline_code(text: str) -> str:
        """行内代码：内容里有反引号就换长的围栏，别再自己造一层转义。"""
        if not text.strip():
            return text
        fence = "`" if "`" not in text else "``"
        return f"{fence}{text}{fence}"

    @staticmethod
    def _anchor(element: ET.Element, inner: str) -> str:
        """外链留 `[文字](地址)`；文档内锚点（脚注 `#n1`、互引）只留文字。"""
        href = _attr(element, "href")
        if not href:
            return inner
        if href.startswith(_EXTERNAL_HREF_PREFIXES) and inner.strip():
            return f"[{inner}]({href})"
        return inner

    def _image(self, element: ET.Element, ctx: _Ctx) -> str:
        """`<image l:href="#id"/>` -> 占位符图片引用；id 不存在就记 warning 并丢掉这条引用。"""
        if not ctx.include_images:
            return ""
        href = _attr(element, "href")
        if not href:
            return ""
        binary_id = href[1:] if href.startswith("#") else href
        if not binary_id:
            return ""
        if binary_id not in ctx.binaries:
            if binary_id not in ctx.warned_ids:
                ctx.warned_ids.add(binary_id)
                ctx.warn(
                    f"正文引用了不存在的图片 id：#{binary_id}（在「{ctx.where}」），这条引用已删"
                )
            return ""
        return f"![]({ctx.placeholders.placeholder_for(binary_id)})"

    # ── 媒体落盘 ────────────────────────────────────────────────────────

    def _write_media(
        self,
        ctx: _Ctx,
        output_dir: Optional[str],
        stem: str,
        result: ExtractionResult,
    ) -> dict[str, dict]:
        if not ctx.include_images or not ctx.placeholders.order:
            return {}

        extracted = []
        counter = 0
        for binary_id in ctx.placeholders.order:
            binary = ctx.binaries.get(binary_id)
            if binary is None:
                continue
            data = self._binary_bytes(binary, ctx)
            if data is None:
                continue
            if len(data) > MAX_MEDIA_BYTES:
                ctx.warn(
                    f"图片 #{binary_id} 解出来 {len(data)} 字节，超过单条目上限 200 MB，已跳过"
                )
                continue
            ext = self._binary_ext(binary, data, ctx)
            if not ext:
                continue
            counter += 1
            extracted.append(write_media_bytes(
                data,
                ext,
                original_path=binary_id,
                output_dir=output_dir,
                stem=stem,
                counter=counter,
            ))

        media_map = build_media_map(extracted, ctx.placeholders)
        result.images = [item.local_path for item in extracted]
        return media_map

    @staticmethod
    def _binary_bytes(binary: _Binary, ctx: _Ctx) -> Optional[bytes]:
        payload = "".join(binary.payload.split())
        try:
            data = base64.b64decode(payload, validate=False)
        except (binascii.Error, ValueError):
            ctx.warn(f"图片 #{binary.binary_id} 的 base64 解不开，已跳过")
            return None
        if not data:
            ctx.warn(f"图片 #{binary.binary_id} 的 base64 是空的，已跳过")
            return None
        return data

    @staticmethod
    def _binary_ext(binary: _Binary, data: bytes, ctx: _Ctx) -> str:
        ext = CONTENT_TYPE_EXT.get(binary.content_type, "")
        if ext:
            return ext
        guessed = _sniff_ext(data)
        if guessed:
            return guessed
        ctx.warn(
            f"图片 #{binary.binary_id} 的类型认不出来"
            f"（content-type={binary.content_type or '空'}），已跳过"
        )
        return ""


def _sniff_ext(data: bytes) -> str:
    """按二进制头猜扩展名：content-type 空着或写错时兜住。"""
    head = data[:512]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if head.startswith(b"BM"):
        return ".bmp"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return ".tiff"
    stripped = head.lstrip()
    if stripped.startswith(b"<") and (b"<svg" in head[:200] or stripped.startswith(b"<?xml")):
        return ".svg"
    return ""
