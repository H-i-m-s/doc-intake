"""v13 GDI+ 渲染后端自测：`wmf_render` 直调 gdiplus.dll，以及 `convert_emf_to_png` 走它的那条路。

用法：python -m test.selftest_v13_gdi_render      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 10 个真实 WMF 全部渲染成功、输出是有效 PNG（Pillow 能开、长边 1440）。
  2. 比例：image5.wmf（\\overrightarrow{AB}）的墨迹外接框宽高比 ≈1.31，Pillow 版 1.18
     拦在窗口外 —— 这一条要能区分两个后端，不是随口给个数字。
  3. 箭头连续性：image5.wmf 裁好之后顶部 15% 横向带里墨迹连通域 = 1（Pillow 版 4）。
  4. 空白判据不回归：纯白图走 `convert_emf_to_png` 仍被判空白，正常公式仍不空白。
  5. GDI+ 不可用时回退 Pillow：monkeypatch `is_available` 返回 False，转换不抛、不走 GDI+。
  6. `render_to_png` 的失败路径：垃圾输入返回 False 而不是抛；重复调用不因句柄复用出问题；
     单张超过体积上限时仍是 GDI+ 换长边重渲，不退回 Pillow。

样本：优先用本机那份真实公式预览图目录（10 个 WMF，MathType 出的）；不在就用
`test/fixtures/formula_preview.wmf` 复制 10 份顶上，比例与连通域两条只在真实样本上判定；
连 fixture 都没有就整篇跳过，返回 0 而不是报错。
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

from extractors import emf_converter  # noqa: E402
from extractors import wmf_render  # noqa: E402
from extractors.emf_converter import convert_emf_to_png, preview_is_blank  # noqa: E402

FIXTURE_WMF = os.path.join(_TEST_DIR, "fixtures", "formula_preview.wmf")
# 本机那份真样本目录（10 个 MathType 公式预览图）。只在这台机器上有；换机器就退回 fixture 副本。
LOCAL_WMF_DIR = os.environ.get(
    "DOC_INTAKE_WMF_SAMPLES", r"D:\Agent\各种类型文件\公式测试\mathtype\raw"
)

_LONG_SIDE = 1440
_SAMPLE_COUNT = 10
# image5.wmf 的墨迹宽高比。工单里给的预期是「约 1.31」，同时又写「1.25±3%」——这两个数
# 互斥（1.31 已经比 1.25 高 4.8%）。实测 GDI+ 是 1.3249，Pillow 是 1.18，所以按 1.31±3%
# 判：[1.2707, 1.3493]，Pillow 的 1.18 照样落在窗口外，判据的区分力没丢。
_EXPECTED_RATIO = 1.31
_RATIO_TOLERANCE = 0.03
# 箭头连续性只看顶部这条带：箭头横杠在公式最上沿，断成几截就是几个连通域。
_BAND_RATIO = 0.15
_WHITE = 255
_DARK_LEVEL = 200
_INK_LUT = [255 if level < _DARK_LEVEL else 0 for level in range(256)]


# ── 断言小工具（与 v12 同款） ─────────────────────────────────────

class Checker:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def ok(self, condition: bool, label: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print("  ✓ %s%s" % (label, ("｜" + detail) if detail else ""))
        else:
            self.failed += 1
            print("  ✗ %s%s" % (label, ("｜" + detail) if detail else ""))
        return condition

    def summary(self) -> int:
        print()
        print("通过 %d 项，失败 %d 项" % (self.passed, self.failed))
        return 0 if self.failed == 0 else 1


# ── 量图的小工具（只用 Pillow + 标准库） ────────────────────────────

def png_is_valid(path: str) -> tuple[bool, tuple[int, int]]:
    """Pillow 能不能完整读一遍，以及尺寸。"""
    from PIL import Image

    try:
        with Image.open(path) as im:
            im.verify()
        with Image.open(path) as im:
            return True, im.size
    except Exception:
        return False, (0, 0)


def ink_bbox(path: str):
    from PIL import Image

    with Image.open(path) as im:
        return im.convert("L").point(_INK_LUT).getbbox()


def ink_aspect(path: str) -> float:
    box = ink_bbox(path)
    if not box:
        return 0.0
    return (box[2] - box[0]) / (box[3] - box[1])


def band_components(path: str, ratio: float = _BAND_RATIO) -> tuple[int, int]:
    """顶部 ratio 那条横带里的墨迹连通域数量（4 邻域）。返回 (连通域数, 带内墨迹像素数)。"""
    from PIL import Image

    with Image.open(path) as im:
        gray = im.convert("L")
        width, height = gray.size
        band_height = max(1, round(height * ratio))
        band = gray.crop((0, 0, width, band_height)).point(_INK_LUT).tobytes()

    total = len(band)
    seen = bytearray(total)
    components = 0
    for start in range(total):
        if not band[start] or seen[start]:
            continue
        components += 1
        seen[start] = 1
        stack = [start]
        while stack:
            index = stack.pop()
            y, x = divmod(index, width)
            for neighbour, reachable in (
                (index - 1, x > 0),
                (index + 1, x < width - 1),
                (index - width, y > 0),
                (index + width, index + width < total),
            ):
                if reachable and band[neighbour] and not seen[neighbour]:
                    seen[neighbour] = 1
                    stack.append(neighbour)
    ink = sum(1 for value in band if value)
    return components, ink


def white_png(path: str, size: tuple[int, int] = (240, 160)) -> None:
    from PIL import Image

    image = Image.new("RGB", size, (_WHITE, _WHITE, _WHITE))
    try:
        image.save(path, "PNG", optimize=True)
    finally:
        image.close()


def samples_for(root: str) -> tuple[list[str], bool]:
    """样本清单。第二个返回值说明拿到的是不是真实公式集（比例/连通域只在真样本上判定）。"""
    if os.path.isdir(LOCAL_WMF_DIR):
        found = sorted(
            os.path.join(LOCAL_WMF_DIR, name)
            for name in os.listdir(LOCAL_WMF_DIR)
            if name.lower().endswith(".wmf")
        )
        if len(found) == _SAMPLE_COUNT:
            return found, True
    if not os.path.exists(FIXTURE_WMF):
        return [], False
    # fixture 顶十份：只保证「渲染后端对同一个输入稳定」，不假装是十张不同的公式。
    made = []
    for index in range(1, _SAMPLE_COUNT + 1):
        dst = os.path.join(root, "image%d.wmf" % index)
        shutil.copyfile(FIXTURE_WMF, dst)
        made.append(dst)
    return made, False


# ── 各用例 ──────────────────────────────────────────────────────────

def case_render_all(check: Checker, root: str, samples: list[str]) -> None:
    """1：十个样本逐个渲染，全部成功且是有效 PNG。"""
    print()
    print("── 1. %d 个 WMF 走 GDI+ 直渲（长边 %d） ──" % (len(samples), _LONG_SIDE))
    failures = []
    for path in samples:
        stem = os.path.splitext(os.path.basename(path))[0]
        dst = os.path.join(root, "%s-gdi.png" % stem)
        ok = wmf_render.render_to_png(path, dst, _LONG_SIDE)
        if not ok:
            failures.append("%s: render_to_png 返回 False" % stem)
            print("    %-12s FAIL" % stem)
            continue
        valid, size = png_is_valid(dst)
        if not valid:
            failures.append("%s: 输出不是有效 PNG" % stem)
            print("    %-12s FAIL 不是有效 PNG" % stem)
            continue
        long_side = max(size)
        print("    %-12s -> %dx%d, %d B" % (stem, size[0], size[1], os.path.getsize(dst)))
        if long_side != _LONG_SIDE:
            failures.append("%s: 长边 %d，应为 %d" % (stem, long_side, _LONG_SIDE))
    check.ok(not failures, "%d 个样本全部渲染成功、都是有效 PNG、长边都是 %d" % (len(samples), _LONG_SIDE),
             "；".join(failures))

    print()
    print("── 1b. 失败路径：输入不是图元文件时返回 False，不抛 ──")
    garbage = os.path.join(root, "not-a-metafile.wmf")
    with open(garbage, "wb") as handle:
        handle.write(b"not a metafile at all")
    garbage_png = os.path.join(root, "not-a-metafile.png")
    try:
        result = wmf_render.render_to_png(garbage, garbage_png, _LONG_SIDE)
        raised = None
    except Exception as exc:  # 抛了就是违约
        result, raised = None, exc
    check.ok(raised is None and result is False, "返回 False 而不是抛异常", repr(raised) if raised else "")
    check.ok(not os.path.exists(garbage_png), "没有留下半张 PNG")

    print()
    print("── 1c. 重复调用：句柄复用不出问题 ──")
    repeat_ok = True
    sizes = set()
    for index in range(20):
        dst = os.path.join(root, "repeat-%02d.png" % index)
        if not wmf_render.render_to_png(samples[0], dst, _LONG_SIDE):
            repeat_ok = False
            break
        sizes.add(os.path.getsize(dst))
    check.ok(repeat_ok and len(sizes) == 1, "同一输入连渲 20 次都成功、体积一致", str(sorted(sizes)))


def case_geometry(check: Checker, root: str, samples: list[str]) -> None:
    """2–3：比例与箭头连续性，同时量一遍 Pillow 那条路作为对照。"""
    print()
    print("── 2. image5.wmf 的墨迹宽高比（GDI+ vs Pillow） ──")
    target = next((p for p in samples if os.path.basename(p).lower() == "image5.wmf"), None)
    if target is None:
        print("    样本里没有 image5.wmf，跳过比例与连通域判定")
        return

    gdi_png = os.path.join(root, "image5-pipeline.png")
    check.ok(convert_emf_to_png(target, gdi_png), "image5.wmf 走完整管线转换成功")
    gdi_ratio = ink_aspect(gdi_png)
    gdi_components, gdi_band_ink = band_components(gdi_png)
    print("    GDI+   ：%s，墨迹宽高比 %.4f，顶部 15%% 带内连通域 %d（墨迹像素 %d）"
          % (png_is_valid(gdi_png)[1], gdi_ratio, gdi_components, gdi_band_ink))

    # 对照：把 GDI+ 关掉，同一条路走 Pillow 的 dpi 阶梯。
    pillow_png = os.path.join(root, "image5-pillow.png")
    original = wmf_render.is_available
    wmf_render.is_available = lambda: False
    try:
        pillow_ok = convert_emf_to_png(target, pillow_png)
    finally:
        wmf_render.is_available = original
    pillow_ratio = ink_aspect(pillow_png) if pillow_ok else 0.0
    pillow_components, _ = band_components(pillow_png) if pillow_ok else (0, 0)
    print("    Pillow ：%s，墨迹宽高比 %.4f，顶部 15%% 带内连通域 %d"
          % (png_is_valid(pillow_png)[1] if pillow_ok else "-", pillow_ratio, pillow_components))

    low = _EXPECTED_RATIO * (1 - _RATIO_TOLERANCE)
    high = _EXPECTED_RATIO * (1 + _RATIO_TOLERANCE)
    check.ok(
        low <= gdi_ratio <= high,
        "墨迹宽高比落在 %.4f–%.4f（%.2f±%d%%）" % (low, high, _EXPECTED_RATIO, round(_RATIO_TOLERANCE * 100)),
        "%.4f" % gdi_ratio,
    )
    check.ok(
        pillow_ok and gdi_ratio > pillow_ratio,
        "GDI+ 的比例明显高于 Pillow（几何没被压扁）",
        "%.4f vs %.4f" % (gdi_ratio, pillow_ratio),
    )

    print()
    print("── 3. 箭头连续性：顶部 15% 横向带里应该只有一整条 ──")
    check.ok(gdi_components == 1, "GDI+ 渲出来的顶部带里墨迹连通域 = 1", str(gdi_components))
    check.ok(
        pillow_components > 1,
        "对照：Pillow 版是断开的（同一带内多个连通域）",
        str(pillow_components),
    )


def case_blank(check: Checker, root: str) -> None:
    """4：空白判据照旧起作用，正常公式照旧不空白。"""
    print()
    print("── 4. 空白判据不回归 ──")
    blank_src = os.path.join(root, "white.png")
    white_png(blank_src)
    blank_out = os.path.join(root, "white-out.png")
    check.ok(convert_emf_to_png(blank_src, blank_out), "纯白图也能走完转换")
    check.ok(os.path.exists(blank_out), "输出落在指定路径")
    check.ok(preview_is_blank(blank_out), "转换结果被判空白")

    if os.path.exists(FIXTURE_WMF):
        formula_out = os.path.join(root, "formula-out.png")
        check.ok(convert_emf_to_png(FIXTURE_WMF, formula_out), "真公式预览转换成功")
        check.ok(not preview_is_blank(formula_out), "真公式预览不判空白（判据没变成一律为真）")


def case_fallback(check: Checker, root: str) -> None:
    """5：GDI+ 不可用时回退 Pillow，不抛、也不偷偷调 GDI+。"""
    print()
    print("── 5. GDI+ 不可用：回退 Pillow ──")
    if not os.path.exists(FIXTURE_WMF):
        print("    没有 formula_preview.wmf，跳过")
        return

    calls = []
    original_available = wmf_render.is_available
    original_render = wmf_render.render_to_png
    wmf_render.is_available = lambda: False
    wmf_render.render_to_png = lambda *args, **kwargs: calls.append(args) or False
    try:
        out = os.path.join(root, "fallback.png")
        try:
            result = convert_emf_to_png(FIXTURE_WMF, out)
            raised = None
        except Exception as exc:
            result, raised = None, exc
    finally:
        wmf_render.is_available = original_available
        wmf_render.render_to_png = original_render

    check.ok(raised is None and result is True, "转换成功且没有抛异常", repr(raised) if raised else "")
    valid, size = png_is_valid(out)
    check.ok(valid and max(size) > 0, "回退路径产出了有效 PNG", str(size))
    check.ok(not calls, "回退时一次都没调用 GDI+ 渲染", str(len(calls)))


def case_gdi_shrink(check: Checker, root: str) -> None:
    """6：单张超过体积上限时，仍是 GDI+ 换长边重渲，不退回 Pillow。"""
    print()
    print("── 6. 单张超体积上限：GDI+ 换长边重渲，不退回 Pillow ──")
    if not os.path.exists(FIXTURE_WMF):
        print("    没有 formula_preview.wmf，跳过")
        return

    calls = []
    original_render = wmf_render.render_to_png
    original_max = emf_converter._MAX_PNG_BYTES

    def recorder(src, dst, long_side=1440):
        calls.append(long_side)
        return original_render(src, dst, long_side)

    wmf_render.render_to_png = recorder
    emf_converter._MAX_PNG_BYTES = 1  # 逼出「降一档重渲」那条路
    try:
        out = os.path.join(root, "shrink.png")
        ok = convert_emf_to_png(FIXTURE_WMF, out)
    finally:
        wmf_render.render_to_png = original_render
        emf_converter._MAX_PNG_BYTES = original_max

    valid, size = png_is_valid(out)
    print("    调用长边序列 %s -> %s" % (calls, size))
    check.ok(ok and valid, "降档重渲后仍然成功")
    check.ok(calls == [1440, 1080, 800], "长边按 1440 → 1080 → 800 降三档", str(calls))
    check.ok(max(size) < 1200, "最后一次用的是最小那档的分辨率", "%dx%d" % size)


def self_test() -> int:
    print("GDI+ 渲染后端自测（wmf_render + convert_emf_to_png）")

    if not wmf_render.is_available():
        print("gdiplus.dll 不可用（非 Windows，或加载失败），跳过")
        return 0

    root = tempfile.mkdtemp(prefix="docintake-gdi-")
    try:
        samples, real = samples_for(root)
        if not samples:
            print("样本缺失：既没有 %s，也没有 %s，跳过" % (LOCAL_WMF_DIR, FIXTURE_WMF))
            return 0
        print("样本：%s（%d 个）" % ("本机真实公式集" if real else "fixture 副本", len(samples)))

        total = Checker()
        case_render_all(total, root, samples)
        if real:
            case_geometry(total, root, samples)
        else:
            print()
            print("样本不是真实公式集，跳过比例与连通域判定")
        case_blank(total, root)
        case_fallback(total, root)
        case_gdi_shrink(total, root)
        return total.summary()
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)

    print(__doc__)
    print("用法：python -m test.selftest_v13_gdi_render")
