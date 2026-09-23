"""公式文本规范化：按 Unicode 码位处理两类"看着对、机器不认"的字符。

两条规则都不猜语义，只看码位：

1. **数学字母数字符号（U+1D400–U+1D7FF）**：从 PDF / 网页复制公式时最常见的污染。
   屏幕上看到的是斜体 x，机器读到的却是另一个码位；LaTeX 与 KaTeX 的字母表里没有它，
   轻则缺字，重则整段报错。用 Unicode 自己的兼容分解换回基础字符即可——斜体本来就由
   数学模式自动表现，所以不丢信息。U+2212（数学减号）、U+00A0（不换行空格）一并处理。
2. **中文与全角符号**：数学模式里裸着的中文会被当成未知符号。按码位切出连续的中文段，
   包进 \\text{...}，段内再转义 LaTeX 特殊字符。

本模块不依赖任何第三方包，也不依赖应用内其他模块，mathtype 那条链和 OMML 那条链都
可以放心引用。
"""

from __future__ import annotations

import re
import unicodedata

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
