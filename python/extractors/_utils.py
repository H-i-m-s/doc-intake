"""extractors 公共工具函数

各 extractor 之间重复的辅助函数集中到这里,避免代码重复:
- _local_name: XML 命名空间剥离
- markdown_table: 把二维字符串数组渲染成 Markdown 表格
- element_text: 递归收集 ElementTree 元素的所有文本
- 公式文本规范化 / 中文包装:
    - normalize_math_text: 数学字母数字符号(U+1D400-U+1D7FF)、数学减号等换成基础字符
    - wrap_text_runs: 连续中文段包成 \text{...},其余段交给调用方的转义函数
    - merge_adjacent_text: 把紧挨着的两个 \text{...} 合成一个
    - is_cjk: 码位是不是中文/全角一类
- 媒体分类 / 命名 / 渲染工具:
    - classify_media: 按扩展名判断 image / video / audio / other
    - media_filename: 生成 image_NNN.ext / video_NNN.ext / audio_NNN.ext
    - format_media_ref: 按 kind 渲染 markdown 引用(图用 ![](),视频/音频用 HTML 标签)
    - ExtractedMedia: 从 zip 抽出来的单个媒体条目
"""
from __future__ import annotations

import re
import unicodedata

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


# ===== 公式文本规范化 =====
# 两类"看着对、机器不认"的字符，按 Unicode 码位处理，不猜语义：
# 1. 数学字母数字符号(U+1D400-U+1D7FF)：从 PDF / 网页复制公式时最常见的污染。屏幕上
#    看到的是斜体 x，机器读到的却是另一个码位，LaTeX 与 KaTeX 的字母表里没有它，轻则
#    缺字、重则整段报错。用 Unicode 自己的兼容分解换回基础字符即可——斜体本来就由数学
#    模式表现，不丢信息。U+2212 数学减号、U+00A0 不换行空格等一并处理。
# 2. 中文与全角符号：数学模式里裸着的中文会被当成未知符号，连续一段包进 \text{...}。
# 本段不依赖任何第三方包，mathtype 那条链和 OMML 那条链都从这里取。
_MATH_ALNUM = (0x1D400, 0x1D7FF)
_SIMPLE = {
    0x2212: "-",    # 数学减号
    0x2010: "-",    # 连字符
    0x2011: "-",    # 不换行连字符
    0x00A0: " ",    # 不换行空格
    0x00AD: "",     # 软连字符
}
# 该进 \text{} 的码位区间：中文、日文假名、全角符号与标点
_CJK_RANGES = (
    (0x3000, 0x303F),
    (0x3040, 0x30FF),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xF900, 0xFAFF),
    (0xFE30, 0xFE4F),
    (0xFF00, 0xFFEF),
)
_TEXT_ESCAPE = {
    "\\": r"\textbackslash{}", "{": r"\{", "}": r"\}",
    "$": r"\$", "&": r"\&", "#": r"\#", "%": r"\%",
    "_": r"\_", "^": r"\^{}", "~": r"\~{}",
}


def is_cjk(code: int) -> bool:
    """这个码位是不是中文/全角一类（该进 \\text{} 的字符）。"""
    for lo, hi in _CJK_RANGES:
        if lo <= code <= hi:
            return True
    return False


def normalize_math_text(text: str) -> str:
    """把数学字母数字符号与少数变体符号换成基础字符。"""
    if not text:
        return text
    if not any(ord(c) >= _MATH_ALNUM[0] or ord(c) in _SIMPLE for c in text):
        return text
    out = []
    for ch in text:
        cp = ord(ch)
        if _MATH_ALNUM[0] <= cp <= _MATH_ALNUM[1]:
            out.append(unicodedata.normalize("NFKC", ch))
        elif cp in _SIMPLE:
            out.append(_SIMPLE[cp])
        else:
            out.append(ch)
    return "".join(out)


def wrap_text_runs(text: str, escape_math) -> str:
    """中文/全角段包成 \\text{...}，其余段交给 escape_math 按原逻辑转义。

    escape_math 由调用方传入（各条转换路有各自的符号表）。整串没有中文时直接交回
    escape_math，保持老行为不变。
    """
    if not text:
        return text
    if not any(is_cjk(ord(c)) for c in text):
        return escape_math(text)

    chunks: list[tuple[bool, str]] = []
    buf: list[str] = []
    cur: bool | None = None
    for ch in text:
        want = is_cjk(ord(ch))
        if cur is None:
            cur = want
        elif want != cur:
            chunks.append((cur, "".join(buf)))
            buf = []
            cur = want
        buf.append(ch)
    if buf:
        chunks.append((cur, "".join(buf)))

    parts = []
    for is_text, chunk in chunks:
        if is_text:
            body = "".join(_TEXT_ESCAPE.get(c, c) for c in chunk)
            parts.append("\\text{" + body + "}")
        else:
            parts.append(escape_math(chunk))
    return "".join(parts)


_ADJACENT_TEXT = re.compile(r"\\text\{([^{}]*)\}\\text\{")


def merge_adjacent_text(text: str) -> str:
    """把紧挨着的两个 \\text{...} 合成一个。

    Word 自带公式会把每个字存在各自的小片段里，于是同一句中文会变成一连串
    \\text{...}；合成后只是看着干净，渲染结果不变。

    中间隔着数学的绝不合并（例如 \\text{a}^{2}\\text{b}）：正则要求两个 \\text{}
    之间除 `}` 和 `\\text{` 之外没有别的，而 `^{2}` 这样的内容走在匹配范围外。
    """
    if "\\text{" not in text:
        return text
    prev = None
    while prev != text:
        prev = text
        text = _ADJACENT_TEXT.sub(r"\\text{\1", text)
    return text


# 向后兼容:三个 extractor 原来用的私有函数名(各 extractor 内部 _utils.X 风格)
_local_name = local_name
_markdown_table = markdown_table
_element_text = element_text