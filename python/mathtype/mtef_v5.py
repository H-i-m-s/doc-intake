# -*- coding: utf-8 -*-
"""MTEF v5（MathType 4.0）记录解析器。

本模块与 python/mathtype/mtef.py 是替代关系（那一个是 zhexiao/mtef-go 的 Python
移植）。不改造它的原因不是风格，而是它有多处与规范不符的读取长度：读错长度之后
reader 会停在不该停的位置，而它仍然继续往下解析，于是得到一段看起来合理的结果。
另外它把 v5 当"平铺流 + makeAST 事后重建嵌套"处理，与规范相反。

规则依据
--------
MathType 官方 MTEF v5 规范（MathType 4.0，1999-08-09）：
    https://rtf2latex2e.sourceforge.net/MTEF5.html
该页是 rtf2latex2e 项目从 Wayback 抢救下来的 MathType 技术文档存档，含全部记录
类型、选项位、整数编码、nudge、类型/字号/对齐取值、维度数组、模板选择子与变体，
以及一份**逐字节范例**：二次方程 x=(-b±√(b²-4ac))/2a 的完整 292 字节（偏移 0-291）。
本模块的自测就拿那份范例当金标准——它不依赖语料，能独立判定解析对不对。

分层
----
规范说 LINE / CHAR / TMPL / PILE / MATRIX / RULER 后面都跟"对象列表"，列表以 END
记录收尾；LINE 带 mtefOPT_LINE_NULL 时整条列表省略（连 END 都没有）。所以 v5 与 v3
一样是真嵌套，这里就按真嵌套读。END 与 RULER 记录不带选项字节，其余记录才带。

与旧 mtef.py 的差异（均按规范）
------------------------------
1. **nudge 长度**。规范：两轴偏移都在 [-128,128) 时写 2 字节（各 +128）；否则先写
   两个 128，再跟两个 16 位有符号值，共 6 字节。旧实现固定先读 2+2 字节，每个带
   nudge 的记录多吃 2 字节。
2. **MATRIX 的行列分隔线**。规范：valign/h_just/v_just/rows/cols 之后紧跟 row_parts、
   col_parts 两组 2-bit 打包值，字节数各为 ceil(((行|列)数+1)*2/8)。旧实现完全没读，
   每个 MATRIX 记录少吃 1 字节以上。
3. **SIZE 记录三种情形**。规范：首字节 101 → 定点字号（后跟 16 位）；100 → 大增量
   （后跟 lsize 1 字节 + dsize 16 位）；其余 → lsize 1 字节 + dsize+128 1 字节。
   旧实现固定读 2 字节，遇到定点字号就错位。
4. **FONT_STYLE_DEF 的第二个字段**。规范：字体定义索引（无符号整数）后跟 char_style
   （1 字节）。旧实现当成 NUL 结尾字符串读。
5. **FUTURE 记录的长度**。规范：记录类型后跟一个**无符号整数**（<255 时 1 字节，
   否则 3 字节）。旧实现固定读 1 字节。
6. **RULER 记录**。规范把 RULER 列为一种记录（类型 7），独立出现时不带选项字节；
   LINE / PILE 的 mtefOPT_LP_RULER 位表示后面跟一条 RULER 记录。旧实现没有类型 7
   的分支，遇到就判不合法。
7. 平铺流 → 真嵌套。旧实现靠 makeAST 从记录数组里重建嵌套，靠"null 的 LINE 不入栈"
   这类约定推进；这里直接按 END 收尾读。

自测基准
--------
1. 规范范例：292 字节逐字节走满，字符/字体风格/选择子序列与 EQN_PREFS 的字号表
   （规范自己标注了 12pt、58%、42%、150%、100%、75%、150%、1pt）逐项对上。
2. 语料：D:\\Agent\\各种类型文件\\ 下 5 个文档里的 v5 公式全部逐字节走满、无 error。
3. 合成字节：小值/大值/负值 nudge、SIZE 三种情形、两字节变体号、FUTURE 跳过长度
   ——这几条范例与语料都没覆盖到。
自测：python mtef_v5.py --selftest

不确定项
--------
- **LP_RULER 之后那份标尺没有记录类型字节**：规范的记录详表把它写成一条 RULER
  记录（带类型字节 7），实测数据里没有，直接就是站数。已按数据实现（见
  _Parser.ruler_record 的注释）。
- **halign / valign / rows / cols 的符号**：规范只给取值含义，没说是否有符号。这里与
  v3 一致按 int8 读，并对 rows/cols 取 max(0, ...) 兜底。语料未出现负值。
- **CHAR 不带 MTCode 时**（mtefOPT_CHAR_ENC_NO_MTCODE）：字符只能靠 8/16 位字体位置
  + 字体编码还原，本模块把 mt_code 记为 -1。渲染层遇到它应当退让。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Tuple

__all__ = [
    "ByteStream",
    "V5Header",
    "V5Equation",
    "CharRec",
    "TmplRec",
    "LineRec",
    "PileRec",
    "MatrixRec",
    "EmbellRec",
    "RulerRec",
    "FontStyleDefRec",
    "SizeRec",
    "MarkerRec",
    "ColorRec",
    "ColorDefRec",
    "FontDefRec",
    "EqnPrefsRec",
    "EncodingDefRec",
    "FutureRec",
    "parse",
    "parse_equation_native",
    "build_equation_native",
    "extract_native_stream",
    "iter_chars",
    "char_sequence",
    "matrix_cells",
    "template_class",
    "selector_name",
    "spec_example",
    "self_test",
]

# ── 常量 ──────────────────────────────────────────────────────────────

# 记录类型（规范「Record types」表）。>=100 是 FUTURE。
END = 0
LINE = 1
CHAR = 2
TMPL = 3
PILE = 4
MATRIX = 5
EMBELL = 6
RULER = 7
FONT_STYLE_DEF = 8
SIZE = 9
FULL = 10
SUB = 11
SUB2 = 12
SYM = 13
SUBSYM = 14
COLOR = 15
COLOR_DEF = 16
FONT_DEF = 17
EQN_PREFS = 18
ENCODING_DEF = 19
FUTURE = 100

TYPE_NAMES = {
    0: "END", 1: "LINE", 2: "CHAR", 3: "TMPL", 4: "PILE", 5: "MATRIX",
    6: "EMBELL", 7: "RULER", 8: "FONT_STYLE_DEF", 9: "SIZE", 10: "FULL",
    11: "SUB", 12: "SUB2", 13: "SYM", 14: "SUBSYM", 15: "COLOR",
    16: "COLOR_DEF", 17: "FONT_DEF", 18: "EQN_PREFS", 19: "ENCODING_DEF",
}

# 选项位。同一数值在不同记录类型上含义不同，按类型解释（规范「Option values」）。
OPT_NUDGE = 0x08            # 所有结构记录：后跟 nudge
OPT_CHAR_EMBELL = 0x01      # CHAR：后跟附饰列表
OPT_CHAR_FUNC_START = 0x02  # CHAR：函数名起始（sin、cos…）
OPT_CHAR_ENC_CHAR8 = 0x04   # CHAR：后跟 8 位字体位置
OPT_CHAR_ENC_CHAR16 = 0x10  # CHAR：后跟 16 位字体位置
OPT_CHAR_ENC_NO_MTCODE = 0x20   # CHAR：不写 16 位 MTCode
OPT_LINE_NULL = 0x01        # LINE：占位行，无子对象，连 END 也省
OPT_LP_RULER = 0x02         # LINE / PILE：后跟 RULER 记录
OPT_LINE_LSPACE = 0x04      # LINE：后跟行距（16 位）
OPT_COLOR_CMYK = 0x01       # COLOR_DEF：CMYK，否则 RGB
OPT_COLOR_SPOT = 0x02       # COLOR_DEF：专色
OPT_COLOR_NAME = 0x04       # COLOR_DEF：带颜色名

# 字号取值（规范「Typesize values」）
TYPESIZE_NAMES = {
    0: "szFULL", 1: "szSUB", 2: "szSUB2", 3: "szSYM",
    4: "szSUBSYM", 5: "szUSER1", 6: "szUSER2", 7: "szDELTA",
}

# 字体风格（规范「Typeface values」）。负值表示显式字体，由 FONT_DEF 记录给出。
TYPEFACE_NAMES = {
    1: "fnTEXT", 2: "fnFUNCTION", 3: "fnVARIABLE", 4: "fnLCGREEK",
    5: "fnUCGREEK", 6: "fnSYMBOL", 7: "fnVECTOR", 8: "fnNUMBER",
    9: "fnUSER1", 10: "fnUSER2", 11: "fnMTEXTRA", 12: "fnTEXT_FE",
    22: "fnEXPAND", 23: "fnMARKER", 24: "fnSPACE",
}

# 字符风格（规范「Character style values」）：位 0 粗体，位 1 斜体。
CHAR_STYLE_NAMES = {0: "plain", 1: "bold", 2: "italic", 3: "bold+italic"}

# 水平/垂直对齐（规范「Horizontal / Vertical alignment values」）
HALIGN_NAMES = {1: "left", 2: "center", 3: "right", 4: "relational", 5: "decimal"}
VALIGN_NAMES = {0: "top", 1: "center", 2: "bottom", 3: "vcenter", 4: "math axis"}

# 模板选择子（规范「Template selectors and variations」）
SELECTORS = {
    0: "tmANGLE", 1: "tmPAREN", 2: "tmBRACE", 3: "tmBRACK", 4: "tmBAR",
    5: "tmDBAR", 6: "tmFLOOR", 7: "tmCEILING", 8: "tmOBRACK", 9: "tmINTERVAL",
    10: "tmROOT", 11: "tmFRACT", 12: "tmUBAR", 13: "tmOBAR", 14: "tmARROW",
    15: "tmINTEG", 16: "tmSUM", 17: "tmPROD", 18: "tmCOPROD", 19: "tmUNION",
    20: "tmINTER", 21: "tmINTOP", 22: "tmSUMOP", 23: "tmLIM", 24: "tmHBRACE",
    25: "tmHBRACK", 26: "tmLDIV", 27: "tmSUB", 28: "tmSUP", 29: "tmSUBSUP",
    30: "tmDIRAC", 31: "tmVEC", 32: "tmTILDE", 33: "tmHAT", 34: "tmARC",
    35: "tmJSTATUS", 36: "tmSTRIKE", 37: "tmBOX",
}

# 选择子 -> 槽位类。类决定子对象的种类与顺序（规范「Template subobject order」）。
TMPL_CLASSES = {}
for _i in range(0, 10):
    TMPL_CLASSES[_i] = "ParBox"        # 主槽位、左围栏字符、右围栏字符
TMPL_CLASSES[10] = "RootBox"           # 主槽位、被开方槽位
TMPL_CLASSES[11] = "FracBox"           # 分子槽位、分母槽位
TMPL_CLASSES[12] = "BarBox"            # 主槽位
TMPL_CLASSES[13] = "BarBox"
TMPL_CLASSES[14] = "ArroBox"           # 主槽位、箭头字符
for _i in range(15, 23):
    TMPL_CLASSES[_i] = "BigOp"         # 主槽位、上槽位、下槽位、大运算符字符
TMPL_CLASSES[23] = "LimBox"            # 主槽位、下槽位、上槽位
TMPL_CLASSES[24] = "HFenceBox"         # 主槽位、小槽位、花括号字符
TMPL_CLASSES[25] = "HFenceBox"
TMPL_CLASSES[26] = "LDivBox"           # 被除槽位、商槽位
for _i in (27, 28, 29):
    TMPL_CLASSES[_i] = "ScrBox"        # 下标槽位、上标槽位
TMPL_CLASSES[30] = "DiracBox"          # 左槽位、右槽位、左尖括号、竖线、右尖括号
for _i in (31, 32, 33, 34, 35):
    TMPL_CLASSES[_i] = "HatBox"        # 主槽位、上标字符
TMPL_CLASSES[36] = "StrikeBox"         # 主槽位
TMPL_CLASSES[37] = "TBoxBox"           # 主槽位
del _i

# 大运算符与极限共用的变体位（规范「Limit variations」）
TV_BO_LOWER = 0x0001
TV_BO_UPPER = 0x0002
TV_BO_SUM = 0x0040

# OLE 复合文件里 Equation Native 流的头长度（EQNOLEFILEHDR；byte 8-11 是 MTEF 长度）
OLE_HEADER_SIZE = 28

# 不带选项字节的记录类型。规范「Record Details」里只有结构记录（LINE / CHAR / TMPL /
# PILE / MATRIX / EMBELL）、COLOR_DEF 与 EQN_PREFS 列了 options 字段，其余都是类型
# 字节后直接接数据。写错这里会从第一条定义记录起就错位。
NO_OPTION_TYPES = frozenset((FONT_STYLE_DEF, SIZE, FULL, SUB, SUB2, SYM, SUBSYM,
                             COLOR, FONT_DEF, ENCODING_DEF))


def template_class(index: int) -> str:
    return TMPL_CLASSES.get(index, "?")


def selector_name(index: int) -> str:
    return SELECTORS.get(index, "tmUNKNOWN_%d" % index)


# ── 字节流 ────────────────────────────────────────────────────────────


class ByteStream:
    """MTEF 字节流读取器。

    v5 的记录头是「类型字节 + 选项字节」，整数有 1 字节与 3 字节两种写法，
    按字节读加两个变长整数读法就够了。"""

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
        """16 位无符号整数：低字节在前。"""
        lo = self.uint8()
        hi = self.uint8()
        return (hi << 8) | lo

    def mt_int16(self) -> int:
        """16 位有符号整数（nudge 的大值形态用）。"""
        v = self.mtef16()
        return v - 65536 if v >= 32768 else v

    def mt_uint(self) -> int:
        """无符号整数：<255 时 1 字节，否则 255 + 低字节 + 高字节。"""
        first = self.uint8()
        if first < 0xFF:
            return first
        lo = self.uint8()
        hi = self.uint8()
        return (hi << 8) | lo

    def mt_int(self) -> int:
        """有符号整数：[-128,127) 时写 value+128 一字节；否则 255 + 低 + 高（value+32768）。"""
        first = self.uint8()
        if first < 0xFF:
            return first - 128
        v = self.mtef16()
        return v - 32768

    def cstring(self) -> str:
        """NUL 结尾字符串。"""
        buf = bytearray()
        while True:
            self._need(1)
            b = self.uint8()
            if b == 0:
                return bytes(buf).decode("latin-1")
            buf.append(b)

    def skip(self, n: int) -> None:
        self._need(n)
        self.pos += n


# ── 记录 ──────────────────────────────────────────────────────────────


@dataclass
class CharRec:
    typeface: int
    mt_code: int                    # 不带 MTCode 时为 -1
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    bits8: Optional[int] = None
    bits16: Optional[int] = None
    embellishments: List[object] = field(default_factory=list)

    @property
    def typeface_name(self) -> str:
        if self.typeface < 0:
            return "字体#%d" % (-self.typeface)
        return TYPEFACE_NAMES.get(self.typeface, "?%d" % self.typeface)

    def glyph(self) -> Optional[str]:
        if 0x20 <= self.mt_code < 0x7F:
            return chr(self.mt_code)
        return None

    def label(self) -> str:
        s = "CHAR %s mt=0x%04X" % (self.typeface_name, self.mt_code)
        g = self.glyph()
        if g is not None:
            s += " %r" % g
        if self.options & OPT_CHAR_FUNC_START:
            s += " 函数名"
        if self.nudge:
            s += " nudge%s" % (self.nudge,)
        if self.embellishments:
            s += " 附饰x%d" % len(self.embellishments)
        return s


@dataclass
class TmplRec:
    selector_index: int
    variation: int
    template_options: int = 0
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None
    slots: List[object] = field(default_factory=list)

    @property
    def selector(self) -> str:
        return selector_name(self.selector_index)

    @property
    def tmpl_class(self) -> str:
        return template_class(self.selector_index)

    def label(self) -> str:
        s = "TMPL #%d %s var=0x%04X 类=%s tattr=0x%02X" % (
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

    @property
    def is_null(self) -> bool:
        return bool(self.options & OPT_LINE_NULL)

    def label(self) -> str:
        s = "LINE opts=0x%02X" % self.options
        if self.is_null:
            s += " 空"
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
        s = "PILE halign=%s valign=%s" % (
            HALIGN_NAMES.get(self.halign, self.halign),
            VALIGN_NAMES.get(self.valign, self.valign))
        if self.nudge:
            s += " nudge%s" % (self.nudge,)
        return s


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
        """单元项：子对象列表里的 LINE。见 matrix_cells()。"""
        return matrix_cells(self)

    @property
    def cell_count_anomaly(self) -> bool:
        return self.expected_cells > 0 and len(self.resolved_cells) != self.expected_cells

    def label(self) -> str:
        n = len(self.resolved_cells)
        s = "MATRIX %dx%d rowparts=%s colparts=%s 单元 %d/%d" % (
            self.rows, self.cols, self.row_parts, self.col_parts, n, self.expected_cells)
        if len(self.cells) != n:
            s += "（列表里另有 %d 项标记）" % (len(self.cells) - n)
        if self.cell_count_anomaly:
            s += "  <- 单元数与行列数不符"
        return s


@dataclass
class EmbellRec:
    code: int
    options: int = 0
    nudge: Optional[Tuple[int, int]] = None

    def label(self) -> str:
        return "EMBELL code=%d" % self.code


@dataclass
class RulerRec:
    """标尺：制表位列表。每站为「类型 1 字节 + 16 位偏移」。"""

    stops: List[Tuple[int, int]] = field(default_factory=list)

    def label(self) -> str:
        return "RULER(%d 站)%s" % (len(self.stops), self.stops if self.stops else "")


@dataclass
class FontStyleDefRec:
    font_def_index: int
    char_style: int

    def label(self) -> str:
        return "FONT_STYLE_DEF 字体#%d style=%s" % (
            self.font_def_index, CHAR_STYLE_NAMES.get(self.char_style, self.char_style))


@dataclass
class SizeRec:
    """SIZE 记录（类型 9）的三种情形。"""

    case: str                          # "point" / "delta" / "large"
    lsize: Optional[int] = None        # typesize 值
    dsize: Optional[int] = None        # 与 lsize 的差值
    point_size: Optional[int] = None   # 定点字号：点数 × 32

    def label(self) -> str:
        if self.case == "point":
            return "SIZE 定点 %.2fpt" % (self.point_size / 32.0)
        if self.case == "large":
            return "SIZE 大增量 lsize=%s dsize=%s" % (
                TYPESIZE_NAMES.get(self.lsize, self.lsize), self.dsize)
        return "SIZE lsize=%s dsize=%s" % (
            TYPESIZE_NAMES.get(self.lsize, self.lsize), self.dsize)


@dataclass
class MarkerRec:
    """FULL / SUB / SUB2 / SYM / SUBSYM：无数据，只影响字号。"""

    record_type: int

    def label(self) -> str:
        return TYPE_NAMES.get(self.record_type, "?%d" % self.record_type)


@dataclass
class ColorRec:
    color_def_index: int

    def label(self) -> str:
        return "COLOR 颜色#%d" % self.color_def_index


@dataclass
class ColorDefRec:
    options: int
    values: List[int] = field(default_factory=list)
    name: Optional[str] = None

    def label(self) -> str:
        model = "CMYK" if self.options & OPT_COLOR_CMYK else "RGB"
        s = "COLOR_DEF %s %s" % (model, self.values)
        if self.name:
            s += " 名字=%r" % self.name
        return s


@dataclass
class FontDefRec:
    enc_def_index: int
    name: str

    def label(self) -> str:
        return "FONT_DEF 编码#%d 字体=%r" % (self.enc_def_index, self.name)


@dataclass
class EqnPrefsRec:
    """EQN_PREFS：字号/间距用 nibble 维度数组，风格用索引表。渲染不需要，读它只为对齐流。"""

    sizes: List[Tuple[str, str]] = field(default_factory=list)
    spaces: List[Tuple[str, str]] = field(default_factory=list)
    styles: List[Tuple[int, int]] = field(default_factory=list)
    options: int = 0

    def label(self) -> str:
        return "EQN_PREFS 字号x%d 间距x%d 风格x%d" % (
            len(self.sizes), len(self.spaces), len(self.styles))


@dataclass
class EncodingDefRec:
    name: str

    def label(self) -> str:
        return "ENCODING_DEF %r" % self.name


@dataclass
class FutureRec:
    length: int

    def label(self) -> str:
        return "FUTURE 跳过 %d 字节" % self.length


@dataclass
class V5Header:
    mtef_version: int
    platform: int
    product: int
    product_version: int
    product_subversion: int
    application: str
    equation_options: int

    @property
    def inline(self) -> bool:
        return bool(self.equation_options & 0x01)

    def label(self) -> str:
        return ("MTEF v5 头: platform=%d product=%d version=%d.%d 应用=%r %s"
                % (self.platform, self.product, self.product_version,
                   self.product_subversion, self.application,
                   "行内方程" if self.inline else "独立方程"))


@dataclass
class V5Equation:
    header: V5Header
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
    def header(self) -> V5Header:
        s = self.s
        return V5Header(
            mtef_version=s.uint8(),
            platform=s.uint8(),
            product=s.uint8(),
            product_version=s.uint8(),
            product_subversion=s.uint8(),
            application=s.cstring(),
            equation_options=s.uint8(),
        )

    # -- nudge --
    def nudge(self) -> Tuple[int, int]:
        """规范「Nudge values」：两轴都在 [-128,128) 时 2 字节（各 +128）；
        否则先写两个 128，再跟两个 16 位有符号偏移。"""
        a = self.s.uint8()
        b = self.s.uint8()
        if a == 128 and b == 128:
            return (self.s.mt_int16(), self.s.mt_int16())
        return (a - 128, b - 128)

    # -- 标尺 --
    def ruler(self) -> RulerRec:
        """RULER 记录的数据部分：站数 + 每站（类型 1 字节 + 16 位偏移）。"""
        n = self.s.uint8()
        stops = [(self.s.uint8(), self.s.mtef16()) for _ in range(n)]
        return RulerRec(stops=stops)

    def ruler_record(self) -> Optional[RulerRec]:
        """LINE / PILE 的 mtefOPT_LP_RULER 之后那份标尺。

        规范把 RULER 列成一种记录（类型 7），LINE 的组成表也写作「[RULER record]」，
        两处都暗示这里应该有个类型字节。实测不是：跟着上来的直接就是站数。

        以 MathType 7 生成的 oleObject4.bin 为例，字节是
            0A | 01 02 | 01 00 30 12 | 02 ...
        即 FULL、LINE（options=0x02）、站数 1、一站（类型 0 + 偏移 0x1230）、
        接着 CHAR 'P' + tmSUB{S}。照着类型字节读就会在 0x01 上卡住，而按站数读
        后面每个字段都整齐，所以这里按数据来。

        读到的内容做个取值范围检查（站数 0-32、站类型 0-4），越界就记一笔 error，
        留给调用方判断。"""
        rec = self.ruler()
        if not (0 <= len(rec.stops) <= 32) or any(t > 4 for t, _ in rec.stops):
            self.errors.append("标尺内容不像标尺（%d 站）" % len(rec.stops))
        return rec

    # -- 行/列分隔线 --
    def parts(self, count: int) -> List[int]:
        """行/列分隔线：每个 2 bit（0 无、1 实、2 虚、3 点），补齐到字节。"""
        s = self.s
        n = max(0, count)
        raw = [s.uint8() for _ in range((n * 2 + 7) // 8)]
        bits = "".join(format(b, "08b") for b in raw)
        return [int(bits[i * 2:i * 2 + 2], 2) for i in range(n)]

    # -- 维度数组（EQN_PREFS） --
    def dimension_array(self) -> List[Tuple[str, str]]:
        """一个维度数组：1 字节个数 + nibble 流。

        每个维度 = 单位 nibble（0 英寸/1 厘米/2 点/3 派卡/4 百分号）+ 值字符串 nibble
        （0-9 数字、0xA 小数点、0xB 负号）+ 0xF 结束。每字节高低位各一个 nibble，值个
        数为奇数时末尾补一个 0 nibble（补的那位落在已读进的字节里，不用额外跳）。"""
        units = {0: "in", 1: "cm", 2: "pt", 3: "pc", 4: "%"}
        count = self.s.uint8()
        pending: List[int] = []
        out: List[Tuple[str, str]] = []

        def take() -> int:
            if not pending:
                byte = self.s.uint8()
                pending.extend((byte >> 4, byte & 0x0F))
            return pending.pop(0)

        for _ in range(count):
            unit = units.get(take(), "?")
            text = ""
            while True:
                nib = take()
                if nib == 0xF:
                    break
                if nib <= 0x9:
                    text += str(nib)
                elif nib == 0xA:
                    text += "."
                elif nib == 0xB:
                    text += "-"
            out.append((unit, text))
        return out

    # -- 子对象列表：遇 END 收尾 --
    def object_list(self) -> List[object]:
        out: List[object] = []
        while self.s.remaining > 0:
            rec_type = self.s.uint8()
            if rec_type == END:          # END 不带选项字节
                return out
            if rec_type >= FUTURE:       # FUTURE：类型后跟无符号整数长度
                length = self.s.mt_uint()
                self.s.skip(length)
                out.append(FutureRec(length=length))
                continue
            if rec_type == RULER:        # RULER 也不带选项字节
                out.append(self.ruler())
                continue
            options = 0 if rec_type in NO_OPTION_TYPES else self.s.uint8()
            try:
                rec = self.record(rec_type, options)
            except EOFError as exc:
                self.errors.append(str(exc))
                return out
            if rec is not None:
                out.append(rec)
        self.errors.append("子对象列表没有遇到 END 就到底了")
        return out

    # -- 单条记录 --
    def record(self, rec_type: int, options: int) -> Optional[object]:
        s = self.s

        if rec_type == CHAR:
            nudge = self.nudge() if options & OPT_NUDGE else None
            typeface = s.mt_int()
            mt_code = -1
            if not (options & OPT_CHAR_ENC_NO_MTCODE):
                mt_code = s.mtef16()
            bits8 = s.uint8() if options & OPT_CHAR_ENC_CHAR8 else None
            bits16 = s.mtef16() if options & OPT_CHAR_ENC_CHAR16 else None
            rec = CharRec(typeface=typeface, mt_code=mt_code, options=options,
                          nudge=nudge, bits8=bits8, bits16=bits16)
            if options & OPT_CHAR_EMBELL:
                rec.embellishments = self.object_list()
            return rec

        if rec_type == TMPL:
            nudge = self.nudge() if options & OPT_NUDGE else None
            index = s.uint8()
            variation = s.uint8()
            if variation & 0x80:      # 变体号 1 或 2 字节，首字节高位表示续读
                variation = (variation & 0x7F) | (s.uint8() << 8)
            template_options = s.uint8()
            rec = TmplRec(selector_index=index, variation=variation,
                          template_options=template_options, options=options, nudge=nudge)
            rec.slots = self.object_list()
            return rec

        if rec_type == LINE:
            nudge = self.nudge() if options & OPT_NUDGE else None
            line_spacing = s.mtef16() if options & OPT_LINE_LSPACE else None
            ruler = self.ruler_record() if options & OPT_LP_RULER else None
            rec = LineRec(options=options, nudge=nudge,
                          line_spacing=line_spacing, ruler=ruler)
            if not rec.is_null:
                rec.objects = self.object_list()
            return rec

        if rec_type == PILE:
            nudge = self.nudge() if options & OPT_NUDGE else None
            halign = s.int8()
            valign = s.int8()
            ruler = self.ruler_record() if options & OPT_LP_RULER else None
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
            row_parts = self.parts(rows + 1)
            col_parts = self.parts(cols + 1)
            rec = MatrixRec(rows=rows, cols=cols, valign=valign, h_just=h_just,
                            v_just=v_just, row_parts=row_parts, col_parts=col_parts,
                            options=options, nudge=nudge)
            rec.cells = self.object_list()
            return rec

        if rec_type == EMBELL:
            nudge = self.nudge() if options & OPT_NUDGE else None
            return EmbellRec(code=s.uint8(), options=options, nudge=nudge)

        if rec_type == FONT_STYLE_DEF:
            return FontStyleDefRec(font_def_index=s.mt_uint(), char_style=s.uint8())

        if rec_type == SIZE:
            first = s.uint8()
            if first == 101:           # 定点字号：后跟 16 位点数（1/32 pt）
                return SizeRec(case="point", point_size=s.mtef16())
            if first == 100:           # 大增量：lsize 1 字节 + dsize 16 位
                return SizeRec(case="large", lsize=s.uint8(), dsize=s.mtef16())
            return SizeRec(case="delta", lsize=first, dsize=s.uint8() - 128)

        if rec_type in (FULL, SUB, SUB2, SYM, SUBSYM):
            return MarkerRec(record_type=rec_type)

        if rec_type == COLOR:
            return ColorRec(color_def_index=s.mt_uint())

        if rec_type == COLOR_DEF:
            n = 4 if options & OPT_COLOR_CMYK else 3
            rec = ColorDefRec(options=options, values=[s.mtef16() for _ in range(n)])
            if options & OPT_COLOR_NAME:
                rec.name = s.cstring()
            return rec

        if rec_type == FONT_DEF:
            return FontDefRec(enc_def_index=s.mt_uint(), name=s.cstring())

        if rec_type == EQN_PREFS:
            rec = EqnPrefsRec(options=options)
            rec.sizes = self.dimension_array()
            rec.spaces = self.dimension_array()
            n = s.uint8()
            for _ in range(n):
                idx = s.mt_uint()
                rec.styles.append((idx, s.uint8() if idx != 0 else 0))
            return rec

        if rec_type == ENCODING_DEF:
            return EncodingDefRec(name=s.cstring())

        self.errors.append("未知记录类型 %d（偏移 %d）" % (rec_type, s.pos - 1))
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

    规范：MATRIX 的子对象列表就是「每格一个 LINE，自左到右、自上而下」。列表里夹杂的
    FULL / SUB / SYM 这类字号标记和 COLOR 这类状态记录都不产出内容，不算单元。

    实测依据（毕业论文里两个矩阵）：
    - oleObject69 的 4x1 矩阵列表有 7 项：4 个 LINE + 3 个 COLOR，去掉 COLOR 正好 4 格；
    - oleObject128 的 2x4 矩阵列表有 15 项：8 个 LINE + 5 个 FULL + 2 个 COLOR。
    所以只把 LINE 当单元。空单元格是带 mtefOPT_LINE_NULL 的 LINE，仍算一格。

    若结果个数与 rows*cols 不符，MatrixRec.cell_count_anomaly 为 True，调用方应退回
    公式预览图，不要硬渲染。
    """
    return [c for c in matrix.cells if isinstance(c, LineRec)]


