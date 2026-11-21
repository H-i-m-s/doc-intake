"""CBZ 提取器（漫画归档 = zip 里装一堆图，纯标准库，不做 OCR，不调云端）

CBZ 是「zip 装一堆图」：没有文字结构，也没有可供排版的层级，一页就是一张图。所以这里
产出的是一份「页序清单」——正文只有书名、页数与每页一张引用，页序完全由图片顺序表达。

几条判据：

  1. **自然排序**：漫画打包工具的命名千奇百怪，`page10.jpg` 排在 `page2.jpg` 前面是
     字典序的锅，不是书的锅。排序键是「目录路径的自然序 -> 文件名的自然序」，文件名里
     连续的数字按数值比；`page1` / `page01` 在数值上等价，再按位数定先后，保证同一个包
     不会因为多一个前导零就换位置，同时顺序又是确定的。
  2. **不采信 PageCount 定页数**：`ComicInfo.xml` 里的 PageCount 常是抓取工具的估值，
     与包内真实图片数对不上。页数只认包里的图，`PageCount` 不一致时记一条 warning。
  3. **不加「第 N 页」标题**：两百页就是两百个标题，正文会被撑成目录。页序由图片顺序
     表达，页数在「共 N 页」与 metadata.pageCount 里。
  4. **落盘编号从 001 起连续**：`{stem}_media/image_001.jpg` 一路往下，一页一个文件，
     与正文引用顺序一一对应。占位符与落盘走 `_media_placeholders`（与 EPUB / FB2 同一套），
     main.py 的 save_result 负责把 token 改写成真实相对路径。
  5. 不做 OCR：CBZ 里没有文字层。要文字的人显式走图片链，那是另一条本来就存在的路。

打包垃圾（`__MACOSX/`、macOS 资源叉 `._xxx`、`Thumbs.db`、`ComicInfo.xml`）不算页：
它们是工具留下的，混进页序会让「第 3 张图」和「第 3 页」错开。
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from ._media_placeholders import (
    MediaPlaceholders,
    build_media_map,
    drop_unresolved_media,
    write_media_bytes,
)
from ._utils import ExtractedMedia

# 认作「页」的扩展名（大小写不敏感）。CBZ 里混进 PDF、txt 是常事，一律不当页。
IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"})

COMIC_INFO_NAME = "comicinfo.xml"
MACOSX_DIR = "__macosx/"
RESOURCE_FORK_PREFIX = "._"
JUNK_BASENAMES = frozenset({"thumbs.db", COMIC_INFO_NAME})

# 单张图 50 MB：漫画里极少有这么大的页，超过就当异常条目跳过，不当成「这本很大」。
MAX_PAGE_BYTES = 50 * 1024 * 1024
# 整包解压后 2 GB：防 zip bomb。漫画两百页高清图也不过几百 MB，留足余量。
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024

_DIGITS_RE = re.compile(r"(\d+)")

# ComicInfo.xml 的标签 -> 内部字段名。按本地名匹配（大小写不敏感），带命名空间的也认。
COMIC_INFO_TAGS = {
    "title": "title",
    "series": "series",
    "number": "number",
    "volume": "volume",
    "writer": "writer",
    "publisher": "publisher",
    "year": "year",
    "summary": "summary",
    "pagecount": "page_count",
}


class CbzError(RuntimeError):
    """CBZ 读不成时抛这个：main.py 会把它折进结构化错误，不会吐 traceback。"""


def _basename(name: str) -> str:
    return name.rsplit("/", 1)[-1]


def _collapse(text: str) -> str:
    return " ".join((text or "").split())


def _natural_tokens(text: str) -> tuple:
    """把一段文字切成可以按「数」比的 token 序列。

    文本段与数字段各自带上自己的标签（0 / 1），于是 `page2` 与 `page10` 比的是 2 < 10，
    而不是 `'1' < '2'`。数字段后面再挂一个位数：`page1` 与 `page01` 数值相同，靠位数
    （少的在前）定谁先，顺序因此是确定的，不会随 zip 里写入了哪个先而变。
    """
    tokens: list[tuple] = []
    for chunk in _DIGITS_RE.split(text.lower()):
        if not chunk:
            continue
        if chunk.isdigit():
            tokens.append((1, int(chunk), len(chunk), ""))
        else:
            tokens.append((0, 0, 0, chunk))
    return tuple(tokens)


def natural_key(entry_path: str) -> tuple:
    """zip 内路径的排序键：先目录（逐级）再文件名，两段都按自然序。

    先目录后文件名，是为了让 `ch01/page2` 排在 `ch02/page1` 前面：目录是章节，章节顺序
    优先于章节内的页序。根目录的目录段是空元组，比任何子目录都小，所以平铺的包先出。
    最后再拿原路径兜一次底：键完全相同时（同一个包理论上不该有）也保持确定顺序。
    """
    directory, _, name = entry_path.rpartition("/")
    dir_parts = tuple(_natural_tokens(part) for part in directory.split("/") if part)
    return (dir_parts, _natural_tokens(name), entry_path)


def _is_page(entry_path: str) -> bool:
    """这个 zip 条目算不算一页。"""
    lowered = entry_path.lower()
    if lowered.startswith(MACOSX_DIR):
        return False
    name = _basename(lowered)
    if name.startswith(RESOURCE_FORK_PREFIX):
        return False
    if name in JUNK_BASENAMES:
        return False
    return Path(name).suffix in IMAGE_EXTS


class CbzExtractor(BaseExtractor):
    """CBZ 提取器：zip 里的图片按自然序 -> 一份 Markdown，图片落到 `{stem}_media/`。"""

    name = "cbz"

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
            raise CbzError(
                f"《{path.name}》不是合法的 CBZ（它不是有效的 zip 压缩包；"
                f"CBR/CB7 要先解压成 zip）"
            ) from exc

        with zf:
            entries = [item for item in zf.infolist() if not item.is_dir()]
            total_bytes = sum(item.file_size for item in entries)
            if total_bytes > MAX_TOTAL_BYTES:
                raise CbzError(
                    f"《{path.name}》解压后 {total_bytes} 字节，超过 "
                    f"{MAX_TOTAL_BYTES // (1024 ** 3)} GB 上限，没有解（可能是 zip bomb）"
                )

            pages = self._collect_pages(entries, result)
            if not pages:
                raise CbzError(
                    f"《{path.name}》里没有图片条目（可能是 CBR/CB7 改名，或空包）"
                )

            info = self._read_comic_info(zf, entries, result)
            title = self._title(info, stem)

            media = MediaPlaceholders()
            written: list[ExtractedMedia] = []
            if include_images:
                written = self._write_pages(zf, pages, media, output_dir, stem, result)
            page_count = len(written) if include_images else len(pages)

            self._check_page_count(info, page_count, result)

            blocks: list[str] = [f"# {title}"]
            series_line = self._series_line(info, title)
            if series_line:
                blocks.append(series_line)
            if include_images:
                blocks.append(f"共 {page_count} 页")
            else:
                blocks.append(f"媒体提取已关闭（共 {page_count} 页）")
            if info["summary"]:
                blocks.append(f"*{info['summary']}*")
            if include_images:
                blocks.extend(f"![]({media.placeholder_for(item.original_path)})" for item in written)

            media_map = build_media_map(written, media) if include_images else {}
            markdown = "\n\n".join(block for block in blocks if block.strip())
            markdown = drop_unresolved_media(markdown, media, media_map)
            result.markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip() + "\n"
            result.images = [item.local_path for item in written]

        metadata: dict = {
            "format": "cbz",
            "reader": "cbz-local",
            "title": title,
            "author": info["writer"],
            "pageCount": page_count,
        }
        for key, value in (
            ("series", info["series"]),
            ("number", info["number"]),
            ("volume", info["volume"]),
            ("publisher", info["publisher"]),
            ("year", info["year"]),
        ):
            if value:
                metadata[key] = value
        metadata["mediaMap"] = media_map
        result.metadata = metadata
        return result

    # ── 页收集 ──────────────────────────────────────────────────────────

    def _collect_pages(self, entries: list[zipfile.ZipInfo], result: ExtractionResult) -> list[str]:
        """筛出图片条目、去重、按自然序排好。返回 zip 内路径列表（页序）。"""
        chosen: dict[str, zipfile.ZipInfo] = {}
        for item in entries:
            name = item.filename.replace("\\", "/")
            if not _is_page(name):
                continue
            if name in chosen:
                # 有的打包工具会把同一页写两遍。以先出现的为准，顺序与内容都不跟着变。
                result.warnings.append(f"{name} 在包内出现了不止一次，按先出现的那一条算")
                continue
            chosen[name] = item
        return sorted(chosen, key=natural_key)

    # ── ComicInfo.xml ───────────────────────────────────────────────────

    def _read_comic_info(
        self,
        zf: zipfile.ZipFile,
        entries: list[zipfile.ZipInfo],
        result: ExtractionResult,
    ) -> dict:
        """读根或任意子目录里的第一份 ComicInfo.xml；读不出来就返回空表，不算失败。"""
        info = {value: "" for value in COMIC_INFO_TAGS.values()}
        name = next(
            (item.filename for item in entries
             if _basename(item.filename).lower() == COMIC_INFO_NAME),
            "",
        )
        if not name:
            return info

        try:
            root = ET.fromstring(zf.read(name))
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
            result.warnings.append(f"{name} 解不开（{exc}），书目信息按文件名走")
            return info
        except ET.ParseError:
            result.warnings.append(f"{name} 不是合法 XML，书目信息按文件名走")
            return info

        for element in root.iter():
            tag = str(element.tag).split("}")[-1].lower()
            key = COMIC_INFO_TAGS.get(tag)
            if not key or info[key]:
                continue
            text = _collapse("".join(element.itertext()))
            if text:
                info[key] = text
        return info

    @staticmethod
    def _title(info: dict, stem: str) -> str:
        """书名：Title > Series + Number > 文件名（去扩展名）。"""
        if info["title"]:
            return info["title"]
        composed = " ".join(part for part in (info["series"], info["number"]) if part)
        return composed or stem

    @staticmethod
    def _series_line(info: dict, title: str) -> str:
        """系列/卷号那行斜体；与标题重复时不出（否则同一句话印两遍）。"""
        parts: list[str] = []
        if info["series"]:
            parts.append(info["series"])
        if info["number"]:
            parts.append(f"Vol.{info['number']}")
        label = " · ".join(parts)
        if not label or label == title:
            return ""
        return f"*{label}*"

    @staticmethod
    def _check_page_count(info: dict, page_count: int, result: ExtractionResult) -> None:
        declared = info["page_count"]
        if not declared:
            return
        if not declared.isdigit():
            result.warnings.append(
                f"ComicInfo.xml 的 PageCount 不是数字（{declared}），已按包内实际图片数计"
            )
            return
        if int(declared) != page_count:
            result.warnings.append(
                f"ComicInfo.xml 的 PageCount 写的是 {declared}，包里实际有 {page_count} 张图；"
                f"按实际图片数出，页数以「共 {page_count} 页」为准"
            )

    # ── 图片落盘 ────────────────────────────────────────────────────────

    def _write_pages(
        self,
        zf: zipfile.ZipFile,
        pages: list[str],
        media: MediaPlaceholders,
        output_dir: Optional[str],
        stem: str,
        result: ExtractionResult,
    ) -> list[ExtractedMedia]:
        """按页序逐张解出来落盘，编号从 001 起连续。

        跳过的页不发占位符，正文里也就不会有它的引用——宁可缺一页，也不留一条点不动的
        图片引用。
        """
        written: list[ExtractedMedia] = []
        counter = 0
        for page in pages:
            try:
                declared_size = zf.getinfo(page).file_size
            except KeyError:
                result.warnings.append(f"{page} 在 zip 目录里找不到，已跳过这一页")
                continue
            if declared_size > MAX_PAGE_BYTES:
                result.warnings.append(
                    f"{page} 解压后 {declared_size} 字节，超过单页 "
                    f"{MAX_PAGE_BYTES // (1024 * 1024)} MB 上限，已跳过这一页"
                )
                continue
            try:
                data = zf.read(page)
            except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
                result.warnings.append(f"{page} 解不开（{exc}），已跳过这一页")
                continue
            if not data:
                result.warnings.append(f"{page} 是 0 字节的空图，已跳过这一页")
                continue
            if len(data) > MAX_PAGE_BYTES:
                # 头部声明的 file_size 可以是假的，真正的门槛按解出来的字节数再判一次。
                result.warnings.append(
                    f"{page} 解出来 {len(data)} 字节，超过单页 "
                    f"{MAX_PAGE_BYTES // (1024 * 1024)} MB 上限，已跳过这一页"
                )
                continue

            counter += 1
            ext = Path(page).suffix.lower()
            written.append(write_media_bytes(
                data,
                ext,
                original_path=page,
                output_dir=output_dir,
                stem=stem,
                counter=counter,
            ))
            media.placeholder_for(page)
        return written
