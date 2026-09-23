# -*- coding: utf-8 -*-
"""把 MTEF v5 记录树渲染成 LaTeX。

配合 python/mathtype/mtef_v5.py 使用：那个模块按官方规范把字节解成记录树，这里按
规范「Template selectors and variations」把记录树翻成 LaTeX。

为什么不复用旧的 mtef.py 的 makeLatex（该模块已删，见 mtef_v5.py 文件头）
--------------------------------------------------------------------
1. 它按「选择子 -> 一段手写分支」堆在一起，围栏那支把内容套进 \\begin{array}{}，
   括号用 \\left/\\right 包在外面，于是围栏公式都被写成竖排数组。实测 obj2 的
   2x2 矩阵被渲染成 3 行 1 列。
2. 它按 ast.children 的下标取槽位，而且假定槽位里没有 FULL / SUB 这类字号标记。
3. 它没有任何闸门：读不懂也照样输出，调用方看不出哪条是猜的。

依据与实测
----------
规范（https://rtf2latex2e.sourceforge.net/MTEF5.html）给的选择子与变体位表，配上
5 个文档 165 道 v5 公式普查后的实测，几处与规范正文不同，以实测为准：

- **限位**：规范「Limit variations」写作 tvBO_LOWER=0x0001、tvBO_UPPER=0x0002，实测
  是 **0x10 = 下限、0x20 = 上限、0x40 = 总和式摆放**。依据：tmSUM var=0x70 的槽是
  「Σa_i² / i=1 / ∞」——上下限都在；tmSUM var=0x40 只有一个主槽；tmINTEG var=0x31
  的槽是「∫ 的被积式 / 0 / l」，0 是下限在前。
- **大运算符槽位顺序**：规范正文写「主槽、上槽、下槽、运算符」，实测是
  **主槽、下限槽、上限槽**（与 v3 的实测一致）。
- **极限（tmLIM）**槽位顺序与规范一致：主槽、下槽、上槽；实测「min / x / 空」配
  var=0x10（只有下限），对得上。
- **根号**：规范写「主槽位、被开方槽位」，实测是**被开方在前、次数槽在后**
  （var=0 的平方根是「被开方内容 / 空」，与规范那份逐字节范例一致）。
- **上下标**：tmSUB 的下标槽在前；tmSUP 的**上标槽在后**（第一个是空槽），所以
  b² 的 2 落在第二个槽；tmSUBSUP 先下标后上标。
- **围栏**的变体位与规范一致：0x1 左、0x2 右、0x3 两侧。实测 tmBRACK var=0x1/0x2/0x3
  各有出现，括号字符本身是 fnEXPAND 风格的可拉伸字形，由模板输出，内容槽只有主槽。
- **fnFUNCTION 不专指函数名**：实测连着这一风格的除了 sin/cos/tan/log/arccos，还有
  '('、')'、'['、']' 这类括号（MathType 把函数参数的分隔符也标成这一风格）。所以不能
  把连续一段直接当函数名，只能把**连续的字母**凑成词再看是不是已知算符。

字号标记（FULL / SUB / SUB2）
-----------------------------
v3 里字号标记是行内状态，SUB 就开一层下标；v5 照搬会坏事：tmSUP 的槽位列表里第一个
槽前带一个 SUB，照流式处理会渲染出 b_{2} 而不是 b^{2}。所以这里的规则是——
模板槽位列表、矩阵单元列表里的字号标记只当尺寸提示，不参与结构；只有行（LINE）内部
的字号标记才按流式处理，开/收下标层。

硬闸
----
任何一条不满足就返回 None，由调用方退回公式预览图——
- 遇到没实现的模板 / 附饰 / 字符：不猜；
- 矩阵单元数与行列数不符：不渲染；
- \\left 与 \\right 不配对、花括号不配平：结构没理清
  （x_{i) 那批就是这么挡住的）。
宁可给一张对的图，不给一段错的 LaTeX。
"""
from __future__ import annotations

import re
from collections import Counter
from typing import List, Optional, Tuple

try:  # 包内导入（python/mathtype 作为包被引用时）
    from . import mtef_v5 as m5
    from .chars import Chars, SpecialChar
except ImportError:  # 扁平导入（mathtype_converter 把 python/mathtype 加进了 sys.path）
    import mtef_v5 as m5
    from chars import Chars, SpecialChar

__all__ = ["render", "render_equation", "self_test"]

# 围栏类：选择子 -> (左, 右)。变体位 0x1 只留左、0x2 只留右，缺的一侧写 '.'
FENCES = {
    "tmANGLE": (r"\langle", r"\rangle"),
    "tmPAREN": ("(", ")"),
    "tmBRACE": (r"\{", r"\}"),
    "tmBRACK": ("[", "]"),
    "tmBAR": ("|", "|"),
    "tmDBAR": (r"\|", r"\|"),
    "tmFLOOR": (r"\lfloor", r"\rfloor"),
    "tmCEILING": (r"\lceil", r"\rceil"),
    "tmOBRACK": (r"\llbracket", r"\rrbracket"),
}
FENCE_LEFT = 0x0001
FENCE_RIGHT = 0x0002

# 限位/大运算符的变体位（实测值，见文件头）
BO_LOWER = 0x0010
BO_UPPER = 0x0020
BO_SUM = 0x0040
# 积分本身的变体位：低两位是重数，0x4 带圈，0x8/0xC 顺/逆时针圈
INT_COUNT = 0x0003
INT_LOOP = 0x0004
INT_CW = 0x0008
INT_CCW = 0x000C

# 大运算符：选择子 -> (LaTeX 命令, 圈线命令, 是否积分式)
# 积分式（lim 在侧边）与总和式（lim 在上下）由 BO_SUM 位决定，见 bigop()
BIGOPS = {
    "tmINTEG": (None, {1: r"\oint", 2: r"\oiint", 3: r"\oiiint"}, True),
    "tmSUM": (r"\sum", None, False),
    "tmPROD": (r"\prod", None, False),
    "tmCOPROD": (r"\coprod", None, False),
    "tmUNION": (r"\bigcup", None, False),
    "tmINTER": (r"\bigcap", None, False),
}
INTEG_NAMES = {1: r"\int", 2: r"\iint", 3: r"\iiint"}

# 函数名：fnFUNCTION 风格的连续字母凑成词，命中就出算符（顺带把间距也交给 LaTeX）
FUNC_OPS = {
    "sin": r"\sin", "cos": r"\cos", "tan": r"\tan", "cot": r"\cot",
    "sec": r"\sec", "csc": r"\csc", "arcsin": r"\arcsin", "arccos": r"\arccos",
    "arctan": r"\arctan", "sinh": r"\sinh", "cosh": r"\cosh", "tanh": r"\tanh",
    "coth": r"\coth", "log": r"\log", "ln": r"\ln", "lg": r"\lg",
    "exp": r"\exp", "lim": r"\lim", "max": r"\max", "min": r"\min",
    "sup": r"\sup", "inf": r"\inf", "det": r"\det", "gcd": r"\gcd",
    "deg": r"\deg", "dim": r"\dim", "ker": r"\ker", "arg": r"\arg",
    "mod": r"\bmod", "Pr": r"\Pr",
}
# 极限类模板的主槽必须是这些算符之一，才把上下限摆成 _{}^{}
LIM_OPS = {r"\lim", r"\max", r"\min", r"\sup", r"\inf", r"\det", r"\gcd",
           r"\deg", r"\dim", r"\ker", r"\arg", r"\Pr"}