def parse(body: bytes) -> V5Equation:
    """解析 MTEF v5 body（已去掉 28 字节 OLE 头）。"""
    parser = _Parser(body)
    header = parser.header()
    records = parser.object_list()
    return V5Equation(header=header, records=records,
                      consumed=parser.s.pos, total=len(body),
                      errors=parser.errors)


def parse_equation_native(stream: bytes) -> V5Equation:
    """解析完整的 Equation Native 流（含 28 字节 EQNOLEFILEHDR）。"""
    if len(stream) < OLE_HEADER_SIZE:
        raise ValueError("Equation Native 流太短：%d 字节" % len(stream))
    cb_hdr = int.from_bytes(stream[0:2], "little")
    cb_size = int.from_bytes(stream[8:12], "little")
    if cb_hdr != OLE_HEADER_SIZE:
        raise ValueError("EQNOLEFILEHDR 长度不是 28，而是 %d" % cb_hdr)
    body = stream[cb_hdr:cb_hdr + cb_size]
    return parse(body)


def build_equation_native(body: bytes) -> bytes:
    """把 MTEF body 打包成 Equation Native 流（含 28 字节 OLE 头），自测用。"""
    return (OLE_HEADER_SIZE.to_bytes(2, "little")
            + (0x00020000).to_bytes(4, "little")
            + (0).to_bytes(2, "little")
            + len(body).to_bytes(4, "little")
            + b"\x00" * 16
            + body)


