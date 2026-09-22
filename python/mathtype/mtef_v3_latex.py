# -*- coding: utf-8 -*-
"""把 MTEF v3 记录树渲染成 LaTeX。

配合 python/mathtype/mtef_v3.py 使用：那个模块按官方规范把字节解成记录树，这里
按规范「Template Subobject Order」把记录树翻成 LaTeX。

为什么不复用旧的 mtef.py 的 makeLatex（该模块已删除）
----------------------------------------------------
1. 它按 v5 的选择子编号分派（tmROOT=10、tmFRACT=11、tmSUB=27…），v3 是另一套
   （13 根号、14 分式、15/44 上下标）；在它里面加 v3 分支会把两套编号糅进同一
   个函数。
2. 它渲染矩阵用 \\begin{array}{}，行列分隔靠 cols 整除，输出本就偏糙。
3. 它假定 ast.children 按 v5 的槽位顺序排布，而 v3 的槽位里混着 SUB / FULL
   这类标记记录。

槽位顺序（依据实测，与规范正文有两处出入，均已核对）
--------------------------------------------------
规范给的是「类 -> 子对象顺序」，实际字节里槽位位置是固定的，空槽以 xfNULL 的
LINE 占位。用 30 个真实对象核对后采用下表：

- 围栏 ParBox：主槽位、左围栏字符、右围栏字符。括号由模板自带，不裁切。
- 大运算符 BigOp：**主槽位、下槽位、上槽位、运算符字符**。规范正文写作
  「upper slot, lower slot」，但 obj11（tmSUM var=1，上下限都有）的字节顺序是
  「i=2」在前、「N」在后；obj21（tmSUM var=0，只有下限）的下限落在第 1 位，
  两句都指向「下限在前」。
- 极限 LimBox：主槽位、下槽位、上槽位（obj3 的 tmLIM var=0 是「只带上限」，
  取值落在第 3 个槽，与此一致）。
- 上下标 ScrBox：下标槽位、上标槽位；**底不是子对象**，是它前面那个字符，
  所以脚本渲染成后缀（前置上下标 44 渲染成前缀）。
- 分式 FracBox、斜线分式 SlashBox：分子槽位、分母槽位。
- 根号 RootBox：主槽位（次数）、被开方槽位。
- 上下划线 BarBox、向量 VectorBox、弧 ArcBox：主槽位。
- 括号箭头 ArroBox：主槽位、箭头字符；水平花括号 HBrBox：主槽位、小槽位、花括号。
- 长除 LDivBox：被除槽位、商槽位。LaTeX 没有对应写法，直接退让。

下限/上限的数量由 variation 决定（规范里的 tvXXX 变体表），空槽会以 xfNULL 的
LINE 出现，所以按 variation 给出该有的角色序列，再按顺序取非空槽。

函数名（fnFUNCTION 风格）
------------------------
规范的 CHAR 选项位 0x1 是 xfAUTO，但实测字母几乎都带这一位（语料 904 个字符里 349
个），所以它认不出函数名。改用字体风格：typeface=2（fnFUNCTION）的字符才是函数名的
组成部分。v3 语料里这样的连续字母只有 log（24 次）和 lim（1 次），此前按斜体字母串
渲染（-logP(x)、lim 斜体），与预览图里的正体不符。现在凑成词，命中已知算符就出
\log、\lim，其余按正体文本处理。

括号也可能带这一风格（MathType 把函数参数的分隔符也标上），所以只认字母；非字母的
fnFUNCTION 字符照常按符号表渲染。

字体风格字段本身
--------------
解析器存的 typeface 已经去过偏置，渲染器早先又减了一遍 128，于是 fnTEXT 的正体包裹
与「/mathmode 优先查找」都没生效（⋅、≤、× 这类只在 mathmode 表里有条目的符号退化
成原样 Unicode）。已改成直接用 c.typeface。

硬闸：任何一条不满足就返回 None，由调用方退回公式预览图——
- 遇到没实现的模板 / 附饰：不猜；
- 矩阵单元数与行列数不符：不渲染；
- \\left 与 \\right 不配对：结构没理清；
- 花括号不配对：出过错（x_{i) 那批），宁可给图。
宁可给一张对的图，不给一段错的 LaTeX。
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

try:  # 包内导入（python/mathtype 作为包被引用时）
    from .chars import Chars, SpecialChar
except ImportError:  # 扁平导入（mathtype_converter 把 python/mathtype 加进了 sys.path）
    from chars import Chars, SpecialChar

__all__ = ["render", "render_equation", "self_test"]

# 自测基准：样本公式（Equation.3）渲染结果应与它的兜底预览图逐项一致
EXPECTED_LATEX = (
    r"\begin{gathered} "
    r"\left[ \begin{matrix} X \\ P(x) \end{matrix} \right]="
    r"\left[ \begin{matrix} a_{1} & a_{2} \\ 0.01 & 0.99 \end{matrix} \right] \\ "
    r"\left[ \begin{matrix} Y \\ P(y) \end{matrix} \right]="
    r"\left[ \begin{matrix} b_{1} & b_{2} \\ 0.4 & 0.6 \end{matrix} \right] \\ "
    r"\left[ \begin{matrix} Z \\ P(z) \end{matrix} \right]="
    r"\left[ \begin{matrix} c_{1} & c_{2} \\ 0.5 & 0.5 \end{matrix} \right] "
    r"\end{gathered}"
)

# 围栏类：选择子 -> (左, 右)。variation 1 只留左、2 只留右（另一半写 '.'）
FENCES = {
    "tmANGLE": (r"\langle", r"\rangle"),
    "tmPAREN": ("(", ")"),
    "tmBRACE": (r"\{", r"\}"),
    "tmBRACK": ("[", "]"),
    "tmBAR": ("|", "|"),
    "tmDBAR": (r"\|", r"\|"),
    "tmFLOOR": (r"\lfloor", r"\rfloor"),
    "tmCEILING": (r"\lceil", r"\rceil"),
    "tmLBLB": (r"\{", r"\{"),
    "tmRBRB": (r"\}", r"\}"),
    "tmRBLB": (r"\}", r"\{"),
    "tmLBRP": (r"\{", "("),
    "tmLPRB": ("(", r"\{"),
}

# 大运算符：选择子 -> (LaTeX 命令, 变体 -> 该有的限角色, 上下摆?)。None 表示用
# 槽位里的运算符字符本身（tmINTOP / tmSUMOP 是用户自选的符号）。
# 角色：l = 下限，u = 上限。上下摆=True 时加 \limits（「总和式」，限位叠在上下），
# False 时加 \nolimits（「积分式」，限位摆在左右）。
BIGOPS: Dict[str, Tuple[Optional[str], Dict[int, Tuple[str, ...]], bool]] = {
    "tmSINT":   (r"\int",  {0: (), 1: ("l",), 2: ("l", "u"), 3: (), 4: ("l",)}, False),
    "tmDINT":   (r"\iint", {0: (), 1: ("l",), 2: (), 3: ("l",)}, False),
    "tmTINT":   (r"\iiint", {0: (), 1: ("l",), 2: (), 3: ("l",)}, False),
    "tmSSINT":  (r"\int",  {0: ("l", "u"), 1: ("l",), 2: ("l",)}, True),
    "tmDSINT":  (r"\iint", {0: ("l",), 1: ("l",)}, True),
    "tmTSINT":  (r"\iiint", {0: ("l",), 1: ("l",)}, True),
    "tmSUM":    (r"\sum",  {0: ("l",), 1: ("l", "u"), 2: ()}, True),
    "tmISUM":   (r"\sum",  {0: ("l",), 1: ("l", "u")}, False),
    "tmPROD":   (r"\prod", {0: ("l",), 1: ("l", "u"), 2: ()}, True),
    "tmIPROD":  (r"\prod", {0: ("l",), 1: ("l", "u")}, False),
    "tmCOPROD": (r"\coprod", {0: ("l",), 1: ("l", "u"), 2: ()}, True),
    "tmICOPROD": (r"\coprod", {0: ("l",), 1: ("l", "u")}, False),
    "tmUNION":  (r"\bigcup", {0: ("l",), 1: ("l", "u"), 2: ()}, True),
    "tmIUNION": (r"\bigcup", {0: ("l",), 1: ("l", "u")}, False),
    "tmINTER":  (r"\bigcap", {0: ("l",), 1: ("l", "u"), 2: ()}, True),
    "tmIINTER": (r"\bigcap", {0: ("l",), 1: ("l", "u")}, False),
    "tmINTOP":  (None, {0: ("u",), 1: ("l",), 2: ("l", "u")}, False),
    "tmSUMOP":  (None, {0: ("u",), 1: ("l",), 2: ("l", "u")}, True),
}
# 围道积分：变体 3/4（单积分）、2（双积分）、2（三积分）换成围道符号
CONTOUR = {"tmSINT": 3, "tmDINT": 2, "tmTINT": 2}
CONTOUR_CMD = {"tmSINT": r"\oint", "tmDINT": r"\oiint", "tmTINT": r"\oiiint"}

# 极限：变体 -> 限角色（只有上、只有下、两个都有）
LIM_ROLES = {0: ("u",), 1: ("l",), 2: ("l", "u")}
# 极限的名字：主槽位里是字面文本（l、i、m 三个字符），转成 LaTeX 算符
LIM_OPS = {"lim": r"\lim", "max": r"\max", "min": r"\min", "sup": r"\sup",
           "inf": r"\inf", "det": r"\det", "gcd": r"\gcd"}

# 附饰（EMBELL 记录）。码位表见规范「EMBELL record」。
EMBELLS = {
    2: r"\dot", 3: r"\ddot", 4: r"\dddot",
    5: "'", 6: "''", 18: "'''",
    8: r"\tilde", 9: r"\hat",
    16: r"\bar", 17: r"\overline",
    19: r"\frown", 20: r"\smile",
}
EMBELL_INLINE = {5, 6, 18}  # 撇号是后缀，不是包裹

# 函数名：fnFUNCTION 风格的连续字母凑成词，命中就出算符（顺带把间距交给 LaTeX）。
# 实测 v3 语料里只有 log（24 次）和 lim（1 次）两串。
FUNC_OPS = {
    "sin": r"\sin", "cos": r"\cos", "tan": r"\tan", "cot": r"\cot",
    "sec": r"\sec", "csc": r"\csc", "arcsin": r"\arcsin", "arccos": r"\arccos",
    "arctan": r"\arctan", "sinh": r"\sinh", "cosh": r"\cosh", "tanh": r"\tanh",
    "log": r"\log", "ln": r"\ln", "lg": r"\lg", "exp": r"\exp",
    "lim": r"\lim", "max": r"\max", "min": r"\min", "sup": r"\sup",
    "inf": r"\inf", "det": r"\det", "gcd": r"\gcd", "deg": r"\deg",
    "dim": r"\dim", "ker": r"\ker", "arg": r"\arg", "mod": r"\bmod",
    "Pr": r"\Pr",
}

MARKER_NAMES = {"MarkerRec", "FutureRec", "FontRec", "SizeRec"}
# 字号标记：FULL / SUB / SUB2 -> 目标层级（SUB2 是下下标的字号）
SIZE_MARKERS = {10: 0, 11: 1, 12: 2}

_CMD_TAIL = re.compile(r"\\[a-zA-Z]+$")


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
        # 行内字号层级：SUB 开一层下标，SUB2 再开一层，FULL 全部收掉
        self.size_depth = 0

    def fail(self, why: str) -> str:
        if self.ok:
            self.notes.append(why)
        self.ok = False
        return ""

    # ── 调度 ───────────────────────────────────────────────

    def records(self, recs) -> str:
        """渲染一串记录。

        字号标记（FULL / SUB / SUB2）在这里处理：它们是行内状态，不止改变字号，
        还带基线下降，所以落成 LaTeX 的嵌套下标。实测依据：obj4 的预览图里
        `I(x` `SUB` `i` `)` 显示成下降的小 i（$I(x_i)$），而不是平排的 xi。
        """
        out: List[str] = []
        i = 0
        n = len(recs)
        while i < n:
            r = recs[i]
            rt = getattr(r, "record_type", None)
            if type(r).__name__ == "MarkerRec" and rt in SIZE_MARKERS:
                target = SIZE_MARKERS[rt]
                while self.size_depth > target:
                    out.append("}")
                    self.size_depth -= 1
                while self.size_depth < target:
                    out.append("_{")
                    self.size_depth += 1
                i += 1
                continue
            if type(r).__name__ == "CharRec" and self.is_func_letter(r):
                word, i = self.take_func_word(recs, i)
                out.append(self.func_word(word))
                continue
            out.append(self.record(r))
            i += 1
        return join(out)

    def record(self, r) -> str:
        name = type(r).__name__
        if name == "CharRec":
            return self.char(r)
        if name == "TmplRec":
            return self.tmpl(r)
        if name == "LineRec":
            return self.records(r.objects)
        if name == "PileRec":
            return self.pile(r)
        if name == "MatrixRec":
            return self.matrix(r)
        if name == "EmbellRec":
            code = getattr(r, "code", -1)
            return "" if code < 0 else self.embell_accents(code, "")
        if name in MARKER_NAMES:
            return ""  # FULL / SUB / SUB2 / SYM / SUBSYM / 字体 / 字号：不出内容
        return self.fail("未知记录类型 %s" % name)

    def slots(self, t) -> List[str]:
        """模板槽位渲染成非空字符串列表（按出现顺序）。"""
        return [s for s in (self.record(x) for x in t.slots) if s]

    # ── 函数名 ───────────────────────────────────────

    def is_func_letter(self, c) -> bool:
        """fnFUNCTION 风格（typeface=2）的字母。"""
        return (c.typeface == 2 and 0x20 <= c.mt_code < 0x7F
                and chr(c.mt_code).isalpha())

    def take_func_word(self, recs, i: int) -> Tuple[str, int]:
        """从 i 起取连续的 fnFUNCTION 字母，凑成一个词。"""
        word = []
        while i < len(recs):
            c = recs[i]
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

    # ── 字符 ───────────────────────────────────────────────

    @staticmethod
    def _symbol_keys(mtcode: int, typeface: int) -> List[str]:
        plain = "char/0x%04x" % mtcode
        mathmode = plain + "/mathmode"
        # 与 mtef_v5_latex 同口径：MTExtra / 空格风格先查 mathmode，其余先查原样。
        # 之前只查一个键，⋅、≤、×、∞ 这类只在 mathmode 表里有条目的符号会退化成原样
        # Unicode（渲染上不算错，但与 v5 侧不一致）。
        if typeface in (11, 24):
            return [mathmode, plain]
        return [plain, mathmode]

    def symbol(self, mtcode: int, typeface: int) -> str:
        for key in self._symbol_keys(mtcode, typeface):
            s = Chars.get(key)
            if s:
                return s
        ch = chr(mtcode)
        return SpecialChar.get(ch, ch)

    def char(self, c) -> str:
        if c.typeface == 22:
            # fnEXPAND：可拉伸的括号/大运算符字形，由模板自己输出
            return ""
        # 注意：解析器存的 typeface 已经去过偏置（int8()+128），这里不要再减 128。
        # 早先按原始字节处理，于是「fnTEXT 正体包裹」与「/mathmode 优先查找」两处都成了
        # 死代码：⋅、≤、× 这类只在 mathmode 表里有条目的符号会退化成原样 Unicode。
        text = self.symbol(c.mt_code, c.typeface)
        if c.typeface == 1:  # fnTEXT
            text = "{ \\rm{ %s } }" % text
        for e in c.embellishments or []:
            text = self.apply_embellishment(text, e)
        return text

    def apply_embellishment(self, base: str, e) -> str:
        name = type(e).__name__
        if name == "TmplRec" and getattr(e, "selector", "") in ("tmSUP", "tmSUB", "tmSUBSUP"):
            return join([base, self.tmpl(e)])
        if name == "EmbellRec":
            return self.embell_accents(getattr(e, "code", -1), base)
        return join([base, self.record(e)])

    def embell_accents(self, code: int, base: str) -> str:
        if code not in EMBELLS:
            return self.fail("未实现的附饰 code=%s" % code)
        fn = EMBELLS[code]
        if code in EMBELL_INLINE:
            return (base or "") + fn
        return "%s{%s}" % (fn, base)

    # ── 模板 ───────────────────────────────────────────────

    def tmpl(self, t) -> str:
        sel = getattr(t, "selector", "")
        var = getattr(t, "variation", 0)
        cls = getattr(t, "tmpl_class", "")

        if sel in FENCES:
            return self.fence(t, sel, var)
        if cls == "ScrBox":
            return self.script(t, sel, var)
        if cls == "BigOp":
            return self.bigop(t, sel, var)
        if sel == "tmLIM":
            return self.limits(t, LIM_ROLES.get(var, ()))
        if cls == "HBrBox":
            return self.hbrace(t, sel, var)
        if cls == "FracBox":
            return self.frac(t, sel, pre=r"\frac")
        if cls == "SlashBox":
            return self.frac(t, sel, pre=r"\frac")   # 斜线分式在 LaTeX 里也写 \frac
        if cls == "RootBox":
            return self.root(t, var)
        if cls == "BarBox":
            return self.bar(t, sel, var)
        if cls == "VectorBox":
            return self.vector(t, sel, var)
        if cls == "ArroBox":
            return self.arrow_box(t, sel, var)
        if cls == "DiracBox":
            return self.dirac(t, var)
        if cls == "ArcBox":
            parts = self.slots(t)
            return self.fail("未实现的模板 %s（变体 %s）" % (sel, var)) if not parts \
                else r"\overset{\frown}{%s}" % parts[0]
        return self.fail("未实现的模板 %s（类 %s，变体 %s）" % (sel or "?", cls or "?", var))

    # 围栏：主槽位、左围栏字符、右围栏字符
    def fence(self, t, sel: str, var: int) -> str:
        left_glyph, right_glyph = FENCES[sel]
        if var == 1:
            left, right = left_glyph, "."
        elif var == 2:
            left, right = ".", right_glyph
        else:
            left, right = left_glyph, right_glyph
        inner = self.slots(t)
        if not inner:
            return ""
        return r"\left%s %s \right%s" % (left, join(inner), right)

    # 上下标：下标槽位、上标槽位；底是前一个字符
    def script(self, t, sel: str, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return ""
        role = {"tmSUP": ("u",), "tmSUB": ("l",), "tmSUBSUP": ("l", "u")}.get(sel)
        if role is None:
            role = ("l", "u") if var == 2 else (("u",) if var == 0 else ("l",))
        low = up = None
        for r, s in zip(role, parts):
            if r == "l":
                low = s
            else:
                up = s
        body = "".join(["_{%s}" % low if low else "", "^{%s}" % up if up else ""])
        if getattr(t, "selector_index", 0) == 44:
            # 前置上下标：底在后面，用空组占位把脚本摆在前面
            return "{%s}" % body if body else ""
        return body

    # 大运算符：主槽位、下槽位、上槽位、运算符字符
    def bigop(self, t, sel: str, var: int) -> str:
        cmd, roles_table, use_limits = BIGOPS[sel]
        parts = self.slots(t)
        if not parts:
            return self.fail("%s 槽位为空" % sel)
        main, rest = parts[0], parts[1:]
        if cmd is None:
            # 运算符字符在最后一个槽位（用户自选的符号）
            if not rest:
                return self.fail("%s 缺运算符字符" % sel)
            op_char = rest[-1]
            rest = rest[:-1]
            cmd = r"\mathop{%s}" % op_char
        roles = roles_table.get(var, ())
        low = up = None
        for r, s in zip(roles, rest):
            if r == "l":
                low = s
            else:
                up = s
        # 围道积分换成围道符号
        if CONTOUR.get(sel) == var:
            cmd = CONTOUR_CMD[sel]
        limits = r"\limits" if use_limits else r"\nolimits"
        op = "%s%s%s%s" % (cmd, limits,
                           "_{%s}" % low if low else "",
                           "^{%s}" % up if up else "")
        # 用 join 拼接：上限下限都空时 op 以 \limits 结尾，必须补空格
        return join([op, main])

    # 极限：主槽位、下槽位、上槽位
    def limits(self, t, roles: Tuple[str, ...]) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("极限模板槽位为空")
        main, rest = parts[0], parts[1:]
        low = up = None
        for r, s in zip(roles, rest):
            if r == "l":
                low = s
            else:
                up = s
        if not low and not up:
            return main
        key = "".join(main.split()).lower()
        op = LIM_OPS.get(key)
        if op is None and main in LIM_OPS.values():
            # 主槽已经是渲染好的算符（fnFUNCTION 正体，例如 \lim）
            op = main
        if op is not None:
            return "%s%s%s" % (op,
                               "_{%s}" % low if low else "",
                               "^{%s}" % up if up else "")
        out = main
        if low:
            out = r"\underset{%s}{%s}" % (low, out)
        if up:
            out = r"\overset{%s}{%s}" % (up, out)
        return out

    # 水平花括号：主槽位、小槽位、花括号字符
    def hbrace(self, t, sel: str, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("%s 槽位为空" % sel)
        main, rest = parts[0], parts[1:]
        label = rest[0] if rest else ""
        if sel == "tmUHBRACE":
            return r"\overbrace{%s}%s" % (main, "^{%s}" % label if label else "")
        return r"\underbrace{%s}%s" % (main, "_{%s}" % label if label else "")

    def frac(self, t, sel: str, pre: str) -> str:
        parts = self.slots(t)
        if len(parts) >= 2:
            return r"%s{%s}{%s}" % (pre, parts[0], parts[1])
        if len(parts) == 1:
            return r"%s{}{%s}" % (pre, parts[0])
        return self.fail("%s 槽位为空" % sel)

    def root(self, t, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("根号槽位为空")
        if var == 1 and len(parts) >= 2:
            return r"\sqrt[%s]{%s}" % (parts[0], parts[1])
        return r"\sqrt{%s}" % parts[-1]

    def bar(self, t, sel: str, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("%s 槽位为空" % sel)
        inner = join(parts)
        fn = r"\underline" if sel == "tmUBAR" else r"\overline"
        if var == 1:  # 双线
            return "%s{%s{%s}}" % (fn, fn, inner)
        return "%s{%s}" % (fn, inner)

    def vector(self, t, sel: str, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("%s 槽位为空" % sel)
        under = sel == "tmUARROW"
        if var == 2:
            name = r"\underleftrightarrow" if under else r"\overleftrightarrow"
        elif var == 1:
            name = r"\underrightarrow" if under else r"\overrightarrow"
        else:
            name = r"\underleftarrow" if under else r"\overleftarrow"
        return "%s{%s}" % (name, parts[0])

    def arrow_box(self, t, sel: str, var: int) -> str:
        parts = self.slots(t)
        if not parts:
            return self.fail("%s 槽位为空" % sel)
        content = parts[0]
        cmd = {"tmLARROW": r"\xleftarrow", "tmRARROW": r"\xrightarrow",
               "tmBARROW": r"\xleftrightarrow"}[sel]
        if var == 1:  # 框在箭头下方
            return "%s[]{%s}" % (cmd, content)
        return "%s{%s}" % (cmd, content)

    def dirac(self, t, var: int) -> str:
        parts = self.slots(t)
        if len(parts) >= 2:
            body = r"\left\langle %s \middle| %s \right\rangle" % (parts[0], parts[1])
            return body
        if len(parts) == 1:
            return parts[0]
        return self.fail("Dirac 模板槽位为空")

    # ── 堆叠与矩阵 ─────────────────────────────────────────

    def pile(self, p) -> str:
        rows = [self.record(line) for line in p.lines]
        rows = [r for r in rows if r]
        if not rows:
            return ""
        if len(rows) == 1:
            return rows[0]
        return r"\begin{gathered} %s \end{gathered}" % r" \\ ".join(rows)

    def matrix(self, m) -> str:
        """矩阵内容。

        用 matrix 而不是 bmatrix：MTEF 里矩阵本身不带分隔符，那对括号来自外面
        的围栏（tmBRACK 之类）。用 bmatrix 会自带一对括号，和围栏叠成两对。

        单元全为空时不输出任何东西（数据里会出现 1x1 的占位空矩阵）。
        """
        cells = [self.record(x) for x in m.resolved_cells]
        if not any(cells):
            return ""
        if m.cell_count_anomaly:
            return self.fail("矩阵单元数 %d != %dx%d" % (len(cells), m.rows, m.cols))
        cols = max(1, int(m.cols))
        rows = []
        for i in range(0, len(cells), cols):
            rows.append(" & ".join(cells[i:i + cols]))
        return r"\begin{matrix} %s \end{matrix}" % r" \\ ".join(rows)


def _braces_balanced(s: str) -> bool:
    """花括号是否配对。转义（\\{ \\}）跳过不计。"""
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
    """渲染一个 MTEF v3 公式。返回 (latex 或 None, 说明)。"""
    r = Renderer()
    body = r.records(eq.records)
    # 收掉没关完的下标（数据里最后一个字号标记可能不是 FULL）
    if r.size_depth:
        body += "}" * r.size_depth
        r.size_depth = 0
    if not r.ok:
        return None, list(r.notes)
    body = " ".join(body.split())
    if not body:
        return None, ["渲染结果为空"]
    # 硬闸：\left 与 \right 必须配对，否则说明结构没理清
    if body.count(r"\left") != body.count(r"\right"):
        return None, ["\\left 与 \\right 不配对：%d vs %d"
                      % (body.count(r"\left"), body.count(r"\right"))]
    # 硬闸：花括号必须配对。这条能挡住 x_{i) 那类错位输出
    if not _braces_balanced(body):
        return None, ["花括号不配对"]
    return body, []


def render_equation(eq) -> Optional[str]:
    latex, _ = render(eq)
    return latex


def self_test() -> int:
    """用真实样本验收：渲染结果应与该公式的兜底预览图一致。"""
    import zipfile

    try:
        from . import mtef_v3 as m3
    except ImportError:
        import mtef_v3 as m3

    print("样本：%s" % m3.SAMPLE_PPTX)
    try:
        with zipfile.ZipFile(m3.SAMPLE_PPTX) as z:
            stream = m3.extract_native_stream(z.read(m3.SAMPLE_EMBED))
    except FileNotFoundError:
        print("样本不存在，跳过")
        return 2

    eq = m3.parse_equation_native(stream)
    latex, notes = render(eq)
    want = " ".join(EXPECTED_LATEX.split())
    got = " ".join((latex or "").split())
    ok = got == want
    if not ok:
        print("失败：渲染结果与基准不一致")
        print("  期望: %s" % want[:260])
        print("  实际: %s" % (got[:260] or "(空)"))
        if notes:
            print("  说明: %s" % notes)
    else:
        print("渲染 %d 字符，与预览图逐项一致" % len(want))
    print("结论：%s" % ("通过" if ok else "不通过"))
    return 0 if ok else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv:
        sys.exit(self_test())
    print(__doc__)
    print("用法：python mtef_v3_latex.py --selftest")