# 附饰（EMBELL 记录）。码位表见规范「EMBELL record」，这里只列能一一对上 LaTeX 的。
EMBELLS = {
    2: r"\dot", 3: r"\ddot", 4: r"\dddot",
    5: "'", 6: "''", 18: "'''",
    8: r"\tilde", 9: r"\hat",
    16: r"\bar", 17: r"\overline",
    19: r"\frown", 20: r"\smile",
}
EMBELL_INLINE = {5, 6, 18}   # 撇号是后缀，不包裹

# 过箭头的附饰（embRARROW 11 / embLARROW 12 / embBARROW 13 / 半箭 14、15）。
# 单原子用短写法（\vec），长内容用拉伸写法：MathType 的箭头会跟着内容变宽，
# \vec 不会。半箭 LaTeX 没有“压在内容上”的标准写法，用 \overset 叠一个。
_ARROW_EMBELLS = {
    11: (r"\vec", r"\overrightarrow"),
    12: (None, r"\overleftarrow"),
    13: (None, r"\overleftrightarrow"),
    14: (None, r"\overset{\rightharpoonup}"),
    15: (None, r"\overset{\leftharpoonup}"),
}

# 帽子类模板（HatBox）的短/长写法：单原子用 \hat 这类，长内容用 \widehat 这类。
# tmVEC 不在这里：它自己带方向变体（规范 tvVE_*），写法见 Renderer.vec()。
_HATS = {
    "tmTILDE": (r"\tilde", r"\widetilde"),
    "tmHAT": (r"\hat", r"\widehat"),
}


def _is_single_atom(s: str) -> bool:
    """s 是不是「一个原子」（单字符或单条命令）。用来决定箭头要不要拉伸。"""
    if not s:
        return False
    if len(s) == 1:
        return True
    return bool(re.fullmatch(r"\\[a-zA-Z]+|\\.", s))

# 记录类型里不产出内容的：定义记录、字号记录、颜色记录、future
SILENT = {"EncodingDefRec", "FontDefRec", "FontStyleDefRec", "EqnPrefsRec",
          "ColorRec", "ColorDefRec", "FutureRec", "SizeRec"}
# 字号标记 -> 目标层级
SIZE_MARKERS = {10: 0, 11: 1, 12: 2}

_CMD_TAIL = re.compile(r"\\[a-zA-Z]+$")
_FUNC_WORD = re.compile(r"[A-Za-z]+")


def _needs_gap(prev: str, cur: str) -> bool:
    """命令名后面必须留一个空格，否则 \\alphax 会被读成一个词。"""
    return bool(cur) and bool(_CMD_TAIL.search(prev))


def _ends_with_script(s: str) -> bool:
    """s 是否以「_{...}」或「^{...}」这类上下标组结尾。

    用来挡 double subscript：同一个基上挂两层同向上下标（\sigma_{Fd}^{2}_{i}）真 LaTeX
    会报 Double subscript，KaTeX 也直接不渲染。拿预览图逐张比对时确实碰到了这种输出
    （开发语料里的一个实例：预览是 σ^{2}_{Fdi}）。join 遇到「上一段以脚本组结尾、这一段又以
    _ 或 ^ 开头」就补一个空组 {}，变成合法的 {}_{...}，视觉完全一致。"""
    if not s.endswith("}"):
        return False
    depth = 0
    i = len(s) - 1
    while i >= 0:
        ch = s[i]
        if ch == "}":
            depth += 1
        elif ch == "{":
            depth -= 1
            if depth == 0:
                return i > 0 and s[i - 1] in "_^"
        elif ch == "\\":
            i -= 1
        i -= 1
    return False


def join(parts: List[str]) -> str:
    out: List[str] = []
    for s in parts:
        if not s:
            continue
        if out:
            if _needs_gap(out[-1], s):
                out.append(" ")
            elif s[0] in "_^" and _ends_with_script(out[-1]):
                out.append("{}")
        out.append(s)
    return "".join(out)


# ── 公式里的中文（和全角标点）─────────────────────────────────────────
# MathType 会把中文当普通字符写进 CHAR 记录，mt_code 就是码位，字体风格另算。
# 裸着出也能显示，但字体走的是数学字体栈，字距和中文排版不对；包一层 \text{} 才对。
# 按码位判，不看字体风格编号——这样 v3/v5 通用，也不用猜哪个 typeface 是中文。

_TEXT_ESCAPES = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%",
                 "#": r"\#", "_": r"\_", "$": r"\$",
                 "{": r"\{", "}": r"\}"}


def _is_text_code(rec) -> bool:
    """mt_code 落在中日韩 / 全角区间：按正文出，不按数学符号。"""
    code = getattr(rec, "mt_code", -1)
    return (0x2E80 <= code <= 0x9FFF or 0x3000 <= code <= 0x303F
            or 0xF900 <= code <= 0xFAFF or 0xFE30 <= code <= 0xFE4F
            or 0xFF00 <= code <= 0xFFEF)


def _take_text_run(recs, i: int) -> Tuple[str, int]:
    """从 i 起吃掉连续的正文类字符（中日韩 + 空格），返回 (文字, 下一个下标)。"""
    buf: List[str] = []
    while i < len(recs):
        r = recs[i]
        if type(r).__name__ != "CharRec":
            break
        code = getattr(r, "mt_code", -1)
        if _is_text_code(r):
            buf.append(chr(code))
        elif code == 0x20:
            buf.append(" ")
        else:
            break
        i += 1
    return "".join(buf), i


def _escape_text(s: str) -> str:
    return "".join(_TEXT_ESCAPES.get(ch, ch) for ch in s)