def extract_native_stream(ole_bin: bytes,
                          names=("Equation Native", "EquationNative", "Equation")) -> bytes:
    """从 OLE 复合文件字节里取出 Equation Native 流。

    与 mtef_v3.py 的同名函数一致，各自独立实现以免两个版本互相牵连。
    """
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
    for r in _walk(records):
        if isinstance(r, CharRec):
            yield r


def char_sequence(eq: V5Equation) -> List[int]:
    return [c.mt_code for c in iter_chars(eq.records)]


# ── 金标准：规范里那份 292 字节范例 ───────────────────────────────────
#
# 二次方程 x=(-b±√(b²-4ac))/2a 的完整 MTEF，逐字节抄自规范的「Example」一节
# （偏移 0-291，每个字节在规范里都有标注）。这份数据不依赖语料，可以独立判定
# 解析对不对。
#
# 结构：文件头 → ENCODING_DEF → 4 条 FONT_DEF → EQN_PREFS → SIZE_FULL
#       → LINE（内容 = SIZE_FULL + tmFRACT{分子行, 分母行}）→ END

_SPEC_PARTS = [
    # (起始偏移, 十六进制, 说明)。每段的字节数必须正好接上下一段的偏移，
    # 抄错任何一个字节都会在 _spec_example() 里被断言拦住。
    (0, "0501000400", "文件头：v5 / Windows / MathType / 4.0"),
    (5, "44534D543400", '应用键 "DSMT4" + NUL'),
    (11, "00", "方程选项（0 = 独立方程）"),
    (12, "13" "57696E416C6C4261736963436F64655061676573" "00",
     'ENCODING_DEF "WinAllBasicCodePages"'),
    (34, "11" "05" "54696D6573204E657720526F6D616E" "00",
     'FONT_DEF #1：编码 5 + "Times New Roman"'),
    (52, "11" "03" "53796D626F6C" "00",
     'FONT_DEF #2：编码 3（Symbol）+ "Symbol"'),
    (61, "11" "05" "436F7572696572204E6577" "00",
     'FONT_DEF #3：编码 5 + "Courier New"'),
    (75, "11" "04" "4D54204578747261" "00",
     'FONT_DEF #4：编码 4（MTExtra）+ "MT Extra"'),
    (86, "12" "00" "08" "212F458F442F4150F4100F475F4150F21F",
     "EQN_PREFS：options 0、字号数组个数 8、8 项字号 nibble 流"),
    (106, "1E"
     "4150F4150F" "4100F445F4" "25F48F425F" "4100F4100F"
     "435F4100F4" "8F45F42A5F" "48F48F4100" "F4100F40F4"
     "8F417F48F4" "100F412A5F" "445F45F45F" "45F45F410F",
     "间距数组个数 30 + 30 项 nibble 流（60 字节）"),
    (167, "0C"
     "0100" "0100" "0102" "0202" "0200" "0200"
     "0101" "0100" "0300" "0100" "0400" "00",
     "风格数组个数 12 + 12 项（索引 0 时省掉 char_style 字节）"),
    (191, "0A", "SIZE_FULL"),
    (192, "0100", "LINE（方程行，options 0）"),
    (194, "03000B0000", "tmFRACT：selector 11、变体 0、模板选项 0"),
    (199, "0100", "分子行"),
    (201, "02" "04" "86" "1222" "2D", "CHAR −（MTCode U+2212，带 8 位字体位置 0x2D）"),
    (207, "02" "00" "83" "62" "00", "CHAR b"),
    (212, "02" "04" "86" "B100" "B1", "CHAR ±"),
    (218, "03000A0000", "tmROOT：selector 10、变体 0（平方根）"),
    (223, "0100", "被开方行"),
    (225, "02" "00" "83" "62" "00", "CHAR b"),
    (230, "03001C0000", "tmSUP：selector 28"),
    (235, "0B", "SIZE_SUB"),
    (236, "0101", "第一个槽位：空行（mtefOPT_LINE_NULL，列表整个省略）"),
    (238, "0100" "0200" "88" "32" "00", "第二个槽位：CHAR 2"),
    (245, "0000", "END 槽位行 + END tmSUP"),
    (247, "0A", "SIZE_FULL"),
    (248, "02" "04" "86" "1222" "2D", "CHAR −"),
    (254, "02" "00" "88" "34" "00", "CHAR 4"),
    (259, "02" "00" "83" "61" "00", "CHAR a"),
    (264, "02" "00" "83" "63" "00", "CHAR c"),
    (269, "00", "END 被开方行"),
    (270, "0B" "0101", "SIZE_SUB + 被开方槽空行"),
    (273, "00", "END tmROOT"),
    (274, "00", "END 分子行"),
    (275, "0A" "0100", "SIZE_FULL + 分母行"),
    (278, "02" "00" "88" "32" "00", "CHAR 2"),
    (283, "02" "00" "83" "61" "00", "CHAR a"),
    (288, "00", "END 分母行"),
    (289, "00", "END tmFRACT"),
    (290, "00", "END 方程行"),
    (291, "00", "END 方程"),
]

