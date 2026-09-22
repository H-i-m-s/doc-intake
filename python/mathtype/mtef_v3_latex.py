# -*- coding: utf-8 -*-
"""把 MTEF v3 记录树渲染成 LaTeX。

配合 python/mathtype/mtef_v3.py 使用：那个模块把字节解成记录树，这里把记录树
翻成 LaTeX。

为什么不复用 mtef.py 的 makeLatex
---------------------------------
1. 它按 v5 的选择子编号分派（tmROOT=10、tmFRACT=11、tmSUB=27…），v3 是另一套
   （13 根号、14 分式、15/44 上下标）；在它里面加 v3 分支会把两套编号糅进同一
   个函数。
2. 它渲染矩阵用 \\begin{array}{}，行列分隔靠 cols 整除，输出本就偏糙。
3. 它假定 ast.children 按 v5 的槽位顺序排布，而 v3 的槽位里混着 SUB / FULL
   这类标记记录。

两条关键规则（都是从实测字节里逼出来的，不是从规范抄的）
--------------------------------------------------------
A. **围栏裁到自己的收尾字形。** 实测样本里，一段围栏的内容结束处紧跟着它自己的
   拉伸字形（如 tmBRACK 的 0x005D），之后才是「=」和后半个公式。而解码器按
   「子对象列表读到 END 就收」的通用规则会把后面的东西也收进围栏的槽位。所以
   这里按「谁的子树里含这个收尾字形」切开，把尾巴还给父层。
B. **标记记录（FULL / SUB / …）不产出内容**，拉伸字形也不产出（由围栏自己输出
   \\left…\\right）。

为什么不能拿引用实现当验收标准：mathtypejx 和 Ruby gem 用的是同一套「列表读到
END 就收」的贪心规则，两边解出的树一样贪心，它们互相吻合不构成正确性证据。
本文件的验收标准是公式的兜底预览图。

硬闸：任何一条不满足就返回 None，由调用方退回公式预览图——
- 遇到没实现的模板 / 附饰：不猜；
- 矩阵单元数与行列数不符：不渲染（摊平是启发式，见 mtef_v3.py 文件头）；
- \\left 与 \\right 不配对：结构没理清，不渲染。
宁可给一张对的图，不给一段错的 LaTeX。
"""
from __future__ import annotations

import dataclasses
import re
from typing import List, Optional, Tuple

try:  # 包内导入（python/mathtype 作为包被引用时）
    from .chars import Chars, SpecialChar
except ImportError:  # 扁平导入（mathtype_converter 把 python/mathtype 加进了 sys.path）
    from chars import Chars, SpecialChar

__all__ = ["render", "render_equation", "self_test"]

# 自测基准：样本公式（Equation.3）渲染结果应与它的兜底预览图逐项一致
EXPECTED_LATEX = (
    r"\begin{gathered} "
    r"\left[ \begin{bmatrix} X \\ P(x) \end{bmatrix} \right]="
    r"\left[ \begin{bmatrix} a_{1} & a_{2} \\ 0.01 & 0.99 \end{bmatrix} \right] \\ "
    r"\left[ \begin{bmatrix} Y \\ P(y) \end{bmatrix} \right]="
    r"\left[ \begin{bmatrix} b_{1} & b_{2} \\ 0.4 & 0.6 \end{bmatrix} \right] \\ "
    r"\left[ \begin{bmatrix} Z \\ P(z) \end{bmatrix} \right]="
    r"\left[ \begin{bmatrix} c_{1} & c_{2} \\ 0.5 & 0.5 \end{bmatrix} \right] "
    r"\end{gathered}"
)

# v3 的选择子编号（与 v5 不同，依据 mathtypejx records3.py；实测样本中
# sel=15 var=1 确实是下标，故采用这一套而不是 Ruby records3 的那套 v5 编号）
FENCE_GLYPHS = {
    "tmANGLE": (r"\langle", r"\rangle", 0x27E8, 0x27E9),
    "tmPAREN": ("(", ")", 0x0028, 0x0029),
    "tmBRACE": (r"\{", r"\}", 0x007B, 0x007D),
    "tmBRACK": ("[", "]", 0x005B, 0x005D),
    "tmBAR": ("|", "|", 0x007C, 0x007C),
    "tmDBAR": (r"\|", r"\|", 0x2016, 0x2016),
    "tmFLOOR": (r"\lfloor", r"\rfloor", 0x230A, 0x230B),
    "tmCEILING": (r"\lceil", r"\rceil", 0x2308, 0x2309),
}
FENCE_SELECTORS = set(FENCE_GLYPHS)