class Renderer:
    def __init__(self):
        self.ok = True
        self.notes: List[str] = []
        self.size_depth = 0

    def fail(self, why: str) -> str:
        if self.ok:
            self.notes.append(why)
        self.ok = False
        return ""

    # ── 调度 ───────────────────────────────────────────────

    def records(self, recs, in_line: bool) -> str:
        """渲染一串记录。

        in_line=True 时（LINE / PILE 的对象列表）字号标记按流式处理：SUB 开一层下标，
        FULL 全部收掉。模板槽位列表、矩阵单元列表里传 False，那里的字号标记只是尺寸
        提示，不参与结构——否则 tmSUP 槽位前的 SUB 会把 b² 渲染成 b_{2}。
        """
        out: List[str] = []
        chars = [r for r in recs]
        i = 0
        n = len(chars)
        while i < n:
            r = chars[i]
            name = type(r).__name__
            if name == "MarkerRec":
                rt = getattr(r, "record_type", None)
                if in_line and rt in SIZE_MARKERS:
                    target = SIZE_MARKERS[rt]
                    while self.size_depth > target:
                        out.append("}")
                        self.size_depth -= 1
                    while self.size_depth < target:
                        out.append("_{")
                        self.size_depth += 1
                i += 1
                continue
            if name == "CharRec" and self.is_func_letter(r):
                word, i = self.take_func_word(chars, i)
                out.append(self.func_word(word))
                continue
            if name == "CharRec" and _is_text_code(r):
                run, i = _take_text_run(chars, i)
                out.append(r"\text{%s}" % _escape_text(run))
                continue
            out.append(self.record(r))
            i += 1
        return join(out)

    def is_func_letter(self, c) -> bool:
        return (c.typeface == 2 and 0 <= c.mt_code < 0x80
                and chr(c.mt_code).isalpha())

    def take_func_word(self, chars, i: int) -> Tuple[str, int]:
        """从 i 起取连续的 fnFUNCTION 字母，凑成一个词。"""
        word = []
        while i < len(chars):
            c = chars[i]
            if type(c).__name__ == "CharRec" and self.is_func_letter(c):
                word.append(chr(c.mt_code))
                i += 1
            else:
                break
        return "".join(word), i

    def func_word(self, word: str) -> str:
        if word in FUNC_OPS:
            return FUNC_OPS[word]
        return r"\mathrm{%s}" % word

    def record(self, r) -> str:
        name = type(r).__name__
        if name == "CharRec":
            return self.char(r)
        if name == "TmplRec":
            return self.tmpl(r)
        if name == "LineRec":
            return self.records(r.objects, in_line=True) if not r.is_null else ""
        if name == "PileRec":
            return self.pile(r)
        if name == "MatrixRec":
            return self.matrix(r)
        if name == "EmbellRec":
            code = getattr(r, "code", -1)
            return self.embell_accents(code, "")
        if name == "RulerRec":
            return ""
        if name in SILENT:
            return ""
        if name == "MarkerRec":
            return ""      # SYM / SUBSYM 这类字号标记，不出内容
        return self.fail("未知记录类型 %s" % name)

    def line_text(self, line) -> str:
        """一条 LINE 的内容（不改字号层级状态，模板内部用）。"""
        if not isinstance(line, m5.LineRec) or line.is_null:
            return ""
        saved = self.size_depth
        text = self.records(line.objects, in_line=True)
        # 行内没闭合的下标层在这里收掉，不让它漏到同级的下一条线
        while self.size_depth > saved:
            text += "}"
            self.size_depth -= 1
        return text

    # ── 字符 ───────────────────────────────────────────────

    def symbol(self, mt_code: int, typeface: int) -> str:
        for key in self._symbol_keys(mt_code, typeface):
            s = Chars.get(key)
            if s:
                return s
        ch = chr(mt_code)
        return SpecialChar.get(ch, ch)

    @staticmethod
    def _symbol_keys(mt_code: int, typeface: int) -> List[str]:
        plain = "char/0x%04x" % mt_code
        mathmode = plain + "/mathmode"
        # 与 mtef_v3_latex.symbol 同口径：MTExtra / 空格风格先查 mathmode
        if typeface in (11, 24):
            return [mathmode, plain]
        return [plain, mathmode]

    def char(self, c) -> str:
        if c.typeface == 22:        # fnEXPAND：可拉伸字形，由模板输出
            return ""
        if c.typeface == 23:        # fnMARKER：不可见标记
            return ""
        if c.mt_code < 0:           # 不带 MTCode，只能靠字体编码还原，不猜
            return self.fail("字符不带 MTCode（mtefOPT_CHAR_ENC_NO_MTCODE）")
        if c.typeface == 24:        # fnSPACE
            return r"\ "
        text = self.symbol(c.mt_code, c.typeface)
        if c.typeface in (1, 12):   # fnTEXT / fnTEXT_FE：正体文本
            text = r"\mathrm{%s}" % text
        for e in c.embellishments or []:
            text = self.apply_embellishment(text, e)
        return text

    def apply_embellishment(self, base: str, e) -> str:
        name = type(e).__name__
        if name == "EmbellRec":
            return self.embell_accents(getattr(e, "code", -1), base)
        if name == "TmplRec":       # 附饰列表里可能夹着上下标模板
            return join([base, self.tmpl(e)])
        return join([base, self.record(e)])

    def embell_accents(self, code: int, base: str) -> str:
        if code in _ARROW_EMBELLS:
            short, wide = _ARROW_EMBELLS[code]
            fn = short if (short and _is_single_atom(base)) else wide
            return "%s{%s}" % (fn, base)
        if code not in EMBELLS:
            return self.fail("未实现的附饰 code=%s" % code)
        fn = EMBELLS[code]
        if code in EMBELL_INLINE:
            return (base or "") + fn
        return "%s{%s}" % (fn, base)

    # ── 模板 ───────────────────────────────────────────────

    def slot_lines(self, t) -> List[m5.LineRec]:
        return [x for x in t.slots if isinstance(x, m5.LineRec)]

    def tmpl(self, t) -> str:
        sel = t.selector
        cls = t.tmpl_class

        if sel in FENCES:
            return self.fence(t, sel)
        if sel == "tmINTERVAL":
            return self.interval(t)
        if cls == "ScrBox":
            return self.script(t, sel)
        if cls == "FracBox":
            return self.frac(t, sel)
        if cls == "RootBox":
            return self.root(t)
        if cls == "ParBox":
            return self.fail("未实现的围栏类模板 %s" % sel)
        if cls == "BigOp":
            return self.bigop(t, sel)
        if sel == "tmLIM":
            return self.limits(t)
        # 下面这些按规范的选择子表 + 变体位实现（语料里没出现过，属新增覆盖，见文件头）。
        if sel in ("tmUBAR", "tmOBAR"):
            return self.bar(t, sel)
        if sel in ("tmVEC", "tmTILDE", "tmHAT", "tmARC"):
            return self.hat(t, sel)
        if sel == "tmARROW":
            return self.arrow(t)
        if sel == "tmHBRACE":
            return self.hbrace(t, sel)
        if sel == "tmHBRACK":
            return self.fail("未实现的水平方括号 tmHBRACK（KaTeX 没有 \\overbracket）")
        if sel == "tmJSTATUS":
            return self.fail("未实现的接头状态构造 tmJSTATUS（含义不明）")
        if sel == "tmDIRAC":
            return self.dirac(t)
        if sel == "tmSTRIKE":
            return self.strike(t)
        if sel == "tmBOX":
            return self.box(t)
        return self.fail("未实现的模板 %s（类 %s，变体 0x%04X）" % (sel, cls, t.variation))

    # 模板内容槽：只有 LINE 才算槽位
    def slot_texts(self, t) -> List[str]:
        r"""内容槽的文本。模板的子对象列表里除了槽位，还夹着它自己的装饰字形
        （fnEXPAND 的 CHAR）与 COLOR 记录——实测 \widehat{ABC} 的子对象是
        [COLOR, LINE(A B C), CHAR(fnEXPAND)]，真正的内容只有那个 LINE。
        按 LINE 计数才跟规范里「一个槽位」的说法对得上。"""
        return [self.line_text(x) for x in t.slots
                if isinstance(x, m5.LineRec)]

    # 错配/单边区间：左右围栏各自编码在变体里，左右可以不一样（如 [a,b)）
    def interval(self, t) -> str:
        glyphs = ("(", ")", "[", "]")
        left = glyphs[t.variation & 0x0003]            # tvINTV_LEFT_*：低 2 位
        right = glyphs[(t.variation & 0x0030) >> 4]    # tvINTV_RIGHT_*：0x0030
        parts = [x for x in self.slot_texts(t) if x]
        if not parts:
            return self.fail("tmINTERVAL 没有内容槽")
        return r"\left%s %s \right%s" % (left, join(parts), right)

    # 上/下横线（BarBox）：单槽，变体 0x0001 = 双线
    def bar(self, t, sel: str) -> str:
        parts = self.slot_texts(t)
        if len(parts) != 1:
            return self.fail("%s 槽位数应为 1，实际 %d" % (sel, len(parts)))
        if not parts[0]:
            return self.fail("%s 内容槽为空" % sel)
        fn = r"\underline" if sel == "tmUBAR" else r"\overline"
        if t.variation & 0x0001:
            return "%s{%s{%s}}" % (fn, fn, parts[0])
        return "%s{%s}" % (fn, parts[0])

    # 箭头（ArroBox）：子对象是 [上标签槽, 下标签槽, 箭头字形]
    def arrow(self, t) -> str:
        r"""真机依据（MathType 7 写的 `\xrightarrow{f}`）：变体 0x0024 = 0x0004（上标签
        槽存在）+ 0x0020（指右）；子对象依次是 SUB、COLOR、LINE(f)、LINE(空)、FULL、
        CHAR(fnEXPAND，箭头字形 0x2192)。也就是上标签槽在前、下标签槽在后。

        只做验过的情形：上标签槽存在。双线/半箭（0x0001/0x0002，与 tvAR_LOS/tvAR_SOL
        复用，方向不唯一）、只有下标签槽、两个标签槽都没有时，槽位顺序没实测，退回预览图。"""
        var = t.variation
        if var & 0x0003:
            return self.fail("tmARROW 双线/半箭（变体 0x%04X）未实现" % var)
        if var & ~0x003C:
            return self.fail("tmARROW 变体 0x%04X 有未知位" % var)
        if not (var & 0x0004):
            return self.fail("tmARROW 没有上标签槽（变体 0x%04X）未实现" % var)
        parts = self.slot_texts(t)          # 只数 LINE：上标签槽、下标签槽
        if not parts:
            return self.fail("tmARROW 找不到标签槽")
        top = parts[0]
        bottom = parts[1] if len(parts) > 1 else ""
        if not top and not bottom:
            return self.fail("tmARROW 两个标签槽都空")
        left = bool(var & 0x0010)      # tvAR_LEFT
        right = bool(var & 0x0020)     # tvAR_RIGHT
        if left and right:
            cmd = r"\xleftrightarrow"
        elif left:
            cmd = r"\xleftarrow"
        else:
            cmd = r"\xrightarrow"
        if bottom:
            return "%s[%s]{%s}" % (cmd, bottom, top)
        return "%s{%s}" % (cmd, top)

    # 向量（tmVEC，属 HatBox 类但自带方向变体）
    def vec(self, t) -> str:
        r"""向量箭头。规范变体位：0x0001 指左、0x0002 指右、0x0004 箭头在槽下方、
        0x0008 半箭。两个方向位都不标时默认向右。

        真机依据（MathType 7 写的 \vec{v}）：变体就是 0x0002（指右）。单个字母的
        向量用 \vec（MathType 的箭头也跟着内容伸缩，单字母就是短箭头）；长内容用
        可拉伸写法。半箭没有可拉伸写法，用 \overset / \underset 叠一个；上下双向
        的半箭（两位都标）含义不清，退回预览图。"""
        var = t.variation
        if var & ~0x000F:
            return self.fail("tmVEC 变体 0x%04X 有未知位" % var)
        parts = self.slot_texts(t)
        if len(parts) != 1:
            return self.fail("tmVEC 槽位数应为 1，实际 %d" % len(parts))
        inner = parts[0]
        if not inner:
            return self.fail("tmVEC 内容槽为空")
        left = bool(var & 0x0001)
        right = bool(var & 0x0002)
        under = bool(var & 0x0004)
        if var & 0x0008:                        # tvVE_HARPOON
            if left and right:
                return self.fail("tmVEC 双向半箭（变体 0x%04X）未实现" % var)
            sym = r"\leftharpoonup" if left else r"\rightharpoonup"
            return r"\%s{%s}{%s}" % ("underset" if under else "overset", sym, inner)
        if _is_single_atom(inner) and not left and not under and not (var & 0x0008):
            return r"\vec{%s}" % inner
        if left and right:
            name = "underleftrightarrow" if under else "overleftrightarrow"
        elif left:
            name = "underleftarrow" if under else "overleftarrow"
        else:
            name = "underrightarrow" if under else "overrightarrow"
        return "\\%s{%s}" % (name, inner)

    # 帽子类（HatBox）：tmVEC / tmTILDE / tmHAT / tmARC，都是单槽
    def hat(self, t, sel: str) -> str:
        if sel == "tmVEC":          # 自带方向变体，写法见 vec()
            return self.vec(t)
        parts = self.slot_texts(t)
        if len(parts) != 1:
            return self.fail("%s 槽位数应为 1，实际 %d" % (sel, len(parts)))
        inner = parts[0]
        if not inner:
            return self.fail("%s 内容槽为空" % sel)
        if sel == "tmARC":
            return r"\overset{\frown}{%s}" % inner
        short, wide = _HATS[sel]
        return "%s{%s}" % (short if _is_single_atom(inner) else wide, inner)

    # 水平花括号（HFenceBox）：子对象是 [主槽, 小槽, 花括号字形]
    def hbrace(self, t, sel: str) -> str:
        parts = self.slot_texts(t)
        if not parts or len(parts) > 2:
            return self.fail("%s 内容槽 1~2 个，实际 %d" % (sel, len(parts)))
        if not parts[0]:
            return self.fail("%s 内容槽为空" % sel)
        fn = r"\overbrace" if t.variation & 0x0001 else r"\underbrace"
        return "%s{%s}" % (fn, parts[0])

    # 狄拉克符号：两槽 \langle a \middle| b \rangle
    def dirac(self, t) -> str:
        parts = self.slot_texts(t)
        if len(parts) == 2:
            return r"\left\langle %s \middle| %s \right\rangle" % (parts[0], parts[1])
        if len(parts) == 1:
            return parts[0]
        return self.fail("tmDIRAC 槽位数 %d 未实现" % len(parts))

    # 划掉线（StrikeBox）：横线用 \sout，斜线用 \cancel / \bcancel / \xcancel
    def strike(self, t) -> str:
        """规范变体位：0x0001 横线（否则斜线）、0x0002 左下→右上斜线、
        0x0004 左上→右下斜线。变体 0 当作默认的横线（与 tvST_HORIZ 同义）。"""
        var = t.variation
        if var & ~0x0007:
            return self.fail("tmSTRIKE 变体 0x%04X 有未知位" % var)
        parts = self.slot_texts(t)
        if len(parts) != 1:
            return self.fail("tmSTRIKE 槽位数应为 1，实际 %d" % len(parts))
        if not parts[0]:
            return self.fail("tmSTRIKE 内容槽为空")
        if var in (0x0000, 0x0001):             # 横线
            return r"\sout{%s}" % parts[0]
        up = bool(var & 0x0002)
        down = bool(var & 0x0004)
        if up and down:
            return r"\xcancel{%s}" % parts[0]
        if down:
            return r"\bcancel{%s}" % parts[0]
        return r"\cancel{%s}" % parts[0]

    # 方框（TBoxBox）：只有整框才用 \boxed
    def box(self, t) -> str:
        """规范变体位：0x0001 圆角（否则方角）、0x0002/0x0004/0x0008/0x0010
        分别表示左/右/上/下四条边存在。缺边的框与圆角框没有对应写法，退回预览图；
        四边位全不标时也当整框（与“标全”同义，变体 0 是默认情形）。"""
        var = t.variation
        if var & ~0x001F:
            return self.fail("tmBOX 变体 0x%04X 有未知位" % var)
        parts = self.slot_texts(t)
        if len(parts) != 1:
            return self.fail("tmBOX 槽位数应为 1，实际 %d" % len(parts))
        if not parts[0]:
            return self.fail("tmBOX 内容槽为空")
        if var & 0x0001:
            return self.fail("tmBOX 圆角方框（变体 0x%04X）未实现" % var)
        if (var & 0x001E) not in (0x0000, 0x001E):
            return self.fail("tmBOX 缺边方框（变体 0x%04X）未实现" % var)
        return r"\boxed{%s}" % parts[0]

    # 围栏：只有主槽（内容），括号字符由模板给出
    def fence(self, t, sel: str) -> str:
        left_glyph, right_glyph = FENCES[sel]
        has_left = bool(t.variation & FENCE_LEFT)
        has_right = bool(t.variation & FENCE_RIGHT)
        if not has_left and not has_right:
            return self.fail("围栏 %s 变体 0x%04X 没标出哪一侧存在" % (sel, t.variation))
        left = left_glyph if has_left else "."
        right = right_glyph if has_right else "."
        lines = self.slot_lines(t)
        if not lines:
            return self.fail("%s 没有内容槽" % sel)
        inner = join([self.line_text(x) for x in lines])
        if not inner:
            return ""
        return r"\left%s %s \right%s" % (left, inner, right)

    # 上下标：tmSUB 下标槽在前；tmSUP 上标槽在后；tmSUBSUP 先下标后上标
    def script(self, t, sel: str) -> str:
        lines = self.slot_lines(t)
        parts = [self.line_text(x) for x in lines]
        if "tmSUB" == sel:
            sub, up = (parts[0] if parts else ""), ""
        elif "tmSUP" == sel:
            sub = ""
            up = parts[1] if len(parts) > 1 else (parts[0] if parts else "")
        elif "tmSUBSUP" == sel:
            if len(parts) != 2:
                return self.fail("tmSUBSUP 槽位数应为 2，实际 %d" % len(parts))
            sub, up = parts[0], parts[1]
        else:
            return self.fail("未知的上下标模板 %s" % sel)
        if not sub and not up:
            return ""
        body = join(["_{%s}" % sub if sub else "", "^{%s}" % up if up else ""])
        if t.variation & 0x0001:    # tvSU_PRECEDES：脚本在底之前
            return "{%s}" % body
        return body

    def frac(self, t, sel: str) -> str:
        if t.variation & 0x0002:    # tvFR_SLASH：斜线分式，外观与 \\frac 不同
            return self.fail("未实现的斜线分式（tmFRACT 变体 0x%04X）" % t.variation)
        lines = self.slot_lines(t)
        if len(lines) != 2:
            return self.fail("%s 槽位数应为 2，实际 %d" % (sel, len(lines)))
        num, den = self.line_text(lines[0]), self.line_text(lines[1])
        if not num or not den:
            return self.fail("%s 有空槽" % sel)
        return r"\frac{%s}{%s}" % (num, den)

    # 根号：被开方槽在前、次数槽在后（与规范表格相反，见文件头）
    def root(self, t) -> str:
        lines = self.slot_lines(t)
        if len(lines) < 2:
            return self.fail("tmROOT 槽位数应为 2，实际 %d" % len(lines))
        radicand, degree = self.line_text(lines[0]), self.line_text(lines[1])
        if not radicand:
            return self.fail("tmROOT 被开方槽为空")
        if t.variation == 1:        # tvROOT_NTH
            if not degree:
                return self.fail("tnROOT 变体 1（n 次根）但次数槽为空")
            return r"\sqrt[%s]{%s}" % (degree, radicand)
        return r"\sqrt{%s}" % radicand

    # 大运算符：主槽、下限槽、上限槽（实测顺序）
    def bigop(self, t, sel: str) -> str:
        # tmINTOP / tmSUMOP：运算符本身在槽里（用户自选），其余槽是限位
        if sel in ("tmINTOP", "tmSUMOP"):
            return self.bigop_generic(t, sel)
        lines = self.slot_lines(t)
        if not lines:
            return self.fail("%s 没有内容槽" % sel)
        var = t.variation
        if sel == "tmINTEG":
            count = var & INT_COUNT
            if count not in INTEG_NAMES:
                return self.fail("tmINTEG 重数 0x%X 不认识（变体 0x%04X）" % (count, var))
            if var & INT_LOOP or var & INT_CW or var & INT_CCW:
                cmd = BIGOPS["tmINTEG"][1][count]
                if cmd is None:
                    return self.fail("tmINTEG 圈线积分重数 %d 没有对应写法" % count)
            else:
                cmd = INTEG_NAMES[count]
        else:
            cmd = BIGOPS[sel][0]
            if cmd is None:
                return self.fail("未实现的大运算符 %s" % sel)
        main = self.line_text(lines[0])
        roles = []
        if var & BO_LOWER:
            roles.append("l")
        if var & BO_UPPER:
            roles.append("u")
        rest = [self.line_text(x) for x in lines[1:]]
        rest = [x for x in rest if x]
        if len(rest) != len(roles):
            return self.fail("%s 限位槽 %d 个，变体标出 %d 个"
                             % (sel, len(rest), len(roles)))
        low = up = ""
        for role, text in zip(roles, rest):
            if role == "l":
                low = text
            else:
                up = text
        # 摆放：BO_SUM 是总和式（限位叠在上下），否则积分式（限位在两侧）。
        # 常规 LaTeX 里 \\sum 本来就叠上下、\\int 本来就在两侧，只有反着来才要显式标注。
        integral_style = bool(BIGOPS[sel][2]) if sel == "tmINTEG" else not (var & BO_SUM)
        placement = ""
        if integral_style and (var & BO_SUM):
            placement = r"\limits"
        elif not integral_style and not (var & BO_SUM):
            placement = r"\nolimits"
        op = "%s%s%s%s" % (cmd, placement,
                           "_{%s}" % low if low else "",
                           "^{%s}" % up if up else "")
        return join([op, main])

    # 通用大运算符（tmINTOP / tmSUMOP）：运算符槽不是 LINE，限位槽是 LINE。
    # 不靠猜槽位顺序——按记录类型分。摆放按变体位强制写出（\limits / \nolimits），
    # 因为运算符的数学类（决定默认摆放）事先不知道。
    def bigop_generic(self, t, sel: str) -> str:
        ops = [x for x in t.slots
               if not isinstance(x, (m5.LineRec, m5.ColorRec))]
        if len(ops) != 1:
            return self.fail("%s 的运算符槽 %d 个（应为 1）" % (sel, len(ops)))
        op = self.record(ops[0])
        if not op:
            return self.fail("%s 运算符槽为空" % sel)
        var = t.variation
        roles = []
        if var & BO_LOWER:
            roles.append("l")
        if var & BO_UPPER:
            roles.append("u")
        rest = [x for x in (self.line_text(l) for l in self.slot_lines(t)) if x]
        if len(rest) != len(roles):
            return self.fail("%s 限位槽 %d 个，变体标出 %d 个" % (sel, len(rest), len(roles)))
        low = up = ""
        for role, text in zip(roles, rest):
            if role == "l":
                low = text
            else:
                up = text
        placement = r"\limits" if (var & BO_SUM) else r"\nolimits"
        return "%s%s%s%s" % (op, placement,
                              "_{%s}" % low if low else "",
                              "^{%s}" % up if up else "")

    # 极限：主槽、下限槽、上限槽；主槽是已知算符名就摆成 _{}^{}
    def limits(self, t) -> str:
        lines = self.slot_lines(t)
        if not lines:
            return self.fail("tmLIM 没有内容槽")
        var = t.variation
        main = self.line_text(lines[0])
        roles = []
        if var & BO_LOWER:
            roles.append("l")
        if var & BO_UPPER:
            roles.append("u")
        rest = [self.line_text(x) for x in lines[1:]]
        rest = [x for x in rest if x]
        if len(rest) != len(roles):
            return self.fail("tmLIM 限位槽 %d 个，变体标出 %d 个" % (len(rest), len(roles)))
        low = up = ""
        for role, text in zip(roles, rest):
            if role == "l":
                low = text
            else:
                up = text
        if not low and not up:
            return main
        if main in LIM_OPS:
            return "%s%s%s" % (main,
                               "_{%s}" % low if low else "",
                               "^{%s}" % up if up else "")
        out = main
        if low:
            out = r"\underset{%s}{%s}" % (low, out)
        if up:
            out = r"\overset{%s}{%s}" % (up, out)
        return out

    # ── 堆叠与矩阵 ─────────────────────────────────────────

    def pile(self, p) -> str:
        rows = [self.line_text(x) for x in p.lines if isinstance(x, m5.LineRec)]
        rows = [r for r in rows if r]
        if not rows:
            return ""
        if len(rows) == 1:
            return rows[0]
        return r"\begin{gathered} %s \end{gathered}" % r" \\ ".join(rows)

    def matrix(self, m) -> str:
        """矩阵内容。

        用 matrix 而不是 bmatrix：MTEF 里矩阵本身不带分隔符，那对括号来自外面的围栏
        （tmBRACK 之类），再自带一对会叠成两对。空矩阵（数据里会出现 1x1 的占位）不输出。
        """
        cells = [self.line_text(x) for x in m.resolved_cells]
        if not any(cells):
            return ""
        if m.cell_count_anomaly:
            return self.fail("矩阵单元数 %d != %dx%d"
                             % (len(cells), m.rows, m.cols))
        cols = max(1, int(m.cols))
        rows = []
        for i in range(0, len(cells), cols):
            rows.append(" & ".join(cells[i:i + cols]))
        return r"\begin{matrix} %s \end{matrix}" % r" \\ ".join(rows)


