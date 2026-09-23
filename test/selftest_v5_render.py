"""v5 渲染器自测：规范范例、新增覆盖、真机样本、语料走查

用法：python test/selftest_v5_render.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）
"""

from __future__ import annotations

import os
import os as _os
import sys

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
for _p in (os.path.join(_APP_DIR, "python"),
           os.path.join(_APP_DIR, "python", "mathtype")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import mtef_v5_latex as _lib

# 把库模块的全局名（含私有名）注入本模块，下面搬过来的代码就能原样使用它们。
globals().update({_k: _v for _k, _v in vars(_lib).items()
                  if not _k.startswith("__") and _k not in ()})

# 样本与语料位置：从 app 目录推出来，不依赖库里残留的常量
_SAMPLES = os.path.join(_APP_DIR, "python", "mathtype", "samples")
CORPUS_DIR = os.path.join(_SAMPLES, "corpus")

from selftest_v5_parse import spec_example, build_equation_native

# ↓↓↓ 以下是从 mtef_v5_latex.py 原样搬过来的测试/调试代码 ↓↓↓
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


REAL_SAMPLE = _os.path.join(_SAMPLES, "公式测试.docx")
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
    eq = m5.parse(spec_example())
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
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")
    import sys

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)

    if "--example" in sys.argv:
        eq = m5.parse(spec_example())
        latex, notes = render(eq)
        print(latex or "（渲染失败：%s）" % notes)
        sys.exit(0)

    print(__doc__)
    print("用法：")
    print("  python test/selftest_v5_render.py    跑范例与语料自测")
    print("  python test/selftest_v5_render.py --example     渲染规范范例")
