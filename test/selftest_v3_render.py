"""v3 渲染器自测：408 字符基准逐项对预览图

用法：python test/selftest_v3_render.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）
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

import mtef_v3_latex as _lib

# 把库模块的全局名（含私有名）注入本模块，下面搬过来的代码就能原样使用它们。
globals().update({_k: _v for _k, _v in vars(_lib).items()
                  if not _k.startswith("__") and _k not in ()})

# 样本与语料位置：从 app 目录推出来，不依赖库里残留的常量
_SAMPLES = os.path.join(_APP_DIR, "python", "mathtype", "samples")
CORPUS_DIR = os.path.join(_SAMPLES, "corpus")

from selftest_v3_parse import SAMPLE_PPTX, CORPUS_PPTX, SAMPLE_EMBED

# ↓↓↓ 以下是从 mtef_v3_latex.py 原样搬过来的测试/调试代码 ↓↓↓
def self_test() -> int:
    """用真实样本验收：渲染结果应与该公式的兜底预览图一致。"""
    import zipfile

    try:
        from . import mtef_v3 as m3
    except ImportError:
        import mtef_v3 as m3

    print("样本：%s" % SAMPLE_PPTX)
    try:
        with zipfile.ZipFile(SAMPLE_PPTX) as z:
            stream = m3.extract_native_stream(z.read(SAMPLE_EMBED))
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
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")
    import sys

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)
    print(__doc__)
    print("用法：python test/selftest_v3_render.py")
