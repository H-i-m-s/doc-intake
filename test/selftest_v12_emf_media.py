"""v12 EMF/WMF 预览图自测：按矢量高 DPI 重绘 + 空白预览拦截。

用法：python test/selftest_v12_emf_media.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 高 DPI 重绘 + 裁墨迹：真实 Word 公式预览（test/fixtures/formula_preview.wmf）转出来的
     长边落在 600–1200、墨迹占比落在 60%–85%、单张 < 120 KB、黑白线稿存成 mode="L"。
  2. dpi 阶梯走到 1200 仍够不到 720 时接受已经拿到的最大尺寸，不放大。这条路现在是
     GDI+ 用不了时的回退，所以这个用例显式把 `wmf_render.is_available` 关掉。
  3. 长边超 1200 时按单一比例截到 1200（宽高比不许变）。
  4. 打不开的输入返回 False，不留下半张图（老行为：调用方保留原始 WMF）。
  5. 空白预览拦截：空白 WMF 转出来的纯白 PNG 被删掉、不产出记录、不占编号（不出现
     image_002 之后直接 image_004 这种跳号）、warnings 里记一条。
  6. 普通位图不检测：同一批里一张纯白 PNG 照样原样落盘、字节不变、不记 warning。
  7. 不传 blank_previews 时不拦截（xlsx / epub 那条路保持原行为）。
  8. 裁墨迹本身：墨迹框加两侧留白后尺寸准确（不拉伸）；墨迹框退化（无墨迹 / 某一维
     只有 2 px）时按原图返回；留白算进尺寸后超 1200 按比例缩回。

为什么可见样本用 fixture 文件：PIL 只能读 WMF/EMF，写不了；手拼的绘制记录交给 GDI 重绘时
落点不按窗口映射走（实测同一个矩形不管坐标写多少都铺满画布），拼出来的图看着能开、内容却
不可控。所以可见样本用一张真实的 Word/MathType 预览图。空白样本不需要绘制记录，只有头部
的最小 WMF 就能造，且尺寸完全由头部算出来，反而更可靠。
"""

from __future__ import annotations

import io
import os
import shutil
import struct
import sys
import tempfile
import zipfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

from extractors.emf_converter import (  # noqa: E402
    _ink_bbox,
    _trim,
    convert_emf_to_png,
    extract_and_convert_media,
    preview_is_blank,
)

FIXTURE_WMF = os.path.join(_TEST_DIR, "fixtures", "formula_preview.wmf")
MAX_PNG_BYTES = 120 * 1024


# ── 造 WMF ──────────────────────────────────────────────────────────