def _braces_balanced(s: str) -> bool:
    depth = 0
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return False
        i += 1
    return depth == 0


def render(eq) -> Tuple[Optional[str], List[str]]:
    """渲染一个 MTEF v5 公式。返回 (latex 或 None, 说明)。"""
    r = Renderer()
    body = r.records(eq.records, in_line=False)
    if r.size_depth:
        body += "}" * r.size_depth
        r.size_depth = 0
    if not r.ok:
        return None, list(r.notes)
    body = " ".join(body.split())
    if not body:
        return None, ["渲染结果为空"]
    if body.count(r"\left") != body.count(r"\right"):
        return None, ["\\left 与 \\right 不配对：%d vs %d"
                      % (body.count(r"\left"), body.count(r"\right"))]
    if not _braces_balanced(body):
        return None, ["花括号不配对"]
    return body, []


def render_equation(eq) -> Optional[str]:
    latex, _ = render(eq)
    return latex


# ── 自测 ──────────────────────────────────────────────────────────────

import os as _os      # 只用来把样本路径算成相对模块位置，不放任何绝对路径

SAMPLES_DIR = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "samples")
# 语料走查看 samples/corpus/：仓库里不带，所以平时是跳过。想跑就把语料文件丢进那个
# 目录，不用改代码，也没有任何环境变量。
CORPUS_DIR = _os.path.join(SAMPLES_DIR, "corpus")


