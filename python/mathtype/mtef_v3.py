# -*- coding: utf-8 -*-
"""MTEF v3（Equation Editor 3.x / MathType 3.x）记录解析器。

本模块与 mtef_v5.py（覆盖 v5）是并列的两套，不是同一份代码的分支条件。
两套不能互相套用，因为差异不在某个字段，而在分层方式：

1. 记录头编码不同。v3 把一个字节掰成两半：高 4 位是选项、低 4 位是记录类型；
   v5 是一个字节纯类型，选项另起一个字节。
2. 分层方式不同。v3 真嵌套，子对象列表以 END 收尾；v5 也是真嵌套，但记录头与
   记录类型是另一套（原先的 mtef.py 把 v5 当平铺流读，已删除）。
3. 文件头不同。v3 头只有 5 字节（版本/平台/产品/版本号/子版本号）；v5 头是
   5 字节 + 以 NUL 结尾的 mApplication 字符串 + 1 字节内联标志。
4. 模板选择子编号是另一套。v3 里 14=分式、13=根号、15/44=上下标；v5 里
   11=分式、10=根号、27/28/29=上下标。
5. 记录类型只定义到 14。没有 COLOR / COLOR_DEF / FONT_DEF / EQN_PREFS /
   ENCODING_DEF；字体是第 8 号 FONT 记录。

把 v5 的 reader 直接套到 v3 数据上会立刻跑偏：类型字节被劈错，读到的全是伪
END，几十字节内就"正常"结束，得到一个空公式。

规则依据
--------
MathType 官方 MTEF v3 规范（Equation Editor 3.x / MathType 3.5）：
    https://rtf2latex2e.sourceforge.net/MTEF3.html
该页是 rtf2latex2e 项目从 Wayback 抢救下来的 MathType 技术文档存档。本模块的
分层、选项位、nudge、字号、矩阵分隔线打包，都按该规范实现。

旁证是 mathtypejx (MIT) 的 records3.py / stream.py（上游为 jure/mathtype 的
Ruby records3/*.rb）。两者都用「子对象列表读到 END 就收」的贪心读法，互相吻合
不构成正确性证据，所以只作旁证。

实测
----
两份样本（文件不入库）合计 30 个对象，全部逐字节走满：
1. 一份 pptx 里的 oleObject3.bin；
2. 另一份 pptx 里的 30 个 Equation.3 对象（product=1 Equation Editor，产品版本 3.1）。
自测：python mtef_v3.py --selftest

矩阵
----
MATRIX 的子对象列表按规范是「每格一个 LINE，自左到右、自上而下」。列表里会夹
着 FULL / SUB 这类标记记录（本来就不产出内容），统计单元时跳过。**不需要任何
"摊平"子结构的规则**——早期版本之所以要摊平，是因为 CHAR 的附饰位读错了（见
下条），把后面的记录吞进了矩阵列表。

CHAR 的附饰位
-------------
规范：CHAR 的 tag 选项位 0x1 是 xfAUTO（可作函数名识别），0x2 才是 xfEMBELL
（后跟一个以 END 收尾的附饰列表）。这一位一度读成 0x1，而字母几乎都带 xfAUTO，
于是每个字母后面都多吞一个列表，把后续内容（括号、等号）吞进子结构，渲染出
x_{i) 这类错位结果。当时只有一道公式，这个错恰好被"围栏裁到收尾字形"的补救
规则掩盖了。

"围栏裁到收尾字形"已删除：规范说明围栏类（ParBoxClass）的子对象是「主槽位、
左围栏字符、右围栏字符」，括号由模板自己携带，不需要裁切。

选项位按记录类型解释
--------------------
LINE 的 0x1 是 xfNULL（没有子对象，连 END 也省），与 CHAR 的 0x1 含义不同。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Tuple

__all__ = [
    "ByteStream",
    "V3Header",
    "V3Equation",
    "MatrixRec",
    "parse",
    "parse_equation_native",
    "extract_native_stream",
    "iter_chars",
    "char_sequence",
    "matrix_cells",
    "template_class",
    "TMPL_CLASSES",
    "self_test",
]

# ── 常量 ──────────────────────────────────────────────────────────────

# 记录类型。v3 只定义到 14，15 及以上按 future 处理。
END = 0
LINE = 1
CHAR = 2
TMPL = 3
PILE = 4
MATRIX = 5
EMBELL = 6
RULER = 7
FONT = 8
SIZE = 9
FULL = 10
SUB = 11
SUB2 = 12
SYM = 13
SUBSYM = 14
FUTURE = 15

TYPE_NAMES = {
    0: "END", 1: "LINE", 2: "CHAR", 3: "TMPL", 4: "PILE", 5: "MATRIX",
    6: "EMBELL", 7: "RULER", 8: "FONT", 9: "SIZE", 10: "FULL", 11: "SUB",
    12: "SUB2", 13: "SYM", 14: "SUBSYM", 15: "FUTURE",
}

# 选项位在 tag 字节的高 4 位。同一数值在不同记录类型上含义不同，按类型解释。
OPT_NUDGE = 0x08        # 所有结构记录：xfLMOVE，后跟 nudge
OPT_CHAR_FUNC = 0x01    # CHAR：xfAUTO，可作为函数名识别
OPT_EMBELL = 0x02       # CHAR：xfEMBELL，后跟附饰列表
OPT_LINE_NULL = 0x01    # LINE：xfNULL，没有子对象，也没有 END
OPT_LINE_RULER = 0x02   # LINE / PILE：xfRULER，后跟标尺
OPT_LINE_LSPACE = 0x04  # LINE：xfLSPACE，后跟行距

# OLE 复合文件里 Equation Native 流的头长度（EQNOLEFILEHDR）
OLE_HEADER_SIZE = 28
# MTEF v3 头长度：没有 mApplication、没有内联标志
V3_HEADER_SIZE = 5

# v3 的模板选择子编号（规范里的「Template Selectors and Variations」表）
SELECTORS = {
    0: "tmANGLE", 1: "tmPAREN", 2: "tmBRACE", 3: "tmBRACK", 4: "tmBAR",
    5: "tmDBAR", 6: "tmFLOOR", 7: "tmCEILING", 8: "tmLBLB", 9: "tmRBRB",
    10: "tmRBLB", 11: "tmLBRP", 12: "tmLPRB", 13: "tmROOT", 14: "tmFRACT",
    15: "tmSCRIPT", 16: "tmUBAR", 17: "tmOBAR", 18: "tmLARROW", 19: "tmRARROW",
    20: "tmBARROW", 21: "tmSINT", 22: "tmDINT", 23: "tmTINT", 24: "tmSSINT",
    25: "tmDSINT", 26: "tmTSINT", 27: "tmUHBRACE", 28: "tmLHBRACE", 29: "tmSUM",
    30: "tmISUM", 31: "tmPROD", 32: "tmIPROD", 33: "tmCOPROD", 34: "tmICOPROD",
    35: "tmUNION", 36: "tmIUNION", 37: "tmINTER", 38: "tmIINTER", 39: "tmLIM",
    40: "tmLDIV", 41: "tmSLFRACT", 42: "tmINTOP", 43: "tmSUMOP", 44: "tmLSCRIPT",
    45: "tmDIRAC", 46: "tmUARROW", 47: "tmOARROW", 48: "tmOARC",
}

# 选择子 -> 槽位类。类决定子对象的种类与顺序，见规范「Template Subobject Order」。
TMPL_CLASSES = {}
for _i in range(0, 13):
    TMPL_CLASSES[_i] = "ParBox"       # 主槽位、左围栏字符、右围栏字符
TMPL_CLASSES[13] = "RootBox"          # 主槽位、被开方槽位
TMPL_CLASSES[14] = "FracBox"          # 分子槽位、分母槽位
TMPL_CLASSES[15] = "ScrBox"           # 下标槽位、上标槽位
TMPL_CLASSES[16] = "BarBox"           # 主槽位
TMPL_CLASSES[17] = "BarBox"
for _i in (18, 19, 20):
    TMPL_CLASSES[_i] = "ArroBox"      # 主槽位、箭头字符
for _i in (21, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 42, 43):
    TMPL_CLASSES[_i] = "BigOp"        # 主槽位、上槽位、下槽位、大运算符字符
TMPL_CLASSES[27] = "HBrBox"           # 主槽位、小槽位、花括号字符
TMPL_CLASSES[28] = "HBrBox"
TMPL_CLASSES[39] = "LimBox"           # 主槽位、下槽位、上槽位
TMPL_CLASSES[40] = "LDivBox"          # 被除槽位、商槽位
TMPL_CLASSES[41] = "SlashBox"         # 分子槽位、分母槽位
TMPL_CLASSES[44] = "ScrBox"           # 前置上下标：下标槽位、上标槽位
TMPL_CLASSES[45] = "DiracBox"         # 左槽位、右槽位、左尖括号、竖线、右尖括号
TMPL_CLASSES[46] = "VectorBox"        # 主槽位
TMPL_CLASSES[47] = "VectorBox"
TMPL_CLASSES[48] = "ArcBox"           # 主槽位
del _i

# 选择子 15 和 44 是「上下标」类，具体是哪种由 variation 决定
SCRIPT_VARIATIONS = {0: "tmSUP", 1: "tmSUB", 2: "tmSUBSUP"}


def template_class(index: int) -> str:
    return TMPL_CLASSES.get(index, "?")


def selector_name(index: int, variation: int) -> str:
    """把 v3 的选择子编号翻成可读名字。"""
    if index in (15, 44):
        return SCRIPT_VARIATIONS.get(variation, "tmSCRIPT")
    return SELECTORS.get(index, "tmUNKNOWN_%d" % index)


# ── 字节流 ────────────────────────────────────────────────────────────


class ByteStream:
    """MTEF 字节流读取器。标签与选项混在一个字节里，但没有跨字节的半字节字段，
    所以按字节读就够了。"""

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    @property
    def remaining(self) -> int:
        return len(self.data) - self.pos

    def _need(self, n: int) -> None:
        if self.pos + n > len(self.data):
            raise EOFError("读 %d 字节越界：pos=%d 长度=%d" % (n, self.pos, len(self.data)))

    def uint8(self) -> int:
        self._need(1)
        b = self.data[self.pos]
        self.pos += 1
        return b

    def int8(self) -> int:
        v = self.uint8()
        return v - 256 if v >= 128 else v

    def mtef16(self) -> int:
        """2 字节小端无符号整数。"""
        lo = self.uint8()
        hi = self.uint8()
        return (hi << 8) | lo

    def mt_uint(self) -> int:
        """变长无符号整数：首字节 < 0xFF 就是它本身，否则后两字节为低/高。"""
        first = self.uint8()
        if first < 0xFF:
            return first
        lo = self.uint8()
        hi = self.uint8()
        return (hi << 8) | lo

    def skip(self, n: int) -> None:
        self._need(n)
        self.pos += n


# ── 记录 ──────────────────────────────────────────────────────────────


@dataclass
class CharRec:
    typeface: int
    mt_code: int
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    embellishments: List[object] = field(default_factory=list)

    def glyph(self) -> Optional[str]:
        if 0x20 <= self.mt_code < 0x7F:
            return chr(self.mt_code)
        return None

    def label(self) -> str:
        g = self.glyph()
        s = "CHAR tf=%d mt=0x%04X" % (self.typeface, self.mt_code)
        if g is not None:
            s += " %r" % g
        if self.nudge:
            s += " nudge%s" % (self.nudge,)
        if self.embellishments:
            s += " 附饰x%d" % len(self.embellishments)
        return s


@dataclass
class TmplRec:
    selector_index: int
    variation: int
    selector: str
    template_options: int = 0
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    slots: List[object] = field(default_factory=list)

    @property
    def tmpl_class(self) -> str:
        return template_class(self.selector_index)

    def label(self) -> str:
        s = "TMPL #%d %s var=%d 类=%s tattr=0x%02X" % (
            self.selector_index, self.selector, self.variation,
            self.tmpl_class, self.template_options)
        if self.nudge:
            s += " nudge%s" % (self.nudge,)
        return s


@dataclass
class LineRec:
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    line_spacing: Optional[int] = None
    ruler: Optional[object] = None
    objects: List[object] = field(default_factory=list)

    def label(self) -> str:
        s = "LINE opts=0x%02X" % self.options
        if self.line_spacing is not None:
            s += " lspace=%d" % self.line_spacing
        if self.ruler:
            s += " %s" % self.ruler
        return s


@dataclass
class PileRec:
    halign: int
    valign: int
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    ruler: Optional[object] = None
    lines: List[object] = field(default_factory=list)

    def label(self) -> str:
        return "PILE halign=%d valign=%d" % (self.halign, self.valign)


@dataclass
class MatrixRec:
    rows: int
    cols: int
    valign: int
    h_just: int
    v_just: int
    row_parts: List[int] = field(default_factory=list)
    col_parts: List[int] = field(default_factory=list)
    cells: List[object] = field(default_factory=list)
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None

    @property
    def expected_cells(self) -> int:
        return max(0, self.rows) * max(0, self.cols)

    @property
    def resolved_cells(self) -> List[object]:
        """单元项，按规范就是子对象列表里的那些 LINE。见 matrix_cells()。"""
        return matrix_cells(self)

    @property
    def cell_count_anomaly(self) -> bool:
        """单元项数与行列数不符时为 True。"""
        n = len(self.resolved_cells)
        return self.expected_cells > 0 and n != self.expected_cells

    def label(self) -> str:
        n = len(self.resolved_cells)
        s = "MATRIX %dx%d rowparts=%s colparts=%s 单元 %d/%d" % (
            self.rows, self.cols, self.row_parts, self.col_parts,
            n, self.expected_cells)
        if len(self.cells) != n:
            s += "（列表里另有 %d 项标记）" % (len(self.cells) - n)
        if self.cell_count_anomaly:
            s += "  <- 单元数与行列数不符"
        return s


@dataclass
class EmbellRec:
    code: int
    options: int = 0

    def label(self) -> str:
        return "EMBELL code=%d" % self.code


@dataclass
class FontRec:
    typeface: int
    style: int
    name: str

    def label(self) -> str:
        return "FONT typeface=%d style=%d name=%r" % (self.typeface, self.style, self.name)


@dataclass
class SizeRec:
    size_select: int
    lsize: Optional[int] = None
    dsize: Optional[int] = None
    point_size: Optional[int] = None

    def label(self) -> str:
        if self.size_select == 101:
            return "SIZE 定点 %s" % self.point_size
        if self.size_select == 100:
            return "SIZE lsize=%s dsize=%s" % (self.lsize, self.dsize)
        return "SIZE sel=%d lsize=%s dsize=%s" % (self.size_select, self.lsize, self.dsize)


@dataclass
class MarkerRec:
    """FULL / SUB / SUB2 / SYM / SUBSYM：无数据，只影响字号。"""

    record_type: int

    def label(self) -> str:
        return TYPE_NAMES.get(self.record_type, "?%d" % self.record_type)


@dataclass
class FutureRec:
    length: int
    options: int = 0

    def label(self) -> str:
        return "FUTURE 跳过 %d 字节" % self.length


@dataclass
class V3Header:
    mtef_version: int
    platform: int
    product: int
    product_version: int
    product_subversion: int

    def label(self) -> str:
        return ("MTEF v3 头: mtefVer=%d platform=%d product=%d version=%d.%d"
                % (self.mtef_version, self.platform, self.product,
                   self.product_version, self.product_subversion))


@dataclass
class V3Equation:
    header: V3Header
    records: List[object] = field(default_factory=list)
    consumed: int = 0
    total: int = 0
    errors: List[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        """是否恰好把 body 消耗干净。"""
        return self.consumed == self.total

    @property
    def anomaly(self) -> bool:
        return any(isinstance(r, MatrixRec) and r.cell_count_anomaly
                   for r in _walk(self.records))


# ── 解析 ──────────────────────────────────────────────────────────────


class _Parser:
    def __init__(self, body: bytes):
        self.s = ByteStream(body)
        self.body = body
        self.errors: List[str] = []

    # -- 头 --
    def header(self) -> V3Header:
        return V3Header(
            mtef_version=self.s.uint8(),
            platform=self.s.uint8(),
            product=self.s.uint8(),
            product_version=self.s.uint8(),
            product_subversion=self.s.uint8(),
        )

    # -- nudge --
    def nudge(self) -> Tuple[int, int]:
        """小的 nudge 是 2 个字节，各自偏置 128；放不下时先写两个 128，
        再跟两个 16 位无偏值（规范「Nudge values」）。"""
        a = self.s.uint8()
        b = self.s.uint8()
        if a == 128 and b == 128:
            return (self.s.mtef16(), self.s.mtef16())
        return (a - 128, b - 128)

    # -- 标尺 --
    def ruler(self) -> str:
        n = self.s.int8()
        if n < 0:
            n = 0
        n = min(n, 20)  # 防止畸形数据把流读穿
        for _ in range(n):
            self.s.int8()
            self.s.mtef16()
        return "ruler(%d 站)" % n

    # -- 行/列分隔线 --
    def parts(self, rows: int, cols: int):
        """行/列分隔线各 行(列)+1 个值，每个 2 bit，各自补齐到字节边界。"""
        s = self.s

        def take(count: int) -> List[int]:
            nbytes = (count * 2 + 7) // 8
            raw = [s.uint8() for _ in range(nbytes)]
            bits = "".join(format(b, "08b") for b in raw)
            return [int(bits[i * 2:i * 2 + 2], 2) for i in range(count)]

        return take(max(0, rows) + 1), take(max(0, cols) + 1)

    # -- 子对象列表：遇 END 收尾 --
    def object_list(self) -> List[object]:
        out: List[object] = []
        while self.s.remaining > 0:
            tag = self.s.uint8()
            rec_type = tag & 0x0F
            options = (tag >> 4) & 0x0F
            if rec_type == END:
                return out
            try:
                rec = self.record(tag, rec_type, options)
            except EOFError as exc:
                self.errors.append(str(exc))
                return out
            if rec is not None:
                out.append(rec)
        # 走到数据末尾都没有 END：上游也接受这种情况，但记一笔
        self.errors.append("子对象列表没有遇到 END 就到底了")
        return out

    # -- 单条记录 --
    def record(self, tag: int, rec_type: int, options: int) -> Optional[object]:
        s = self.s

        if rec_type == CHAR:
            nudge = self.nudge() if options & OPT_NUDGE else None
            typeface = s.int8() + 128
            mt_code = s.mtef16()
            rec = CharRec(typeface=typeface, mt_code=mt_code, options=options, nudge=nudge)
            if options & OPT_EMBELL:
                rec.embellishments = self.object_list()
            return rec

        if rec_type == TMPL:
            nudge = self.nudge() if options & OPT_NUDGE else None
            index = s.int8()
            variation = s.uint8()
            template_options = s.uint8()
            rec = TmplRec(
                selector_index=index,
                variation=variation,
                selector=selector_name(index, variation),
                template_options=template_options,
                options=options,
                nudge=nudge,
            )
            rec.slots = self.object_list()
            return rec

        if rec_type == LINE:
            nudge = self.nudge() if options & OPT_NUDGE else None
            line_spacing = s.mtef16() if options & OPT_LINE_LSPACE else None
            ruler = self.ruler() if options & OPT_LINE_RULER else None
            rec = LineRec(options=options, nudge=nudge,
                          line_spacing=line_spacing, ruler=ruler)
            if not (options & OPT_LINE_NULL):
                rec.objects = self.object_list()
            return rec

        if rec_type == PILE:
            nudge = self.nudge() if options & OPT_NUDGE else None
            halign = s.int8()
            valign = s.int8()
            ruler = self.ruler() if options & OPT_LINE_RULER else None
            rec = PileRec(halign=halign, valign=valign, options=options,
                          nudge=nudge, ruler=ruler)
            rec.lines = self.object_list()
            return rec

        if rec_type == MATRIX:
            nudge = self.nudge() if options & OPT_NUDGE else None
            valign = s.int8()
            h_just = s.int8()
            v_just = s.int8()
            rows = max(0, s.int8())
            cols = max(0, s.int8())
            row_parts, col_parts = self.parts(rows, cols)
            rec = MatrixRec(rows=rows, cols=cols, valign=valign, h_just=h_just,
                            v_just=v_just, row_parts=row_parts,
                            col_parts=col_parts, options=options, nudge=nudge)
            rec.cells = self.object_list()
            return rec

        if rec_type == EMBELL:
            return EmbellRec(code=s.uint8(), options=options)

        if rec_type == FONT:
            typeface = s.int8() + 128
            style = s.int8()
            name = bytearray()
            while s.remaining > 0:
                b = s.uint8()
                if b == 0:
                    break
                name.append(b)
            return FontRec(typeface=typeface, style=style,
                           name=bytes(name).decode("latin-1"))

        if rec_type == SIZE:
            # 沿用 v5 侧 mtef_v5.py 的读法（上游也这么委托），见文件头「未验证项」
            sel = s.int8()
            if sel == 101:
                return SizeRec(size_select=101, point_size=s.mtef16())
            if sel == 100:
                lsize = s.uint8()
                dsize = s.mtef16()
                return SizeRec(size_select=100, lsize=lsize, dsize=dsize)
            dsize = s.uint8()
            return SizeRec(size_select=sel, lsize=sel, dsize=dsize - 128)

        if rec_type in (FULL, SUB, SUB2, SYM, SUBSYM):
            return MarkerRec(record_type=rec_type)

        if rec_type == RULER:
            return MarkerRec(record_type=rec_type)  # 独立标尺记录，无内容

        if rec_type == FUTURE:
            length = s.mt_uint()
            s.skip(length)
            return FutureRec(length=length, options=options)

        self.errors.append("未知记录类型 %d（tag=0x%02X，偏移 %d）" % (rec_type, tag, s.pos - 1))
        return None


def _walk(records: List[object]) -> Iterator[object]:
    """深度优先遍历记录树。"""
    for r in records:
        yield r
        for attr in ("objects", "slots", "lines", "cells", "embellishments"):
            child = getattr(r, attr, None)
            if child:
                yield from _walk(child)


def matrix_cells(matrix: "MatrixRec") -> List[object]:
    """矩阵的单元。

    规范：MATRIX 的子对象列表就是「每格一个 LINE，自左到右、自上而下」。列表里
    夹杂的标记记录（FULL / SUB / SUB2 / SYM / SUBSYM）与 future 记录不产出内容，
    直接跳过。若结果个数与 rows*cols 不符，MatrixRec.cell_count_anomaly 为 True，
    调用方应退回公式预览图，不要硬渲染。
    """
    return [c for c in matrix.cells
            if type(c).__name__ not in ("MarkerRec", "FutureRec")]


def parse(body: bytes) -> V3Equation:
    """解析 MTEF v3 body（已去掉 28 字节 OLE 头）。"""
    parser = _Parser(body)
    header = parser.header()
    records = parser.object_list()
    return V3Equation(header=header, records=records,
                      consumed=parser.s.pos, total=len(body),
                      errors=parser.errors)


def parse_equation_native(stream: bytes) -> V3Equation:
    """解析完整的 Equation Native 流（含 28 字节 EQNOLEFILEHDR）。"""
    if len(stream) < OLE_HEADER_SIZE:
        raise ValueError("Equation Native 流太短：%d 字节" % len(stream))
    cb_hdr = int.from_bytes(stream[0:2], "little")
    cb_size = int.from_bytes(stream[8:12], "little")
    if cb_hdr != OLE_HEADER_SIZE:
        raise ValueError("EQNOLEFILEHDR 长度不是 28，而是 %d" % cb_hdr)
    body = stream[cb_hdr:cb_hdr + cb_size]
    return parse(body)


def extract_native_stream(ole_bin: bytes, names=("Equation Native", "EquationNative", "Equation")) -> bytes:
    """从 OLE 复合文件字节里取出 Equation Native 流。"""
    import io
    import os
    import sys

    try:
        from .ole_util.ole import Ole
    except ImportError:  # 直接当脚本跑时没有包上下文
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from ole_util.ole import Ole

    ole, err = Ole.Open(io.BytesIO(ole_bin))
    if err:
        raise ValueError("OLE 打开失败：%s" % err)
    entries, err = ole.ListDir()
    if err:
        raise ValueError("OLE 列目录失败：%s" % err)
    for name in names:
        for f in entries:
            if f.Name() == name:
                reader = ole.OpenFile(f, entries[0])
                buf = bytearray()
                while True:
                    chunk = reader.read(4096)
                    if not chunk:
                        break
                    buf += chunk
                return bytes(buf)
    raise ValueError("OLE 里没有 Equation Native 流")


def iter_chars(records: List[object]) -> Iterator[CharRec]:
    """按出现顺序取出所有 CHAR 记录。"""
    for r in _walk(records):
        if isinstance(r, CharRec):
            yield r


def char_sequence(eq: V3Equation) -> List[int]:
    return [c.mt_code for c in iter_chars(eq.records)]


# ── 演示与自测 ────────────────────────────────────────────────────────

import os as _os

_SAMPLES = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "samples")
SAMPLE_PPTX = _os.path.join(_SAMPLES, "公式图表测试.pptx")
SAMPLE_EMBED = "ppt/embeddings/oleObject3.bin"
CORPUS_PPTX = _os.path.join(_SAMPLES, "第二章_信息与信息论.pptx")
# 实测得到的字符序列，作为自测基准。
EXPECTED_CODES = [
    0x0058, 0x0050, 0x0028, 0x0078, 0x0029, 0x005B, 0x005D, 0x003D,
    0x0061, 0x0031, 0x0061, 0x0032,
    0x0030, 0x002E, 0x0030, 0x0031, 0x0030, 0x002E, 0x0039, 0x0039, 0x005B, 0x005D,
    0x0059, 0x0050, 0x0028, 0x0079, 0x0029, 0x005B, 0x005D, 0x003D,
    0x0062, 0x0031, 0x0062, 0x0032,
    0x0030, 0x002E, 0x0034, 0x0030, 0x002E, 0x0036, 0x005B, 0x005D,
    0x005A, 0x0050, 0x0028, 0x007A, 0x0029, 0x005B, 0x005D, 0x003D,
    0x0063, 0x0031, 0x0063, 0x0032,
    0x0030, 0x002E, 0x0035, 0x0030, 0x002E, 0x0035, 0x005B, 0x005D,
]
# 语料的规模（对象总数 / 有真实 MTEF 的个数），用来防止语料被挪走后自测假通过
CORPUS_EXPECTED = (30, 29)


def _print_tree(records: List[object], depth: int = 0, limit: int = 400) -> int:
    printed = 0
    for r in records:
        if printed >= limit:
            print("  " * depth + "...")
            return printed
        print("  " * depth + r.label())
        printed += 1
        for attr in ("objects", "slots", "lines", "cells", "embellishments"):
            child = getattr(r, attr, None)
            if child:
                printed += _print_tree(child, depth + 1, limit - printed)
    return printed


def _demo(stream: bytes) -> None:
    print("Equation Native 流 %d 字节" % len(stream))
    eq = parse_equation_native(stream)
    print(eq.header.label())
    print()
    print("记录树：")
    _print_tree(eq.records)
    print()
    print("消耗 %d/%d 字节  [%s]" % (
        eq.consumed, eq.total, "干净走完" if eq.complete else "没有走满"))
    codes = char_sequence(eq)
    glyphs = "".join(chr(c) if 0x20 <= c < 0x7F else "?" for c in codes)
    print("字符 %d 个：%s" % (len(codes), glyphs))
    for e in getattr(eq, "errors", [])[:5]:
        print("提示：%s" % e)
    for m in _walk(eq.records):
        if isinstance(m, MatrixRec) and m.cell_count_anomaly:
            print("警告：%s" % m.label())


def _corpus_report() -> int:
    """把 29 个公式语料跑一遍，报告解析质量。"""
    import io
    import os
    import zipfile

    try:
        import olefile
    except ImportError:
        print("没有 olefile，跳过语料自测")
        return 2

    if not os.path.exists(CORPUS_PPTX):
        print("语料不存在，跳过：%s" % CORPUS_PPTX)
        return 2

    total = real = clean = anomaly = 0
    with zipfile.ZipFile(CORPUS_PPTX) as z:
        names = sorted((n for n in z.namelist()
                        if n.startswith("ppt/embeddings/") and n.endswith(".bin")),
                       key=lambda s: int("".join(c for c in s if c.isdigit()) or 0))
        for name in names:
            total += 1
            ole = olefile.OleFileIO(io.BytesIO(z.read(name)))
            raw = None
            try:
                for entry in ole.listdir():
                    if "/".join(entry).split("/")[-1].strip("\x01") == "Equation Native":
                        raw = ole.openstream("/".join(entry)).read()
                        break
            finally:
                ole.close()
            if not raw or len(raw) < 33 or raw[28] != 3:
                continue
            cb_body = int.from_bytes(raw[8:12], "little")
            if cb_body <= 12:
                continue  # 空壳对象：MTEF 里只有 FULL + END
            real += 1
            eq = parse_equation_native(raw)
            if eq.complete and not eq.errors:
                clean += 1
            if eq.anomaly:
                anomaly += 1

    print("语料：%s" % CORPUS_PPTX)
    print("对象 %d 个，其中 v3 有数据 %d 个" % (total, real))
    print("走满且无错误提示：%d" % clean)
    print("矩阵单元数与行列数不符：%d" % anomaly)
    want_total, want_real = CORPUS_EXPECTED
    ok = (total == want_total and real == want_real
          and clean == want_real and anomaly == 0)
    print("结论：%s" % ("通过" if ok else "不通过（解析质量有变化，请人工核对）"))
    return 0 if ok else 1


def self_test() -> int:
    """用真实样本跑一遍，断言能走完、字符序列正确、矩阵单元数自洽。"""
    import zipfile

    print("样本：%s" % SAMPLE_PPTX)
    try:
        with zipfile.ZipFile(SAMPLE_PPTX) as z:
            stream = extract_native_stream(z.read(SAMPLE_EMBED))
    except FileNotFoundError:
        print("样本不存在，跳过")
        return 2
    eq = parse_equation_native(stream)
    codes = char_sequence(eq)
    ok = True
    print("消耗 %d/%d 字节 -> %s" % (eq.consumed, eq.total,
                                     "走满" if eq.complete else "未走满"))
    if not eq.complete:
        print("失败：没有恰好消耗完 body")
        ok = False
    print("字符 %d 个（基准 %d 个）" % (len(codes), len(EXPECTED_CODES)))
    if codes != EXPECTED_CODES:
        for i, (got, want) in enumerate(zip(codes, EXPECTED_CODES)):
            if got != want:
                print("失败：第 %d 个字符 0x%04X != 期望 0x%04X" % (i, got, want))
                break
        if len(codes) != len(EXPECTED_CODES):
            print("失败：字符个数不符")
        ok = False
    for m in _walk(eq.records):
        if isinstance(m, MatrixRec):
            print("  %s" % m.label())
            if m.cell_count_anomaly:
                print("失败：%s" % m.label())
                ok = False
    print("结论：%s" % ("通过" if ok else "不通过"))
    return 0 if ok else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv:
        rc = self_test()
        print()
        rc2 = _corpus_report()
        sys.exit(max(rc, rc2))

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        print("用法：")
        print("  python mtef_v3.py --selftest              跑内置样本与语料自测")
        print("  python mtef_v3.py <oleObject.bin>         解析单个 OLE 嵌入对象")
        sys.exit(0)

    path = args[0]
    if path.lower().endswith(".pptx"):
        import zipfile

        embed = args[1] if len(args) > 1 else SAMPLE_EMBED
        with zipfile.ZipFile(path) as z:
            stream = extract_native_stream(z.read(embed))
    else:
        with open(path, "rb") as fp:
            stream = extract_native_stream(fp.read())
    _demo(stream)