SPEC_EXAMPLE_LEN = 292
# 范例里的字符 MTCode 序列（−b±丨b²−4ac丨 除以 2a），共 11 个
EXPECTED_CODES = [0x2212, 0x0062, 0x00B1, 0x0062, 0x0032,
                  0x2212, 0x0034, 0x0061, 0x0063, 0x0032, 0x0061]
EXPECTED_TYPEFACES = [6, 3, 6, 3, 8, 6, 8, 3, 3, 8, 3]
EXPECTED_SELECTORS = [11, 10, 28]          # tmFRACT、tmROOT、tmSUP
EXPECTED_APPKEY = "DSMT4"
# 规范自己标注的 8 个字号："12 points"、"58 %"、"42 %"、"150 %"、"100 %"、
# "75 %"、"150 %"、"1 point"
EXPECTED_SIZES = [("pt", "12"), ("%", "58"), ("%", "42"), ("%", "150"),
                  ("%", "100"), ("%", "75"), ("%", "150"), ("pt", "1")]

_SPEC_EXAMPLE_CACHE: Optional[bytes] = None


def spec_example() -> bytes:
    """规范「Example」一节那份 292 字节范例。

    按偏移分段拼接，并断言每段恰好落在它声明的偏移上——偏移表来自规范自己的
    字节表，所以任何抄写错误都会立刻变成断言失败，而不是一段悄悄错位的字节。
    """
    global _SPEC_EXAMPLE_CACHE
    if _SPEC_EXAMPLE_CACHE is not None:
        return _SPEC_EXAMPLE_CACHE
    buf = bytearray()
    for offset, hexstr, note in _SPEC_PARTS:
        if len(buf) != offset:
            raise AssertionError(
                "范例第 %d 段偏移不对：应在 %d，实际 %d（%s）"
                % (_SPEC_PARTS.index((offset, hexstr, note)), offset, len(buf), note))
        buf += bytes.fromhex(hexstr)
    if len(buf) != SPEC_EXAMPLE_LEN:
        raise AssertionError("范例总长 %d，应为 %d" % (len(buf), SPEC_EXAMPLE_LEN))
    _SPEC_EXAMPLE_CACHE = bytes(buf)
    return _SPEC_EXAMPLE_CACHE


