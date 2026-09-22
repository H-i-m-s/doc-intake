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


def join(parts: List[str]) -> str:
    out: List[str] = []
    for s in parts:
        if not s:
            continue
        if out and _needs_gap(out[-1], s):
            out.append(" ")
        out.append(s)
    return "".join(out)


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
            return self.fail("未实现的模板 tmINTERVAL（单边区间，变体位含义未实测）")
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
        return self.fail("未实现的模板 %s（类 %s，变体 0x%04X）" % (sel, cls, t.variation))

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

CORPUS_DIR = r"D:\Agent\各种类型文件"
CORPUS_FILES = [
    "公式图表测试.pptx",
    "这是一个公式测试文件.docx",
    "复杂—翻车机公式及表格图片处理.docx",
    "翻转课堂计算报告带公式.docx",
    "01 毕业论文：波浪适应救助船结构设计与平顺性分析_李杨.docx",
]
# 第一次跑通后填：(v5 对象数, 渲染成功数)
CORPUS_EXPECTED = (165, 165)
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
