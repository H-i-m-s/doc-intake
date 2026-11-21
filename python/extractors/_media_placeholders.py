"""EPUB / FB2 共用的媒体占位符账本与落盘工具。

为什么要有占位符这一层：正文里直接写包内路径（`OEBPS/images/a.png`）或文档内引用
（`#cover.jpg`），转换完还得回头改写成 `{stem}_media/image_001.jpg`；中间只要有一处
对不上，正文里就会留下点不动的路径碎片。所以正文里一律先放一个 token
（`docintake-media-N`：不带点、不带斜杠，不会被当成相对路径），真正的文件在这里登记、
落进 `{stem}_media/`，最后由 main.py 的 save_result 统一把 token 改写成真实相对路径。

这里只放「跟容器无关」的部分：账本、mediaMap 组装、没下落的占位符清理、按字节落盘。
EPUB 那边的 zip 解包逻辑（entry 大小上限、EMF 转 PNG）留在 epub_extractor 里。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from ._utils import ExtractedMedia, media_filename

MEDIA_PLACEHOLDER_PREFIX = "docintake-media-"

# 单张媒体的硬上限，与 EPUB 的 zip 单条目上限同一个数：超过就不解，只记 warning。
MAX_MEDIA_BYTES = 200 * 1024 * 1024


class MediaPlaceholders:
    """一次提取里的占位符账本：key（zip 路径 / binary id）-> 占位符。

    同一个 key 只发一个占位符：同一张图被两处引用时复用，否则会解两遍、编号也翻倍。
    """

    def __init__(self) -> None:
        self.placeholder_by_key: dict[str, str] = {}
        self.key_by_placeholder: dict[str, str] = {}
        self.order: list[str] = []
        self.counter = 0

    def reserve(self, key: str) -> str:
        """登记一个要解出来的媒体（不产生正文引用），返回空串。

        封面这种「只落盘、正文不提」的图片走这里。
        """
        if key not in self.placeholder_by_key:
            self.placeholder_by_key[key] = ""
            self.order.append(key)
        return ""

    def placeholder_for(self, key: str) -> str:
        existing = self.placeholder_by_key.get(key)
        if existing:
            return existing
        self.counter += 1
        placeholder = f"{MEDIA_PLACEHOLDER_PREFIX}{self.counter}"
        self.placeholder_by_key[key] = placeholder
        self.key_by_placeholder[placeholder] = key
        self.order.append(key)
        return placeholder


def build_media_map(extracted: list[ExtractedMedia], placeholders: MediaPlaceholders) -> dict[str, dict]:
    """占位符 -> main.py 改写用的媒体信息。

    只收有占位符的（正文里出现过引用的）；reserve 进来的封面不进 mediaMap——正文没引用，
    给 main.py 一条改写规则也没用，文件照样落盘。
    """
    by_key = {item.original_path: item for item in extracted}
    media_map: dict[str, dict] = {}
    for placeholder, key in placeholders.key_by_placeholder.items():
        item = by_key.get(key)
        if item is None:
            continue
        # 交给 main.py 的 save_result：它按 local_path 的文件名重写成 {stem}_media/xxx.ext。
        media_map[placeholder] = {
            "local_path": item.local_path,
            "original_path": item.original_path,
            "kind": item.kind,
            "ext": item.ext,
        }
    return media_map


def drop_unresolved_media(
    markdown: str,
    placeholders: MediaPlaceholders,
    media_map: dict[str, dict],
) -> str:
    """占位符没换成真媒体（缺图、解包失败）时清掉引用，别让 token 漏进正文。"""
    unresolved = [
        placeholder for placeholder in placeholders.key_by_placeholder
        if placeholder not in media_map
    ]
    for placeholder in unresolved:
        escaped = re.escape(placeholder)
        markdown = re.sub(rf"!\[[^\]]*\]\(\s*{escaped}\s*\)", "", markdown)
        markdown = re.sub(rf"<img\b[^>]*\bsrc=\"{escaped}\"[^>]*>", "", markdown)
    return markdown


def write_media_bytes(
    data: bytes,
    ext: str,
    *,
    original_path: str,
    output_dir: Optional[str],
    stem: str,
    counter: int,
    kind: str = "image",
) -> ExtractedMedia:
    """把一段内存里的媒体字节落进 `{stem}_media/image_NNN.ext`。

    没有 output_dir 时只构造 ExtractedMedia（local_path 用虚拟文件名占位），不碰磁盘：
    EPUB 那边的无输出目录路径也是这样，mediaMap 仍可用来判断要不要发引用。
    """
    out_name = media_filename(kind, counter, ext)
    if not output_dir:
        return ExtractedMedia(local_path=out_name, original_path=original_path, kind=kind, ext=ext)

    media_dir = Path(output_dir) / f"{stem}_media"
    media_dir.mkdir(parents=True, exist_ok=True)
    out_path = media_dir / out_name
    out_path.write_bytes(data)
    return ExtractedMedia(
        local_path=str(out_path), original_path=original_path, kind=kind, ext=ext
    )