# ── 演示与自测 ────────────────────────────────────────────────────────

CORPUS_DIR = r"D:\Agent\各种类型文件"
# 语料里含 v5 公式的文档（相对 CORPUS_DIR）
CORPUS_FILES = [
    "公式图表测试.pptx",
    "这是一个公式测试文件.docx",
    "复杂—翻车机公式及表格图片处理.docx",
    "翻转课堂计算报告带公式.docx",
    "01 毕业论文：波浪适应救助船结构设计与平顺性分析_李杨.docx",
]
# 第一次跑通后填的基准：(文档数, v5 对象数, 走满且无 error 的对象数)
CORPUS_EXPECTED = (5, 165, 165)


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


def _demo(body: bytes) -> None:
    print("MTEF body %d 字节" % len(body))
    eq = parse(body)
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
    for e in eq.errors[:5]:
        print("提示：%s" % e)
    for m in _walk(eq.records):
        if isinstance(m, MatrixRec) and m.cell_count_anomaly:
            print("警告：%s" % m.label())


def _native_streams(path):
    """产出 (OLE 成员名, Equation Native 原始字节)。"""
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
            if raw:
                yield os.path.basename(name), raw


def _corpus_report(baseline=None) -> int:
    """把语料里的 v5 公式跑一遍，报告解析质量。

    验收口径：所有 v5 对象都恰好把 body 消耗干净、且没有 error 记录。
    对齐不上就说明读取长度有偏差，正是这套自测要盯的东西。
    """
    import os

    if not os.path.isdir(CORPUS_DIR):
        print("语料目录不存在，跳过：%s" % CORPUS_DIR)
        return 2

    files = 0
    objects = 0
    v5 = 0
    clean = 0
    incomplete = []
    errored = []
    matrix_bad = []
    selector_tally = {}
    class_tally = {}
    typeface_tally = {}
    chars = 0
    nudge_chars = 0

    for fname in CORPUS_FILES:
        path = os.path.join(CORPUS_DIR, fname)
        if not os.path.exists(path):
            print("  缺文件：%s" % fname)
            continue
        files += 1
        for member, raw in _native_streams(path):
            objects += 1
            if len(raw) < 29 or raw[28] != 5:
                continue
            v5 += 1
            try:
                eq = parse_equation_native(raw)
            except Exception as exc:
                errored.append("%s/%s 异常 %s" % (fname, member, type(exc).__name__))
                continue
            if eq.complete and not eq.errors:
                clean += 1
            else:
                if not eq.complete:
                    incomplete.append("%s/%s 消耗 %d/%d"
                                      % (fname, member, eq.consumed, eq.total))
                if eq.errors:
                    errored.append("%s/%s %s" % (fname, member, eq.errors[0]))
            for r in _walk(eq.records):
                name = type(r).__name__
                if name == "TmplRec":
                    selector_tally[r.selector] = selector_tally.get(r.selector, 0) + 1
                    cls = r.tmpl_class
                    class_tally[cls] = class_tally.get(cls, 0) + 1
                elif name == "CharRec":
                    chars += 1
                    tf = r.typeface_name
                    typeface_tally[tf] = typeface_tally.get(tf, 0) + 1
                    if r.nudge:
                        nudge_chars += 1
                elif name == "MatrixRec" and r.cell_count_anomaly:
                    matrix_bad.append("%s/%s %s" % (fname, member, r.label()))

    print("语料：%s" % CORPUS_DIR)
    print("文档 %d 个，OLE 对象 %d 个，其中 v5 %d 个" % (files, objects, v5))
    print("走满且无 error：%d" % clean)
    print("字符 %d 个（带 nudge 的 %d 个）" % (chars, nudge_chars))
    print("模板类：%s" % dict(sorted(class_tally.items(), key=lambda kv: -kv[1])))
    print("选择子：%s" % dict(sorted(selector_tally.items(), key=lambda kv: -kv[1])))
    print("字体风格：%s" % dict(sorted(typeface_tally.items(), key=lambda kv: -kv[1])))
    if incomplete:
        print("没有走满 %d 个：" % len(incomplete))
        for s in incomplete[:8]:
            print("  %s" % s)
    if errored:
        print("有 error %d 个：" % len(errored))
        for s in errored[:8]:
            print("  %s" % s)
    if matrix_bad:
        print("矩阵单元数不符 %d 个：" % len(matrix_bad))
        for s in matrix_bad[:5]:
            print("  %s" % s)
    if baseline is None:
        print("结论：尚未填基准（第一次跑通后把上面三个数填进 CORPUS_EXPECTED）")
        return 0
    want_files, want_v5, want_clean = baseline
    ok = (files == want_files and v5 == want_v5 and clean == want_clean)
    print("结论：%s" % ("通过" if ok else "不通过（解析质量有变化，请人工核对）"))
    return 0 if ok else 1