def _corpus_files():
    """不问名字，把 CORPUS_DIR 下的 docx/pptx 全扫一遍。"""
    import glob as _glob
    if not _os.path.isdir(CORPUS_DIR):
        return []
    out = []
    for ext in ("*.docx", "*.pptx"):
        out.extend(_os.path.basename(p)
                   for p in sorted(_glob.glob(_os.path.join(CORPUS_DIR, ext))))
    return out
CORPUS_FILES = _corpus_files()
# 基准（v5 对象数, 渲染成功数）。语料是私人的、不进仓库，所以默认不设基准：
# 只报告数字，不判定通过与否。
CORPUS_EXPECTED = None
# 规范范例应渲染出的式子（二次方程）
EXAMPLE_EXPECT = r"\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}"
# 范例渲染结果里必须出现、且必须不出现的片段
EXAMPLE_MUST = [r"\frac{", r"\sqrt{", "b^{2}"]
EXAMPLE_MUST_NOT = ["_{2}", "array", r"\left"]


def _native_streams(path):
    import io
    import os
    import zipfile

    try:
        import olefile
    except ImportError:
        return
    names = ("Equation Native", "EquationNative", "Equation")
    with zipfile.ZipFile(path) as z:
        members = [n for n in z.namelist()
                   if n.endswith(".bin") and "/embeddings/" in n]
        members.sort(key=lambda s: int("".join(c for c in os.path.basename(s)
                                               if c.isdigit()) or 0))
        for name in members:
            try:
                ole = olefile.OleFileIO(io.BytesIO(z.read(name)))
            except Exception:
                continue
            raw = None
            try:
                for entry in ole.listdir():
                    full = "/".join(entry)
                    if full.split("/")[-1].strip("\x01") in names:
                        raw = ole.openstream(full).read()
                        break
            finally:
                ole.close()
            if raw and len(raw) > 29 and raw[28] == 5:
                yield os.path.basename(name), raw


