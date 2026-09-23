"""v5 解析器自测：记录树打印、微测试、语料走查；附 spec_example/build_equation_native

用法：python test/selftest_v5_parse.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）
"""

from __future__ import annotations

import os
import sys

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
for _p in (os.path.join(_APP_DIR, "python"),
           os.path.join(_APP_DIR, "python", "mathtype")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import mtef_v5 as _lib

# 把库模块的全局名（含私有名）注入本模块，下面搬过来的代码就能原样使用它们。
globals().update({_k: _v for _k, _v in vars(_lib).items()
                  if not _k.startswith("__") and _k not in ("spec_example", "build_equation_native")})

# 样本与语料位置：从 app 目录推出来，不依赖库里残留的常量
_SAMPLES = os.path.join(_APP_DIR, "python", "mathtype", "samples")
CORPUS_DIR = os.path.join(_SAMPLES, "corpus")

# 规范范例的长度与缓存（原来在库里，只有自测用得到）
SPEC_EXAMPLE_LEN = 292
_SPEC_EXAMPLE_CACHE: Optional[bytes] = None

# ↓↓↓ 以下是从 mtef_v5.py 原样搬过来的测试/调试代码 ↓↓↓
def build_equation_native(body: bytes) -> bytes:
    """把 MTEF body 打包成 Equation Native 流（含 28 字节 OLE 头），自测用。"""
    return (OLE_HEADER_SIZE.to_bytes(2, "little")
            + (0x00020000).to_bytes(4, "little")
            + (0).to_bytes(2, "little")
            + len(body).to_bytes(4, "little")
            + b"\x00" * 16
            + body)


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

import os as _os

# 语料走查看 samples/corpus/：仓库里不带，所以平时是跳过。想跑就把语料文件丢进那个
# 目录，不用改代码，也没有任何环境变量。
# 语料里含 v5 公式的文档：不问名字，把 CORPUS_DIR 下的 docx/pptx 全扫一遍。
def _corpus_files():
    import glob as _glob
    if not _os.path.isdir(CORPUS_DIR):
        return []
    out = []
    for ext in ("*.docx", "*.pptx"):
        out.extend(_os.path.basename(p)
                   for p in sorted(_glob.glob(_os.path.join(CORPUS_DIR, ext))))
    return out


CORPUS_FILES = _corpus_files()
# 基准（文档数, v5 对象数, 走满且无 error 的对象数）。语料是私人的、不进仓库，
# 所以默认不设基准：只报告数字，不判定通过与否。
CORPUS_EXPECTED = None


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
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")
    import sys

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)

    if "--example" in sys.argv:
        _demo(spec_example())
        sys.exit(0)

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        print("用法：")
        print("  python test/selftest_v5_parse.py          跑规范范例与语料自测")
        print("  python test/selftest_v5_parse.py --example           打印规范范例的记录树")
        print("  python test/selftest_v5_parse.py <oleObject.bin>     解析单个 OLE 嵌入对象")
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
