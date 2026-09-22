# -*- coding: utf-8 -*-
"""MTEF v3（Equation Editor 3.x / MathType 3.x）记录解析器。

本模块是 python/mathtype/mtef.py（只覆盖 v5）的**并列另一套**，不是它的分支
条件。两套不能互相套用，因为差异不在某个字段，而在分层方式：

1. 记录头编码不同。v3 把一个字节掰成两半：高 4 位是选项、低 4 位是记录类型；
   v5 是一个字节纯类型，选项另起一个字节。
2. 分层方式不同。v3 真嵌套，子对象列表以 END 收尾；v5 是平铺流，靠 mtef.py
   的 makeAST() 事后重建嵌套。
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
mathtypejx (MIT) 的 records3.py / stream.py
    https://github.com/a917470154/mathtypejx
其上游是 jure/mathtype 的 Ruby records3/*.rb（`records3/mtef.rb` 等）。
本文件是按上述公开实现重写的 Python 版本，保留了署名。正式并入本仓库前，
请先确认 doc-intake 的许可与 MIT 兼容。

实测
----
拿 D:\\Agent\\各种类型文件\\公式图表测试.pptx 里的 oleObject3.bin
（progId=Equation.3，6656 字节）验证：457 字节 body 全部消耗完，解出的 59 个
mt_code 与该公式的兜底预览图逐字对上（X/P(x)、a1 a2、0.01 0.99、Y/P(y)、
b1 b2、0.4 0.6、Z/P(z)、c1 c2、0.5 0.5）。可用 `python mtef_v3.py --selftest`
复现。

已知未闭合项（真接入前要定案）
------------------------------
1. MATRIX 的单元切分。分隔线的打包已经定案，见 MATRIX_PARTS_MODE 的 "flow"：
   行与列的分隔线连成一条 nibble 流，2x2 占 3 字节。剩下没定的是「单元」
   怎么分：实测样本里 2x1 矩阵的 cell 列表是 [CHAR X, LINE P(x), CHAR '[',
   CHAR ']']（多出的是结尾的方括号字形），2x2 矩阵只切出 [CHAR a₁, FULL,
   LINE]，0.01 / 0.99 落在矩阵外。字符和顺序已正确，缺的是分组边界——
   疑似 FULL 是单元的引导标记、END 是单元的收尾。要更多 v3 样本才能定案。
   MatrixRec.cell_count_anomaly 只作提示，不能当结论。
2. nudge 的大值分支条件。上游 mathtypejx 要求「两字节同时为 -128」才走大值
   分支；而 v5 的 mtef.py 用「任一为 -128」。同一段数据两种规则给出的记录长度
   不同，会整体错位。本模块默认按上游（同时为 -128），可用模块常量
   NUDGE_LARGE_REQUIRES_BOTH 切成另一种。
3. SIZE / RULER 直接沿用了 v5 的读法（上游也是这么委托的），v3 是否完全一致
   未单独验证。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Tuple

__all__ = [
    "ByteStream",
    "V3Header",
    "V3Equation",
    "parse",
    "parse_equation_native",
    "extract_native_stream",
    "iter_chars",
    "char_sequence",
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

# 选项位：在 tag 字节的高 4 位
OPT_NUDGE = 0x08        # xfLMOVE，后跟 nudge
OPT_EMBELL = 0x01       # CHAR 记录：后跟附饰列表
OPT_FUNC = 0x02         # CHAR 记录
OPT_LINE_NULL = 0x01    # LINE 记录：xfNULL，没有子对象
OPT_LINE_RULER = 0x02   # LINE/PILE：xfRULER，后跟标尺
OPT_LINE_LSPACE = 0x04  # LINE 记录：xfLSPACE，后跟行距

# OLE 复合文件里 Equation Native 流的头长度（EQNOLEFILEHDR）
OLE_HEADER_SIZE = 28
# MTEF v3 头长度：没有 mApplication、没有内联标志
V3_HEADER_SIZE = 5

# 见「已知未闭合项」第 2 条
NUDGE_LARGE_REQUIRES_BOTH = True

# MATRIX 行/列分隔线的打包方式。见「已知未闭合项」第 1 条。
#   "flow"   —— 行与列的分隔线连成一条 nibble 流，末尾补一次字节。
#               实测样本（2x2）行 3 + 列 3 = 6 个 nibble = 3 字节，只有这一种能把
#               a₁ 的 'a' 保留下来。默认。
#   "nibble" —— 上游 mathtypejx 的读法：每个数组各自按 nibble 读再对齐，2x2 会
#               吃 4 字节，多吞 1 字节，导致矩阵第一格错位。
#   "bit2"   —— Ruby gem records3/matrix.rb 的读法：字段各占 2 bit。对应 MathType
#               3.x 写的另一套方言，对 Equation.3 样本会错位。
#   "byte"   —— 一个字段占一个字节。
MATRIX_PARTS_MODE = "flow"

# v3 的模板选择子编号（与 v5 不同）
SELECTORS = {
    0: "tmANGLE", 1: "tmPAREN", 2: "tmBRACE", 3: "tmBRACK", 4: "tmBAR",
    5: "tmDBAR", 6: "tmFLOOR", 7: "tmCEILING", 8: "tmINTERVAL",
    9: "tmINTERVAL", 10: "tmINTERVAL", 11: "tmINTERVAL", 12: "tmINTERVAL",
    13: "tmROOT", 14: "tmFRACT", 15: "tmSCRIPT", 16: "tmUBAR", 17: "tmOBAR",
    18: "tmARROW", 19: "tmARROW", 20: "tmARROW", 21: "tmINTEG", 22: "tmINTEG",
    23: "tmINTEG", 24: "tmINTEG", 25: "tmINTEG", 26: "tmINTEG", 27: "tmHBRACE",
    28: "tmHBRACE", 29: "tmSUM", 30: "tmSUM", 31: "tmPROD", 32: "tmPROD",
    33: "tmCOPROD", 34: "tmCOPROD", 35: "tmUNION", 36: "tmUNION",
    37: "tmINTER", 38: "tmINTER", 39: "tmLIM", 40: "tmLDIV", 41: "tmFRACT",
    42: "tmINTOP", 43: "tmSUMOP", 44: "tmSCRIPT", 45: "tmDIRAC", 46: "tmVEC",
    47: "tmVEC", 48: "tmBOX",
}

# 选择子 15 和 44 是「上下标」类，具体是哪种由 variation 决定
SCRIPT_VARIATIONS = {0: "tmSUP", 1: "tmSUB", 2: "tmSUBSUP"}


def selector_name(index: int, variation: int) -> str:
    """把 v3 的选择子编号翻成可读名字。"""
    if index in (15, 44):
        return SCRIPT_VARIATIONS.get(variation, "tmSUB")
    return SELECTORS.get(index, "tmUNKNOWN_%d" % index)


# ── 字节流 ────────────────────────────────────────────────────────────


class ByteStream:
    """带半字节精度的 MTEF 字节流读取器。

    nibble() 与 uint8() 可以混用：读完一个 nibble 后再读字节时，会把挂起的
    半个字节补齐。MATRIX 的分隔线是 2 bit 打包的，所以这个能力是必需的。
    """

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
        self._pending_nibble: Optional[int] = None

    @property
    def remaining(self) -> int:
        return len(self.data) - self.pos

    def _need(self, n: int) -> None:
        if self.pos + n > len(self.data):
            raise EOFError("读 %d 字节越界：pos=%d 长度=%d" % (n, self.pos, len(self.data)))

    def uint8(self) -> int:
        if self._pending_nibble is not None:
            low = self._pending_nibble
            self._pending_nibble = None
            self._need(1)
            high = self.data[self.pos]
            self.pos += 1
            return (high << 4) | low
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

    def nibble(self) -> int:
        """读一个半字节（4 bit），先高后低。"""
        if self._pending_nibble is not None:
            v = self._pending_nibble
            self._pending_nibble = None
            return v
        self._need(1)
        b = self.data[self.pos]
        self.pos += 1
        self._pending_nibble = b & 0x0F
        return (b >> 4) & 0x0F

    def align_byte(self) -> None:
        """丢弃挂起的半字节，对齐到下一个字节边界。"""
        self._pending_nibble = None

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

    def label(self) -> str:
        s = "TMPL #%d %s var=%d tattr=0x%02X" % (
            self.selector_index, self.selector, self.variation, self.template_options)
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
    def cell_count_anomaly(self) -> bool:
        """见「已知未闭合项」第 1 条：样本里这个值是 True。"""
        return self.expected_cells > 0 and len(self.cells) != self.expected_cells

    def label(self) -> str:
        s = "MATRIX %dx%d rowparts=%s colparts=%s 单元 %d/%d" % (
            self.rows, self.cols, self.row_parts, self.col_parts,
            len(self.cells), self.expected_cells)
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
    """FULL / SUB / SUB2 / SYM / SUBSYM：无数据。"""

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
        small_dx = self.s.int8()
        small_dy = self.s.int8()
        if NUDGE_LARGE_REQUIRES_BOTH:
            big = (small_dx == -128 and small_dy == -128)
        else:
            big = (small_dx == -128 or small_dy == -128)
        if big:
            dx = self.s.mtef16()
            dy = self.s.mtef16()
            return (dx, dy)
        return (small_dx - 128, small_dy - 128)

    # -- 标尺 --
    def ruler(self) -> str:
        n = self.s.int8()
        if n < 0:
            n = 0
        n = min(n, 20)  # 与上游一致：防止畸形数据把流读穿
        for _ in range(n):
            self.s.int8()
            self.s.mtef16()
        return "ruler(%d 站)" % n

    # -- 行/列分隔线 --
    def parts(self, rows: int, cols: int):
        """读行/列分隔线，返回 (row_parts, col_parts)。打包方式见 MATRIX_PARTS_MODE。"""
        s = self.s
        n_row, n_col = rows + 1, cols + 1
        if n_row <= 0 or n_col <= 0:
            return [], []
        if MATRIX_PARTS_MODE == "byte":
            return ([s.uint8() for _ in range(n_row)],
                    [s.uint8() for _ in range(n_col)])
        if MATRIX_PARTS_MODE == "bit2":
            def take(count):
                nbytes = (count * 2 + 7) // 8
                raw = [s.uint8() for _ in range(nbytes)]
                bits = "".join(format(b, "08b") for b in raw)
                return [int(bits[i * 2:i * 2 + 2], 2) for i in range(count)]
            return take(n_row), take(n_col)
        if MATRIX_PARTS_MODE == "nibble":
            # 上游 mathtypejx：每个数组各自 nibble + 对齐
            def take(count):
                out = [s.nibble() & 0x3 for _ in range(count)]
                if (count * 2) % 8:
                    s.align_byte()
                return out
            return take(n_row), take(n_col)
        # flow：行列连成一条 nibble 流，末尾只补一次
        fields = [s.nibble() for _ in range(n_row + n_col)]
        if ((n_row + n_col) * 4) % 8:
            s.align_byte()
        return fields[:n_row], fields[n_row:]

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
            # 行/列分隔线，各 行(列)+1 个字段。打包方式见 MATRIX_PARTS_MODE
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
            # 沿用上游的委托实现（与 v5 同形，见「已知未闭合项」第 3 条）
            sel = s.int8()
            if sel == 101:
                return SizeRec(size_select=101, point_size=-s.mtef16())
            if sel == 100:
                lsize = s.uint8()
                dsize = s.mtef16()
                return SizeRec(size_select=100, lsize=lsize, dsize=dsize)
            dsize = s.uint8()
            return SizeRec(size_select=sel, lsize=sel, dsize=dsize - 128)

        if rec_type in (FULL, SUB, SUB2, SYM, SUBSYM):
            return MarkerRec(record_type=rec_type)

        if rec_type == RULER:
            return EmbellRec(code=-1, options=options)  # 占位：v3 的独立标尺记录

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


def parse(body: bytes) -> V3Equation:
    """解析 MTEF v3 body（已去掉 28 字节 OLE 头）。"""
    parser = _Parser(body)
    header = parser.header()
    records = parser.object_list()
    eq = V3Equation(header=header, records=records,
                    consumed=parser.s.pos, total=len(body))
    eq.errors = parser.errors  # type: ignore[attr-defined]
    return eq


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

SAMPLE_PPTX = r"D:\Agent\各种类型文件\公式图表测试.pptx"
SAMPLE_EMBED = "ppt/embeddings/oleObject3.bin"
# 实测得到的字符序列，作为自测基准。
# 注意 'a' 在 '1' 前面：a₁ 是「CHAR 'a' + 附饰里的 tmSUB 模板」；
# 早先按 mathtypejx 的逐数组对齐读法会多吃 1 字节，把 a 吞掉，得到 =1a2。
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
    if eq.anomaly:
        print("警告：有 MATRIX 的单元数与行列数不符 —— 见文件头「已知未闭合项」第 1 条")


def self_test() -> int:
    """用真实样本跑一遍，断言能走完且字符序列正确。"""
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
    print("结论：%s" % ("通过" if ok else "不通过"))
    return 0 if ok else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv:
        sys.exit(self_test())

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        print("用法：")
        print("  python mtef_v3.py --selftest              跑内置样本自测")
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