def _corpus_report(baseline=None) -> int:
    import os

    if not os.path.isdir(CORPUS_DIR):
        print("语料目录不存在，跳过：%s" % CORPUS_DIR)
        return 2

    total = 0
    rendered = 0
    reasons = Counter()
    bad_balance = 0
    use_array = 0
    samples = []
    for fname in CORPUS_FILES:
        path = os.path.join(CORPUS_DIR, fname)
        if not os.path.exists(path):
            print("  缺文件：%s" % fname)
            continue
        for member, raw in _native_streams(path):
            total += 1
            cb = int.from_bytes(raw[8:12], "little")
            try:
                eq = m5.parse(raw[28:28 + cb])
            except Exception as exc:
                reasons["解析异常 %s" % type(exc).__name__] += 1
                continue
            latex, notes = render(eq)
            if latex is None:
                reasons[(notes[0] if notes else "无说明")[:60]] += 1
                continue
            rendered += 1
            if latex.count(r"\left") != latex.count(r"\right"):
                bad_balance += 1
            if r"\begin{array}" in latex:
                use_array += 1
            if len(samples) < 8:
                samples.append((member, latex[:110]))

    print("语料：%s" % CORPUS_DIR)
    print("v5 对象 %d 个，渲染出 LaTeX %d 个，退回 %d 个"
          % (total, rendered, total - rendered))
    print("\\left 与 \\right 不配对 %d 个，用 array %d 个" % (bad_balance, use_array))
    if reasons:
        print("退回原因：")
        for why, n in reasons.most_common(12):
            print("  %3d  %s" % (n, why))
    print("样例：")
    for member, latex in samples:
        print("  %-18s %s" % (member, latex))
    if baseline is None:
        print("结论：尚未填基准（第一次跑通后把上面两个数填进 CORPUS_EXPECTED）")
        return 0
    want_total, want_rendered = baseline
    ok = (total == want_total and rendered == want_rendered
          and bad_balance == 0 and use_array == 0)
    print("结论：%s" % ("通过" if ok else "不通过（渲染质量有变化，请人工核对）"))
    return 0 if ok else 1


