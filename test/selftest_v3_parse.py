"""v3 解析器自测：记录树打印、样本与语料走查

用法：python test/selftest_v3_parse.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）
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

import mtef_v3 as _lib

# 把库模块的全局名（含私有名）注入本模块，下面搬过来的代码就能原样使用它们。
globals().update({_k: _v for _k, _v in vars(_lib).items()
                  if not _k.startswith("__") and _k not in ()})

# 样本与语料位置：从 app 目录推出来，不依赖库里残留的常量
_SAMPLES = os.path.join(_APP_DIR, "python", "mathtype", "samples")
CORPUS_DIR = os.path.join(_SAMPLES, "corpus")

# 样本 pptx 里的那个对象（原来在库里）
SAMPLE_EMBED = "ppt/embeddings/oleObject3.bin"

# ↓↓↓ 以下是从 mtef_v3.py 原样搬过来的测试/调试代码 ↓↓↓

import os as _os

# 样本路径与基准（原来在库里，只有测试用得到，跟着搬过来）
_SAMPLES = _os.path.join(_APP_DIR, "python", "mathtype", "samples")
SAMPLE_PPTX = _os.path.join(_SAMPLES, "公式图表测试.pptx")
CORPUS_PPTX = _os.path.join(_SAMPLES, "第二章_信息与信息论.pptx")
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
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")
    import sys

    if "--selftest" in sys.argv:
        rc = self_test()
        print()
        rc2 = _corpus_report()
        sys.exit(0 if max(rc, rc2) in (0, 2) else 1)

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        print("用法：")
        print("  python test/selftest_v3_parse.py              跑内置样本与语料自测")
        print("  python test/selftest_v3_parse.py <oleObject.bin>         解析单个 OLE 嵌入对象")
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