def _micro_tests() -> List[str]:
    """范例与语料都没覆盖到的分支，用合成字节锁住行为。

    覆盖：小值 / 大值 / 负值 nudge（语料里没有带 nudge 的记录）、SIZE 记录三种情形
    （范例里只有 FULL / SUB 标记）、变体号占两个字节、FUTURE 记录的跳过长度。
    """
    fails: List[str] = []
    # 12 字节文件头：v5 / Windows / MathType / 4.0 / "DSMT4" / 方程选项 0
    head = "0501000400" + "44534D5434" + "00" + "00"

    def one(name: str, tail: str, fn) -> None:
        try:
            eq = parse(bytes.fromhex(head + tail))
        except Exception as exc:
            fails.append("%s 抛异常：%s" % (name, exc))
            return
        if not eq.complete:
            fails.append("%s 没走满（%d/%d）" % (name, eq.consumed, eq.total))
            return
        why = fn(eq)
        if why:
            fails.append("%s：%s" % (name, why))

    def one_char(eq):
        chars = list(iter_chars(eq.records))
        return chars[0] if len(chars) == 1 else None

    def t_nudge_small(eq):
        c = one_char(eq)
        if c is None:
            return "字符数不是 1"
        if c.nudge != (3, -5):
            return "nudge=%s（应 (3, -5)）" % (c.nudge,)
        if c.mt_code != 0x41:
            return "MTCode=0x%04X（应 0x0041）" % c.mt_code
        return None

    def t_nudge_large(eq):
        c = one_char(eq)
        if c is None:
            return "字符数不是 1"
        if c.nudge != (300, -300):
            return "nudge=%s（应 (300, -300)）" % (c.nudge,)
        return None

    def sizes_of(eq):
        return [r for r in _walk(eq.records) if isinstance(r, SizeRec)]

    def t_size_point(eq):
        got = sizes_of(eq)
        if len(got) != 1 or got[0].case != "point" or got[0].point_size != 384:
            return "定点字号读成 %s" % (got[0].label() if got else "无")
        return None

    def t_size_large(eq):
        got = sizes_of(eq)
        if (len(got) != 1 or got[0].case != "large"
                or got[0].lsize != 0 or got[0].dsize != 300):
            return "大增量字号读成 %s" % (got[0].label() if got else "无")
        return None

    def t_size_delta(eq):
        got = sizes_of(eq)
        if (len(got) != 1 or got[0].case != "delta"
                or got[0].lsize != 3 or got[0].dsize != 0):
            return "增量字号读成 %s" % (got[0].label() if got else "无")
        return None

    def t_variation2(eq):
        got = [r for r in _walk(eq.records) if isinstance(r, TmplRec)]
        if len(got) != 1 or got[0].selector_index != 15 or got[0].variation != 1:
            return "模板读成 %s" % (got[0].label() if got else "无")
        return None

    def t_future(eq):
        got = [r for r in _walk(eq.records) if isinstance(r, FutureRec)]
        if len(got) != 1 or got[0].length != 3:
            return "FUTURE 读成 %s" % (got[0].label() if got else "无")
        if len(list(iter_chars(eq.records))) != 1:
            return "跳过 FUTURE 之后的字符没读到"
        return None

    # 一条 LINE（options 0）里一个 CHAR，CHAR 带 mtefOPT_NUDGE
    one("小值 nudge", "0A" "0100" "02" "08" "837B" "83" "4100" "00" "00",
        t_nudge_small)
    one("大值 nudge", "0A" "0100" "02" "08" "8080" "2C01" "D4FE" "83" "4100"
        "00" "00", t_nudge_large)
    # SIZE：定点（101 + 16 位点数）、大增量（100 + lsize + 16 位）、增量（lsize + dsize+128）
    one("SIZE 定点", "09" "65" "8001" "0A" "0100" "0200" "83" "4100" "00" "00",
        t_size_point)
    one("SIZE 大增量", "09" "64" "00" "2C01" "0A" "0100" "0200" "83" "4100" "00" "00",
        t_size_large)
    one("SIZE 增量", "09" "03" "80" "0A" "0100" "0200" "83" "4100" "00" "00",
        t_size_delta)
    # 变体号首字节高位 0x80 表示续读：0x81 0x00 -> 变体 1
    one("两字节变体号", "0A" "0100" "03" "00" "0F" "8100" "00" "00" "00",
        t_variation2)
    # FUTURE：类型 >=100，后跟无符号整数长度
    one("FUTURE 跳过", "0A" "0100" "64" "03" "AABBCC" "02" "00" "83" "4100"
        "00" "00", t_future)
    return fails