REAL_SAMPLE = _os.path.join(SAMPLES_DIR, "公式测试.docx")
# 值 = 期望的 LaTeX；None = 这个对象本身是空的（退回预览图）
REAL_SAMPLE_EXPECTED = {
    1: None,
    2: r"\begin{gathered} \vec{v} \\ \overline{ABC} \end{gathered}",
    3: None,
    4: r"\widehat{ABC}",
    5: r"\overbrace{a+b+c}/\underbrace{a+b+c}",
    6: r"\overrightarrow{AB}",
    7: r"\overleftarrow{v}",
    8: r"\cancel{x+y}",
    9: r"\cancel{x+y}",
    10: r"\xrightarrow{f}",
    11: r"\xleftarrow{f}",
}


def _real_sample_report() -> int:
    """跑真机样本：用户用 MathType 7 手写、并逐张对过预览图的那 11 道。

    这是唯一一份「人写式子 + MathType 亲笔」的数据，价值高于语料；改任何解析或渲染
    逻辑都应该过这一关。文件不在了就跳过并返回 2，不会假通过。
    """
    import zipfile
    if not _os.path.exists(REAL_SAMPLE):
        print("真机样本不在，跳过：%s" % REAL_SAMPLE)
        return 2
    bad = 0
    with zipfile.ZipFile(REAL_SAMPLE) as z:
        names = sorted((n for n in z.namelist()
                        if "/embeddings/" in n and n.lower().endswith(".bin")),
                       key=lambda s: int("".join(c for c in os.path.basename(s)
                                                if c.isdigit()) or 0))
        for name in names:
            num = int("".join(c for c in os.path.basename(name) if c.isdigit()))
            want = REAL_SAMPLE_EXPECTED.get(num, "?")
            try:
                got = render(m5.parse_equation_native(
                    m5.extract_native_stream(z.read(name))))[0]
            except Exception as exc:
                got = "异常 %r" % exc
            if got != want:
                print("失败：oleObject%d 得到 %r，期望 %r" % (num, got, want))
                bad += 1
    print("真机样本：%d 个对象，%d 个不符" % (len(REAL_SAMPLE_EXPECTED), bad))
    return 1 if bad else 0