def _record(function: int, params: bytes = b"") -> bytes:
    """一条 WMF 记录：DWORD 字节数(按 WORD 计) + WORD 函数 + 参数(补齐到偶数字节)。"""
    if len(params) % 2:
        params += b"\x00"
    return struct.pack("<IH", (6 + len(params)) // 2, function) + params


def build_wmf(path: str, bbox: tuple[int, int] = (800, 500), inch: int = 1000) -> None:
    """造一个「只有头部、什么也不画」的最小 WMF（= 空公式的预览：整张纯白）。

    可放置头（22 字节）里给足了尺寸信息：PIL 的尺寸就是 bbox * dpi / inch 算出来的，
    所以这条路径上要验的尺寸、宽高比都能精确预期。
    """
    width, height = bbox
    placeable = struct.pack("<IHhhhhH", 0x9AC6CDD7, 0, 0, 0, width, height, inch) + b"\x00\x00\x00\x00"
    checksum = 0
    for word in struct.unpack("<10H", placeable[:20]):
        checksum ^= word
    placeable += struct.pack("<H", checksum)

    records = _record(0x0000)  # META_EOF
    total_bytes = 18 + len(records)
    header = struct.pack(
        "<HHHIHIH", 1, 9, 0x0300, total_bytes // 2, 1, 3, 0
    )  # 内存图元文件 / 头部 9 字 / 版本 0x0300
    with open(path, "wb") as handle:
        handle.write(placeable + header + records)


def wmf_aspect(path: str) -> float:
    """从可放置头里读出源几何的宽高比（不经过渲染，不受取整影响）。"""
    with open(path, "rb") as handle:
        head = handle.read(16)
    _key, _handle, left, top, right, bottom, _inch = struct.unpack("<IHhhhhH", head)
    return (right - left) / (bottom - top)


def relative_error(actual: float, expected: float) -> float:
    return abs(actual - expected) / expected


def png_size(path: str) -> tuple[int, int]:
    from PIL import Image

    with Image.open(path) as im:
        return im.size


def make_white_png(path: str, size: tuple[int, int] = (40, 24)) -> bytes:
    """纯白 PNG：故意做成空白的样子，用来证明「空白检测不碰普通位图」。"""
    from PIL import Image

    image = Image.new("RGB", size, (255, 255, 255))
    image.save(path, "PNG", optimize=True)
    image.close()
    return open(path, "rb").read()


def draw_ink(size: tuple[int, int], box):
    """白底图，在 box 里涂黑。box 为 None 就是整张纯白（没有墨迹）。"""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", size, (255, 255, 255))
    if box is not None:
        ImageDraw.Draw(image).rectangle(box, fill=(0, 0, 0))
    return image


def ink_ratio_of(im) -> float:
    """墨迹外接框面积 / 画布面积。跟真机上量的是同一个数。"""
    box = _ink_bbox(im)
    if box is None:
        return 0.0
    return (box[2] - box[0]) * (box[3] - box[1]) / (im.size[0] * im.size[1])


def ink_ratio(path: str) -> float:
    from PIL import Image

    with Image.open(path) as im:
        return ink_ratio_of(im)


# ── 断言小工具 ──────────────────────────────────────────────────────

class Checker:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def ok(self, condition: bool, label: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print("  ✓ %s" % label)
        else:
            self.failed += 1
            print("  ✗ %s%s" % (label, ("｜" + detail) if detail else ""))
        return condition

    def summary(self) -> int:
        print()
        print("通过 %d 项，失败 %d 项" % (self.passed, self.failed))
        return 0 if self.failed == 0 else 1


def media_names(out_dir: str, stem: str) -> list[str]:
    folder = os.path.join(out_dir, stem + "_media")
    if not os.path.isdir(folder):
        return []
    return sorted(os.listdir(folder))


# ── 各用例 ──────────────────────────────────────────────────────────

def case_high_dpi(check: Checker, root: str) -> None:
    """1–4：重绘质量、阶梯、上限、打不开的输入。"""
    print()
    print("── 1. 真实预览图按矢量重绘（长边 / 宽高比 / 体积 / 单通道） ──")
    png = os.path.join(root, "formula.png")
    check.ok(convert_emf_to_png(FIXTURE_WMF, png), "转换成功")
    if not os.path.exists(png):
        return
    width, height = png_size(png)
    long_side = max(width, height)
    size_bytes = os.path.getsize(png)
    print("    formula_preview.wmf -> %dx%d, %d B" % (width, height, size_bytes))
    check.ok(600 <= long_side <= 1200, "长边落在 600–1200", "%d px" % long_side)
    ratio = ink_ratio(png)
    print("    墨迹占比 %.1f%%" % (ratio * 100))
    check.ok(
        0.60 <= ratio <= 0.85,
        "裁完的墨迹占比落在 60%–85%",
        "%.1f%%" % (ratio * 100),
    )
    check.ok(size_bytes < MAX_PNG_BYTES, "单张 < 120 KB", "%d B" % size_bytes)

    from PIL import Image

    with Image.open(png) as im:
        check.ok(im.mode == "L", "黑白线稿存成 mode=L", im.mode)

    print()
    print("── 2. 阶梯走到 1200 仍够不到 720：接受最大尺寸，不放大（空白图不裁剪） ──")
    tiny = os.path.join(root, "tiny.wmf")
    tiny_png = os.path.join(root, "tiny.png")
    # 60×36 个图元单位 / 1000 单位每英寸：1200 dpi 也只有 72×43，永远够不到 720。
    # 它本来也没墨迹，所以裁不动——退化框按原图处理的同一条路。
    build_wmf(tiny, bbox=(60, 36), inch=1000)
    # 这一段验的是 Pillow 的 dpi 阶梯，而阶梯现在是回退路径（GDI+ 只按固定长边渲一次，
    # 不量墨迹就不放大），所以先把 GDI+ 关掉，否则量到的是 GDI+ 的分支。
    from extractors import wmf_render

    _available = wmf_render.is_available
    wmf_render.is_available = lambda: False
    try:
        check.ok(convert_emf_to_png(tiny, tiny_png), "极小图样也能转")
    finally:
        wmf_render.is_available = _available
    tw, th = png_size(tiny_png)
    print("    tiny.wmf -> %dx%d" % (tw, th))
    check.ok(60 <= max(tw, th) <= 100, "停在 1200 dpi 能给到的尺寸，没被放大", "%dx%d" % (tw, th))
    check.ok(relative_error(tw / th, 60 / 36) < 0.02, "宽高比仍然对", "%.4f" % (tw / th))
    check.ok(preview_is_blank(tiny_png), "没墨迹的图还是空白的，留给调用方拦")

    print()
    print("── 3. 长边超 1200：按单一比例截到 1200（不拉伸） ──")
    big = os.path.join(root, "big.wmf")
    big_png = os.path.join(root, "big.png")
    build_wmf(big, bbox=(7290, 4000), inch=1000)
    check.ok(convert_emf_to_png(big, big_png), "超大图样转换成功")
    bw, bh = png_size(big_png)
    print("    big.wmf -> %dx%d" % (bw, bh))
    check.ok(max(bw, bh) == 1200, "长边正好截在 1200", "%dx%d" % (bw, bh))
    check.ok(relative_error(bw / bh, 7290 / 4000) < 0.02, "截断后宽高比不变", "%.4f" % (bw / bh))

    print()
    print("── 4. 打不开的输入：返回 False，不留半张图 ──")
    broken = os.path.join(root, "broken.wmf")
    with open(broken, "wb") as handle:
        handle.write(b"not a metafile at all")
    broken_png = os.path.join(root, "broken.png")
    check.ok(not convert_emf_to_png(broken, broken_png), "返回 False")
    check.ok(not os.path.exists(broken_png), "没有留下半张 PNG")

    print()
    print("── 4b. 裁墨迹 + 留白（拿合成图直接量尺寸，不靠渲染） ──")
    ink_only = draw_ink((400, 300), (100, 100, 299, 259))  # 墨迹 200×160
    trimmed = _trim(ink_only)
    ink_only.close()
    try:
        print("    ink 200×160 / canvas 400×300 -> %dx%d" % trimmed.size)
        check.ok(trimmed.size == (232, 192), "墨迹框 + 两侧 16 px 留白，没有拉伸", str(trimmed.size))
        trimmed_ratio = ink_ratio_of(trimmed)
        check.ok(
            0.60 <= trimmed_ratio <= 0.85,
            "裁完墨迹占比落在 60%–85%（原画布只有 27%）",
            "%.1f%%" % (trimmed_ratio * 100),
        )
    finally:
        trimmed.close()

    print()
    print("── 4c. 退化墨迹框：不裁、不崩 ──")
    blank_img = draw_ink((300, 200), None)
    line_img = draw_ink((300, 200), (150, 0, 151, 200))  # 2 px 宽的竖线
    try:
        blank_out = _trim(blank_img)
        line_out = _trim(line_img)
        try:
            check.ok(blank_out.size == (300, 200), "整张没墨迹：按原图返回", str(blank_out.size))
            check.ok(line_out.size == (300, 200), "墨迹只有 2 px 宽：不切碎片", str(line_out.size))
        finally:
            blank_out.close()
            line_out.close()
    finally:
        blank_img.close()
        line_img.close()

    print()
    print("── 4d. 留白算进尺寸后超 1200：按单一比例缩回来 ──")
    wide = draw_ink((1300, 760), (50, 20, 1249, 739))  # 墨迹 1200×720
    capped = _trim(wide)
    wide.close()
    try:
        print("    ink 1200×720 (+24 留白 = 1248×768) -> %dx%d" % capped.size)
        check.ok(max(capped.size) == 1200, "长边压回 1200", str(capped.size))
        check.ok(relative_error(capped.size[0] / capped.size[1], 1248 / 768) < 0.01,
                 "压缩没有改变宽高比", "%.4f" % (capped.size[0] / capped.size[1]))
    finally:
        capped.close()


def case_blank_preview(check: Checker, root: str) -> None:
    """5–6：空白预览被拦、普通位图不动、编号连续。"""
    print()
    print("── 5. 空白预览拦截（空白 WMF + 普通图混在一批里） ──")
    blank_wmf = os.path.join(root, "blank.wmf")
    build_wmf(blank_wmf, bbox=(800, 500), inch=1000)
    white_png_path = os.path.join(root, "plain.png")
    white_bytes = make_white_png(white_png_path)

    archive = os.path.join(root, "sample.docx")
    entries = [
        ("word/media/image1.wmf", open(FIXTURE_WMF, "rb").read()),
        ("word/media/image2.wmf", open(blank_wmf, "rb").read()),
        ("word/media/image3.png", white_bytes),
    ]
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, payload in entries:
            zf.writestr(name, payload)

    out_dir = os.path.join(root, "out")
    os.makedirs(out_dir, exist_ok=True)
    warnings: list[str] = []
    blank: set[str] = set()
    with zipfile.ZipFile(archive) as zf:
        media = extract_and_convert_media(
            [name for name, _ in entries], zf, out_dir, "sample",
            warnings=warnings, blank_previews=blank,
        )

    names = media_names(out_dir, "sample")
    print("    落盘：%s" % names)
    print("    warnings：%s" % warnings)
    check.ok(names == ["image_001.png", "image_002.png"], "只剩两张图，编号连续（没有跳号）", str(names))
    check.ok(len(media) == 2, "不产出被拦掉的那条 ExtractedMedia", str(len(media)))
    check.ok(
        [m.original_path for m in media] == ["word/media/image1.wmf", "word/media/image3.png"],
        "正常图按原顺序留下",
        str([m.original_path for m in media]),
    )
    check.ok(blank == {"word/media/image2.wmf"}, "被拦掉的 zip 路径记在了 blank_previews 里", str(blank))
    check.ok(len(warnings) == 1 and "空白图" in warnings[0], "warnings 里有一条空白图记录", str(warnings))
    check.ok("第 2 个公式" in warnings[0], "记的是第几个公式", warnings[0] if warnings else "")
    check.ok(
        not any(name.endswith((".wmf", ".emf")) for name in names),
        "中间文件（原始 WMF）没有残留",
        str(names),
    )

    print()
    print("── 6. 普通位图不受影响（同样是纯白，但它是用户贴的图） ──")
    kept_png = os.path.join(out_dir, "sample_media", "image_002.png")
    check.ok(os.path.exists(kept_png), "纯白 PNG 照样落盘")
    check.ok(open(kept_png, "rb").read() == white_bytes, "字节与源文件完全一致（没被重编码）")
    check.ok(
        not any("plain" in w or "image3.png" in w for w in warnings),
        "没有因为它是白的就记 warning",
        str(warnings),
    )
    check.ok(preview_is_blank(kept_png), "判空函数本身只看内容（拦截与否由调用方按来源决定）")

    print()
    print("── 7. 不传 blank_previews：老行为（xlsx / epub 那条路） ──")
    plain_out = os.path.join(root, "out_plain")
    os.makedirs(plain_out, exist_ok=True)
    plain_warnings: list[str] = []
    with zipfile.ZipFile(archive) as zf:
        plain_media = extract_and_convert_media(
            [name for name, _ in entries], zf, plain_out, "sample",
            warnings=plain_warnings,
        )
    plain_names = media_names(plain_out, "sample")
    print("    落盘：%s" % plain_names)
    check.ok(
        plain_names == ["image_001.png", "image_002.png", "image_003.png"],
        "三张全留，编号 image_001–003 连续",
        str(plain_names),
    )
    check.ok(len(plain_media) == 3, "三条记录都在", str(len(plain_media)))
    check.ok(not plain_warnings, "没有空白图 warning", str(plain_warnings))


def case_io_object(check: Checker, root: str) -> None:
    """直接走一遍 In-memory zip 之外的边界：空目录、空列表。"""
    print()
    print("── 8. 空输入 ──")
    archive = os.path.join(root, "empty.docx")
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("word/document.xml", "<x/>")
    with zipfile.ZipFile(archive) as zf:
        check.ok(extract_and_convert_media([], zf, root, "empty") == [], "空媒体列表返回空")
        only_kind = extract_and_convert_media(
            ["word/media/image1.wmf"], zf, "", "empty"
        )
        check.ok(
            len(only_kind) == 1 and only_kind[0].kind == "image",
            "没有输出目录时只给 kind 信息",
            str(only_kind),
        )


def self_test() -> int:
    print("EMF/WMF 预览图自测（高 DPI 重绘 + 空白拦截）")

    if not os.path.exists(FIXTURE_WMF):
        print("找不到 test/fixtures/formula_preview.wmf，自测没法做")
        return 1

    from PIL import Image

    if not hasattr(Image.core, "drawwmf"):
        # 只有 Windows 的 Pillow 带 WMF 渲染；别的地方这一层根本跑不到。
        print("当前 Pillow 不带 WMF 渲染（非 Windows 构建），跳过")
        return 0

    def run(root: str) -> int:
        total = Checker()
        case_high_dpi(total, root)
        case_blank_preview(total, root)
        case_io_object(total, root)
        return total.summary()

    root = tempfile.mkdtemp(prefix="docintake-emf-")
    try:
        return run(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)

    print(__doc__)
    print("用法：python test/selftest_v12_emf_media.py")