def self_test() -> int:
    """用规范范例与真实语料验收解析器。"""
    ok = True

    print("── 规范范例：二次方程 292 字节 ──")
    body = spec_example()
    print("范例长度 %d 字节（应为 %d）" % (len(body), SPEC_EXAMPLE_LEN))
    if len(body) != SPEC_EXAMPLE_LEN:
        print("失败：范例长度不符，说明抄字节时漏了或多了")
        return 1

    eq = parse(body)
    print("消耗 %d/%d 字节 -> %s" % (eq.consumed, eq.total,
                                     "走满" if eq.complete else "未走满"))
    if not eq.complete:
        print("失败：没有恰好消耗完 body")
        ok = False
    if eq.errors:
        print("失败：有 error %s" % eq.errors)
        ok = False
    if eq.header.mtef_version != 5 or eq.header.application != EXPECTED_APPKEY:
        print("失败：文件头不对（版本 %s，应用键 %r）"
              % (eq.header.mtef_version, eq.header.application))
        ok = False

    codes = char_sequence(eq)
    if codes != EXPECTED_CODES:
        print("失败：字符序列不符")
        print("  期望 %s" % ["0x%04X" % c for c in EXPECTED_CODES])
        print("  实际 %s" % ["0x%04X" % c for c in codes])
        ok = False
    else:
        print("字符 %d 个，MTCode 序列与规范一致" % len(codes))

    faces = [c.typeface for c in iter_chars(eq.records)]
    if faces != EXPECTED_TYPEFACES:
        print("失败：字体风格序列不符 %s != %s" % (faces, EXPECTED_TYPEFACES))
        ok = False

    selectors = [r.selector_index for r in _walk(eq.records)
                 if isinstance(r, TmplRec)]
    if selectors != EXPECTED_SELECTORS:
        print("失败：模板选择子序列不符 %s != %s" % (selectors, EXPECTED_SELECTORS))
        ok = False

    prefs = [r for r in _walk(eq.records) if isinstance(r, EqnPrefsRec)]
    if not prefs:
        print("失败：没有读到 EQN_PREFS")
        ok = False
    else:
        got = prefs[0].sizes
        if got != EXPECTED_SIZES:
            print("失败：字号表不符")
            print("  期望 %s" % EXPECTED_SIZES)
            print("  实际 %s" % got)
            ok = False
        else:
            print("字号表 8 项与规范标注一致：%s" % got)
        if len(prefs[0].spaces) != 30 or len(prefs[0].styles) != 12:
            print("失败：间距 %d 项（应 30）、风格 %d 项（应 12）"
                  % (len(prefs[0].spaces), len(prefs[0].styles)))
            ok = False
        elif prefs[0].styles[3] != (2, 2):
            print("失败：第 4 项风格应 (2, 2)，实际 %s" % (prefs[0].styles[3],))
            ok = False

    # 结构：顶层一条 LINE，其内容为 SIZE_FULL + tmFRACT；分式两个槽位；
    # 分子行末是 tmROOT，根号里 tmSUP 的第一个槽位是空行、'2' 在第二个槽位
    lines = [r for r in eq.records if isinstance(r, LineRec)]
    if len(lines) != 1:
        print("失败：顶层 LINE 应有 1 条，实际 %d" % len(lines))
        ok = False
    else:
        tops = [r for r in lines[0].objects if isinstance(r, TmplRec)]
        if len(tops) != 1 or tops[0].selector_index != 11:
            print("失败：方程行内容不是单一个 tmFRACT")
            ok = False
        else:
            slots = [x for x in tops[0].slots if isinstance(x, LineRec)]
            if len(slots) != 2:
                print("失败：tmFRACT 的 LINE 槽位数应为 2，实际 %d" % len(slots))
                ok = False
            roots = [r for r in _walk(slots) if isinstance(r, TmplRec)
                     and r.selector_index == 10]
            sups = [r for r in _walk(slots) if isinstance(r, TmplRec)
                    and r.selector_index == 28]
            if len(roots) != 1 or len(sups) != 1:
                print("失败：分子里应恰好一个 tmROOT 与一个 tmSUP")
                ok = False
            else:
                sup_lines = [x for x in sups[0].slots if isinstance(x, LineRec)]
                if len(sup_lines) != 2:
                    print("失败：tmSUP 的 LINE 槽位数应为 2，实际 %d" % len(sup_lines))
                    ok = False
                else:
                    first, second = sup_lines
                    if not first.is_null:
                        print("失败：tmSUP 第一个槽位应是空行")
                        ok = False
                    elif "2" not in [chr(c.mt_code) for c in iter_chars([second])
                                     if c.mt_code >= 0]:
                        print("失败：tmSUP 第二个槽位里没有 '2'")
                        ok = False
                    else:
                        print("结构：顶层 1 条 LINE → tmFRACT(2 槽) → 分子含 tmROOT"
                              " → tmSUP 第一个槽位空、'2' 在第二个槽位")

    # OLE 头路径
    stream = build_equation_native(body)
    eq2 = parse_equation_native(stream)
    if eq2.consumed != SPEC_EXAMPLE_LEN or not eq2.complete:
        print("失败：带 EQNOLEFILEHDR 的路径没走满")
        ok = False

    print("范例结论：%s" % ("通过" if ok else "不通过"))

    print()
    print("── 范例与语料都没覆盖到的分支（合成字节）──")
    micro = _micro_tests()
    if micro:
        for s in micro:
            print("失败：%s" % s)
        ok = False
    else:
        print("小值/大值/负值 nudge、SIZE 三种情形、两字节变体号、FUTURE 跳过：都通过")

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
        _demo(spec_example())
        sys.exit(0)

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        print("用法：")
        print("  python mtef_v5.py --selftest          跑规范范例与语料自测")
        print("  python mtef_v5.py --example           打印规范范例的记录树")
        print("  python mtef_v5.py <oleObject.bin>     解析单个 OLE 嵌入对象")
        sys.exit(0)

    path = args[0]
    if path.lower().endswith((".pptx", ".docx")):
        import zipfile

        member = args[1] if len(args) > 1 else None
        with zipfile.ZipFile(path) as z:
            cands = sorted(n for n in z.namelist()
                           if n.endswith(".bin") and "/embeddings/" in n)
            if member:
                cands = [n for n in cands if member in n]
            if not cands:
                print("文档里没有嵌入对象")
                sys.exit(1)
            raw = z.read(cands[0])
        stream = extract_native_stream(raw)
        print("嵌入对象：%s（Equation Native %d 字节）" % (cands[0], len(stream)))
        _demo(stream[OLE_HEADER_SIZE:])
    else:
        with open(path, "rb") as fp:
            data = fp.read()
        stream = extract_native_stream(data)
        _demo(stream[OLE_HEADER_SIZE:])
