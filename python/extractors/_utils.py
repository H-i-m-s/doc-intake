"""extractors 公共工具函数

各 extractor 之间重复的辅助函数集中到这里,避免代码重复:
- _local_name: XML 命名空间剥离
- markdown_table: 把二维字符串数组渲染成 Markdown 表格
- element_text: 递归收集 ElementTree 元素的所有文本
- 媒体分类 / 命名 / 渲染工具:
    - classify_media: 按扩展名判断 image / video / audio / other
    - media_filename: 生成 image_NNN.ext / video_NNN.ext / audio_NNN.ext
    - format_media_ref: 按 kind 渲染 markdown 引用(图用 ![](),视频/音频用 HTML 标签)
    - ExtractedMedia: 从 zip 抽出来的单个媒体条目
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET
from typing import List, Literal, Optional


def markdown_media_path(path: str) -> str:
    """为 Markdown/HTML 媒体引用编码 ASCII 空格，保留中文和其他路径字符。"""
    return str(path).replace("%20", "%20").replace(" ", "%20")


MediaKind = Literal["image", "video", "audio", "other"]


MEDIA_KIND_BY_EXT: dict[str, str] = {
    # image
    ".png": "image", ".jpg": "image", ".jpeg": "image",
    ".gif": "image", ".bmp": "image", ".webp": "image",
    ".tif": "image", ".tiff": "image", ".svg": "image",
    ".emf": "image", ".wmf": "image",
    ".wdp": "image",  # Microsoft HD Photo / JPEG XR (Office 2010+ 常用)
    # video
    ".mp4": "video", ".mov": "video", ".webm": "video",
    ".m4v": "video", ".avi": "video", ".wmv": "video",
    ".m4v": "video",  # 重复占位,某些 Office 版本会写两种写法
    # audio
    ".mp3": "audio", ".wav": "audio", ".m4a": "audio",
    ".ogg": "audio", ".flac": "audio", ".aac": "audio",
}


def classify_media(ext: str) -> str:
    """按扩展名返回 'image' / 'video' / 'audio' / 'other'。

    接受 'mp4' / '.mp4' / '.MP4' 都行。识别不出时返回 'other'(不应被渲染)。
    """
    if not ext:
        return "other"
    e = ext.strip().lower()
    if not e.startswith("."):
        e = "." + e
    return MEDIA_KIND_BY_EXT.get(e, "other")


def media_filename(kind: str, counter: int, ext: str) -> str:
    """生成按 kind 分类、连续编号的文件名。

    示例:
        media_filename("image", 1, ".png") -> "image_001.png"
        media_filename("video", 2, ".mp4") -> "video_002.mp4"
        media_filename("audio", 3, ".mp3") -> "audio_003.mp3"
        media_filename("other", 1, ".bin") -> "media_001.bin"

    EMF/WMF 也会落到 image_*_*.png(已转码)。
    """
    e = (ext or "").strip().lower()
    if e and not e.startswith("."):
        e = "." + e
    prefix = kind if kind in ("image", "video", "audio") else "media"
    return f"{prefix}_{counter:03d}{e}"


def format_media_ref(rel_path: str, kind: str, alt: str = "") -> str:
    """按 kind 渲染 markdown 引用。

    - image:  ![alt](rel)
    - video:  <video controls src="rel" title="alt"></video>
    - audio:  <audio controls src="rel" title="alt"></audio>
    - other:  ![alt](rel)  (没法渲染,落到图片占位)
    """
    encoded_path = markdown_media_path(rel_path)
    alt_escaped = (alt or "").replace('"', "&quot;").strip()
    if kind == "video":
        title_attr = f' title="{alt_escaped}"' if alt_escaped else ""
        return f'<video controls src="{encoded_path}"{title_attr}></video>'
    if kind == "audio":
        title_attr = f' title="{alt_escaped}"' if alt_escaped else ""
        return f'<audio controls src="{encoded_path}"{title_attr}></audio>'
    return f'![{alt or ""}]({encoded_path})'


@dataclass
class ExtractedMedia:
    """从一个 zip 路径解出来的单个媒体条目。

    local_path:   输出目录里的路径(无 output_dir 时为 zip 内的虚拟路径,仅用于 kind 判断)
    original_path: zip 内的原始路径,如 'ppt/media/video1.mp4'
    kind:         'image' / 'video' / 'audio' / 'other'
    ext:          小写带点的扩展名,如 '.mp4'(EMF 转 PNG 后为 '.png')
    """
    local_path: str
    original_path: str
    kind: str
    ext: str


def media_rel_path(stem: str, media: "ExtractedMedia") -> str:
    """生成 markdown 引用用的相对路径(相对输出根目录,即 {stem}_media/xxx.ext)。"""
    return f"{stem}_media/{Path(media.local_path).name}"


def local_name(tag: str) -> str:
    """获取 XML tag 的本地名称(去掉命名空间前缀)

    例如 ``"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"`` -> ``"p"``
    """
    return tag.split("}")[-1] if "}" in tag else tag


def markdown_table(rows: List[List[str]], trailing_blank: bool = False) -> str:
    """把二维字符串数组渲染成 Markdown 表格

    Args:
        rows: 二维数组,第一行作为表头。空行/空列表返回 ""。
        trailing_blank: 是否在末尾追加一个空行(PPTX 场景需要)。
    """
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    escaped = [[cell.replace("|", "\\|").replace("\n", " ") for cell in row] for row in normalized]

    lines = [
        "| " + " | ".join(escaped[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in escaped[1:])
    if trailing_blank:
        lines.append("")
    return "\n".join(lines)


def element_text(element: ET.Element) -> str:
    """递归获取元素文本,包含 element.text、子元素文本和子元素 tail"""
    parts = []
    if element.text:
        parts.append(element.text)
    for child in element:
        parts.append(element_text(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


# 向后兼容:三个 extractor 原来用的私有函数名(各 extractor 内部 _utils.X 风格)
_local_name = local_name
_markdown_table = markdown_table
_element_text = element_text