MARKER_NAMES = {"MarkerRec", "FutureRec", "FontRec", "SizeRec"}
ACCENTS = {
    2: r"\dot", 3: r"\ddot", 4: r"\dddot",
    8: r"\tilde", 9: r"\hat", 10: r"\not",
    11: r"\vec", 12: r"\overleftarrow", 13: r"\overrightarrow",
    16: r"\underline", 17: r"\bar", 21: r"\cancel",
    25: r"\dot", 26: r"\ddot", 27: r"\dddot",
    29: r"\underline", 30: r"\tilde", 33: r"\overrightarrow", 34: r"\overleftarrow",
}
PRIMES = {5: "'", 6: "''", 7: "'''", 18: "'''", 14: "'", 15: "'", 36: "'", 37: "'"}

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


def _replace_objects(line, objects):
    """造一个 objects 被换掉的 LINE 副本，不改原树。"""
    try:
        return dataclasses.replace(line, objects=list(objects))
    except Exception:
        return line


def _is_glyph(r, code: int) -> bool:
    """是否就是那个拉伸字形字符本身（不是「含它的子树」）。"""
    return (type(r).__name__ == "CharRec"
            and getattr(r, "mt_code", -1) == code
            and getattr(r, "typeface", -1) == 22)


def _subtree_has_glyph(r, code: int) -> bool:
    """子树里是否含这个码位的拉伸字形（fnEXPAND，typeface 22）。"""
    if type(r).__name__ == "CharRec":
        return getattr(r, "mt_code", -1) == code and getattr(r, "typeface", -1) == 22
    for a in ("objects", "slots", "lines", "cells", "embellishments"):
        ch = getattr(r, a, None)
        if ch and any(_subtree_has_glyph(c, code) for c in ch):
            return True
    return False