def _coverage_test() -> bool:
    """新增覆盖的模板类与附饰逐条自测。

    这些构造在语料里一次都没出现，没有实测数据；断言的是「按规范写出来的形状能正确
    渲染、未实现的变体确实被闸门挡住」。槽位顺序与变体位依据见各方法注释。
    返回 True 表示全部符合预期。
    """
    def ch(s, tf=3):
        return m5.CharRec(typeface=tf, mt_code=ord(s))

    def line(*objs):
        return m5.LineRec(objects=list(objs))

    def tm(idx, var, *slots):
        return Renderer().tmpl(m5.TmplRec(selector_index=idx, variation=var,
                                          slots=list(slots)))

    def emb(code, base):
        return Renderer().embell_accents(code, base)

    T_INTV, T_UBAR, T_OBAR, T_ARROW = 9, 12, 13, 14
    T_INTOP, T_SUMOP, T_HBRACE, T_HBRACK = 21, 22, 24, 25
    T_DIRAC, T_VEC, T_TILDE, T_HAT = 30, 31, 32, 33
    T_ARC, T_JSTATUS, T_STRIKE, T_BOX = 34, 35, 36, 37
    LO, UP, SUM = 0x0010, 0x0020, 0x0040

    cases = [
        ("下划线", tm(T_UBAR, 0, line(ch("a"))), r"\underline{a}"),
        ("上划线", tm(T_OBAR, 0, line(ch("x"))), r"\overline{x}"),
        ("上划线双线", tm(T_OBAR, 0x0001, line(ch("x"))),
         r"\overline{\overline{x}}"),
        ("箭头右上标签", tm(T_ARROW, 0x0024, line(ch("f")), line()),
         r"\xrightarrow{f}"),
        ("箭头左上标签", tm(T_ARROW, 0x0014, line(ch("f")), line()),
         r"\xleftarrow{f}"),
        ("箭头双向带标签", tm(T_ARROW, 0x0034, line(ch("f")), line()),
         r"\xleftrightarrow{f}"),
        ("箭头右下标签", tm(T_ARROW, 0x002C, line(ch("f")), line(ch("x"))),
         r"\xrightarrow[x]{f}"),
        ("向量单字", tm(T_VEC, 0, line(ch("v"))), r"\vec{v}"),
        ("向量单字指右", tm(T_VEC, 0x0002, line(ch("v"))), r"\vec{v}"),
        ("向量多字", tm(T_VEC, 0, line(ch("a"), ch("b"))),
         r"\overrightarrow{ab}"),
        ("向量指左", tm(T_VEC, 0x0001, line(ch("v"))), r"\overleftarrow{v}"),
        ("向量在下", tm(T_VEC, 0x0004, line(ch("v"))), r"\underrightarrow{v}"),
        ("向量半箭", tm(T_VEC, 0x0008, line(ch("v"))),
         r"\overset{\rightharpoonup}{v}"),
        ("波浪号", tm(T_TILDE, 0, line(ch("x"))), r"\tilde{x}"),
        ("宽波浪号", tm(T_TILDE, 0, line(ch("x"), ch("y"))), r"\widetilde{xy}"),
        ("帽子", tm(T_HAT, 0, line(ch("x"))), r"\hat{x}"),
        ("宽帽子", tm(T_HAT, 0, line(ch("x"), ch("y"))), r"\widehat{xy}"),
        ("弧线", tm(T_ARC, 0, line(ch("x"))), r"\overset{\frown}{x}"),
        ("水平花括上", tm(T_HBRACE, 0x0001, line(ch("a"))), r"\overbrace{a}"),
        ("水平花括下", tm(T_HBRACE, 0x0000, line(ch("a"))), r"\underbrace{a}"),
        ("划掉线横线", tm(T_STRIKE, 0, line(ch("x"))), r"\sout{x}"),
        ("划掉线斜线", tm(T_STRIKE, 0x0002, line(ch("x"))), r"\cancel{x}"),
        ("划掉线双斜", tm(T_STRIKE, 0x0006, line(ch("x"))), r"\xcancel{x}"),
        ("方框", tm(T_BOX, 0, line(ch("x"))), r"\boxed{x}"),
        ("狄拉克两槽", tm(T_DIRAC, 0, line(ch("a")), line(ch("b"))),
         r"\left\langle a \middle| b \right\rangle"),
        ("狄拉克单槽", tm(T_DIRAC, 0, line(ch("a"))), "a"),
        ("区间圆括", tm(T_INTV, 0x0010, line(ch("a"))), r"\left( a \right)"),
        ("区间错配", tm(T_INTV, 0x0003 | 0x0010, line(ch("a"))),
         r"\left] a \right)"),
        ("通用大算子总和式",
         tm(T_SUMOP, LO | UP | SUM, ch("S"), line(ch("i")), line(ch("n"))),
         r"S\limits_{i}^{n}"),
        ("通用大算子积分式",
         tm(T_INTOP, LO | UP, ch("I"), line(ch("a")), line(ch("b"))),
         r"I\nolimits_{a}^{b}"),
        ("附饰过右箭头单字", emb(11, "v"), r"\vec{v}"),
        ("附饰过右箭头多字", emb(11, "ab"), r"\overrightarrow{ab}"),
        ("附饰过左箭头", emb(12, "x"), r"\overleftarrow{x}"),
        ("附饰过双向箭头", emb(13, "x"), r"\overleftrightarrow{x}"),
        ("附饰右半箭", emb(14, "x"), r"\overset{\rightharpoonup}{x}"),
        ("附饰单点（原有）", emb(2, "x"), r"\dot{x}"),
    ]
    gates = [
        ("箭头双线", tm(T_ARROW, 0x0001, line(ch("v")))),
        ("箭头只有下标签槽", tm(T_ARROW, 0x0028, line(ch("v")), line())),
        ("箭头没标方向", tm(T_ARROW, 0x0000, line(ch("v")))),
        ("向量双向半箭", tm(T_VEC, 0x000B, line(ch("v")))),
        ("方框缺边", tm(T_BOX, 0x001A, line(ch("x")))),
        ("方框圆角", tm(T_BOX, 0x001F, line(ch("x")))),
        ("接头状态", tm(T_JSTATUS, 0, line(ch("x")))),
        ("水平方括号", tm(T_HBRACK, 0x0001, line(ch("a")))),
        ("附饰斜杠穿过", emb(10, "x")),
        ("附饰反向撇号", emb(7, "x")),
    ]

    print("── 新增覆盖（模板类 / 附饰）──")
    bad = 0
    for label, got, want in cases:
        if got != want:
            print("失败：%s 得到 %r，期望 %r" % (label, got, want))
            bad += 1
    for label, got in gates:
        if got != "":
            print("失败：%s 本该退回预览图，却给出 %r" % (label, got))
            bad += 1
    total = len(cases) + len(gates)
    print("共 %d 项，%d 项不符" % (total, bad))
    return bad == 0


def self_test() -> int:
    ok = True

    print("── 规范范例：二次方程 ──")
    eq = m5.parse(m5.spec_example())
    latex, notes = render(eq)
    got = latex or ""
    print("渲染结果：%s" % (got or "（无）"))
    want = " ".join(EXAMPLE_EXPECT.split())
    if " ".join(got.split()) != want:
        # 只把不同处点出来，别把整串都当成未知
        print("注意：与规范式子的写法有出入（规范写法 %s）" % want)
    for piece in EXAMPLE_MUST:
        if piece not in got:
            print("失败：结果里没有 %r" % piece)
            ok = False
    for piece in EXAMPLE_MUST_NOT:
        if piece in got:
            print("失败：结果里不该出现 %r" % piece)
            ok = False
    if notes:
        print("失败：渲染有说明 %s" % notes)
        ok = False
    print("范例结论：%s" % ("通过" if ok else "不通过"))

    print()
    if not _coverage_test():
        ok = False

    print()
    print("── 真机样本（人写式子 + MathType 亲笔）──")
    if _real_sample_report() == 1:
        ok = False

    print()
    print("── 语料 ──")
    rc = _corpus_report(CORPUS_EXPECTED)
    if rc == 2:
        return 0 if ok else 1
    return 0 if (ok and rc == 0) else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv:
        sys.exit(self_test())

    if "--example" in sys.argv:
        eq = m5.parse(m5.spec_example())
        latex, notes = render(eq)
        print(latex or "（渲染失败：%s）" % notes)
        sys.exit(0)

    print(__doc__)
    print("用法：")
    print("  python mtef_v5_latex.py --selftest    跑范例与语料自测")
    print("  python mtef_v5_latex.py --example     渲染规范范例")