class Renderer:
    def __init__(self):
        self.ok = True
        self.notes: List[str] = []
        # 归位回来的 LINE：它们其实是新的一行，交给 rows_of 处理
        self.extra_rows: list = []

    def fail(self, why: str) -> str:
        if self.ok:
            self.notes.append(why)
        self.ok = False
        return ""

    # ── 调度（带尾巴归还） ─────────────────────────────────

    def records(self, recs) -> str:
        """渲染一串记录。围栏裁下来的尾巴会插回当前列表继续处理；
        尾巴里的 LINE 则记成「新的一行」（见 rows_of）。"""
        pending = list(recs)
        out: List[str] = []
        idx = 0
        while idx < len(pending):
            r = pending[idx]
            idx += 1
            s, hoisted = self.record2(r)
            if s:
                out.append(s)
            if hoisted:
                inline = []
                for h in hoisted:
                    if type(h).__name__ == "LineRec":
                        self.extra_rows.append(h)
                    else:
                        inline.append(h)
                pending[idx:idx] = inline
        return join(out)

    def items(self, recs) -> List[str]:
        """非空项列表，供 \\frac / 上下标这类按槽位取内容的场景使用。"""
        out: List[str] = []
        for r in recs:
            s, _ = self.record2(r)
            if s:
                out.append(s)
        return out

    def record(self, r) -> str:
        s, _ = self.record2(r)
        return s

    def record2(self, r) -> Tuple[str, list]:
        name = type(r).__name__
        if name == "CharRec":
            return self.char(r), []
        if name == "TmplRec":
            return self.tmpl(r)
        if name == "LineRec":
            return self.records(r.objects), []
        if name == "PileRec":
            return self.pile(r), []
        if name == "MatrixRec":
            return self.matrix(r), []
        if name == "EmbellRec":
            code = getattr(r, "code", -1)
            return ("" if code < 0 else self.prefix_accent(code)), []
        if name in MARKER_NAMES:
            return "", []  # FULL / SUB / SUB2 / SYM / SUBSYM / 字体 / 字号：不出内容
        return self.fail("未知记录类型 %s" % name), []

    # ── 字符 ───────────────────────────────────────────────

    def symbol(self, mtcode: int, typeface: int) -> str:
        extend = "/mathmode" if typeface in (11, 24) else ""
        s = Chars.get("char/0x%04x%s" % (mtcode, extend))
        if s:
            return s
        ch = chr(mtcode)
        return SpecialChar.get(ch, ch)

    def char(self, c) -> str:
        if c.typeface == 22:
            # fnEXPAND：可拉伸的括号字形，属于外面那层围栏，由围栏输出
            return ""
        text = self.symbol(c.mt_code, c.typeface - 128)
        if c.typeface - 128 == 1:  # fnTEXT
            text = "{ \\rm{ %s } }" % text
        for e in c.embellishments or []:
            text = self.apply_embellishment(text, e)
        return text

    def apply_embellishment(self, base: str, e) -> str:
        name = type(e).__name__
        if name == "TmplRec" and getattr(e, "selector", "") in ("tmSUP", "tmSUB", "tmSUBSUP"):
            return self.script(base, e)
        if name == "EmbellRec":
            code = getattr(e, "code", -1)
            if code in PRIMES:
                return base + PRIMES[code]
            if code in ACCENTS:
                return "%s{%s}" % (ACCENTS[code], base)
            return self.fail("未实现的附饰 code=%s" % code)
        inner = self.record(e)
        return base + inner if inner else base

    # ── 模板 ───────────────────────────────────────────────

    def tmpl(self, t) -> Tuple[str, list]:
        sel = getattr(t, "selector", "")
        variation = getattr(t, "variation", 0)

        if sel in FENCE_SELECTORS:
            return self.fence(t, sel, variation)
        if sel in ("tmSUP", "tmSUB", "tmSUBSUP"):
            return self.script("", t), []
        if sel == "tmFRACT":
            parts = self.items(t.slots)
            if len(parts) >= 2:
                return r"\frac{%s}{%s}" % (parts[0], parts[1]), []
            return self.fail("分式槽位不足 2 项（拿到 %d）" % len(parts)), []
        if sel == "tmROOT":
            parts = self.items(t.slots)
            if not parts:
                return self.fail("根号槽位为空"), []
            if variation == 1 and len(parts) >= 2:
                return r"\sqrt[%s]{%s}" % (parts[0], parts[1]), []
            return r"\sqrt{%s}" % parts[-1], []
        if sel in ("tmUBAR", "tmOBAR"):
            parts = self.items(t.slots)
            if not parts:
                return self.fail("%s 槽位为空" % sel), []
            inner = join(parts)
            fn = r"\underline{%s}" if sel == "tmUBAR" else r"\overline{%s}"
            return fn % inner, []
        if sel == "tmVEC":
            parts = self.items(t.slots)
            if not parts:
                return self.fail("向量槽位为空"), []
            arrow = r"\overleftarrow" if variation & 0x0001 else r"\overrightarrow"
            return "%s{%s}" % (arrow, parts[0]), []
        return self.fail("未实现的模板 %s（变体 %s）" % (sel or "?", variation)), []

    def fence(self, t, sel: str, variation: int) -> Tuple[str, list]:
        """围栏。内容按「收尾字形」切开，尾巴还给父层（规则 A）。"""
        left_glyph, right_glyph, _open_code, close_code = FENCE_GLYPHS[sel]

        content, remainder = self.cut_at_glyph(t.slots, close_code)
        # 尾巴退回父层：只丢掉字形字符本身，其余（如嵌套围栏）插回去继续渲染
        hoisted = [r for r in remainder if not _is_glyph(r, close_code)]

        if variation == 1:
            left, right = left_glyph, "."
        elif variation == 2:
            left, right = ".", right_glyph
        else:
            left, right = left_glyph, right_glyph

        inner = self.records(content)
        if not inner:
            return "", hoisted
        return r"\left%s %s \right%s" % (left, inner, right), hoisted

    def cut_at_glyph(self, recs, close_code: int) -> Tuple[list, list]:
        """按收尾字形切开。字形可能藏在子结构里（实测在矩阵单元列表末尾），
        也可能在外层还包着一层 LINE 槽包装，所以判据是「谁的子树里有它」，
        并且下钻 LINE 包装再切。找不到就不切，交给硬闸兜。

        返回 (内容记录, 余下记录)，余下的会退回父层。
        """
        recs = list(recs)
        for i, r in enumerate(recs):
            if not _subtree_has_glyph(r, close_code):
                continue
            if type(r).__name__ == "LineRec":
                inner_content, inner_rest = self.cut_at_glyph(r.objects, close_code)
                head = _replace_objects(r, inner_content)
                return recs[:i] + [head], inner_rest + recs[i + 1:]
            return recs[:i + 1], recs[i + 1:]
        return recs, []

    def script(self, base: str, t) -> str:
        """上下标。槽位里的非空项：1 项是脚本，2 项依次是下、上。"""
        sel = getattr(t, "selector", "")
        parts = self.items(t.slots)
        if not parts:
            return base
        if sel == "tmSUP":
            return "%s^{%s}" % (base, join(parts))
        if sel == "tmSUB":
            return "%s_{%s}" % (base, join(parts))
        if len(parts) >= 2:
            return "%s_{%s}^{%s}" % (base, parts[0], parts[1])
        return "%s_{%s}" % (base, parts[0])

    def prefix_accent(self, code: int) -> str:
        if code in ACCENTS:
            return ACCENTS[code]
        return self.fail("未实现的附饰记录 code=%s" % code)

    # ── 堆叠与矩阵 ─────────────────────────────────────────

    def pile(self, p) -> str:
        rows = []
        for line in p.lines:
            rows.extend(self.rows_of(line))
        if not rows:
            return ""
        if len(rows) == 1:
            return rows[0]
        return r"\begin{gathered} %s \end{gathered}" % r" \\ ".join(rows)

    def rows_of(self, rec) -> List[str]:
        """把一个「行」摊成若干行。

        实测：行与行之间是右嵌套的。下一行的 LINE 既可能直接出现在当前 LINE 的
        对象里，也可能夹在当前行「围栏内容的尾巴」里（裁切后会归还到这一层）。
        两种都算下一行，而不是当成内容。
        """
        if type(rec).__name__ != "LineRec":
            s = self.record(rec)
            return [s] if s else []
        own, nested = [], []
        for o in rec.objects:
            (nested if type(o).__name__ == "LineRec" else own).append(o)

        saved = self.extra_rows
        self.extra_rows = []
        own_s = self.records(own)
        captured = self.extra_rows
        self.extra_rows = saved

        out = [own_s] if own_s else []
        for n in nested + captured:
            out.extend(self.rows_of(n))
        return out

    def matrix(self, m) -> str:
        cells = m.resolved_cells
        if not cells:
            return self.fail("矩阵没有单元")
        if m.cell_count_anomaly:
            # 摊平是启发式（见 mtef_v3.py 文件头），对不上就退让，别硬渲染
            return self.fail("矩阵单元数 %d != %dx%d" % (len(cells), m.rows, m.cols))
        cols = max(1, int(m.cols))
        rendered = [self.record(c) for c in cells]
        rows = []
        for i in range(0, len(rendered), cols):
            rows.append(" & ".join(rendered[i:i + cols]))
        return r"\begin{bmatrix} %s \end{bmatrix}" % r" \\ ".join(rows)


def render(eq) -> Tuple[Optional[str], List[str]]:
    """渲染一个 MTEF v3 公式。返回 (latex 或 None, 说明)。"""
    r = Renderer()
    body = r.records(eq.records)
    if not r.ok:
        return None, list(r.notes)
    body = " ".join(body.split())
    if not body:
        return None, ["渲染结果为空"]
    # 硬闸：\left 与 \right 必须配对，否则说明结构没理清
    if body.count(r"\left") != body.count(r"\right"):
        return None, ["\\left 与 \\right 不配对：%d vs %d"
                      % (body.count(r"\left"), body.count(r"\right"))]
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
        print("  期望: %s" % want[:240])
        print("  实际: %s" % (got[:240] or "(空)"))
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
