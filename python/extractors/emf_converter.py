"""EMF/WMF 到 PNG 转换器 与 媒体通用抽取器。

Windows 上先走 GDI+（`wmf_render`，ctypes 直调 gdiplus.dll）渲一张长边 1440 的 PNG,
再在这张图上做裁剪/判空/存盘;GDI+ 不可用或渲不出来时回退到 Pillow 的 dpi 阶梯。
为什么优先 GDI+:Word 显示 WMF 走的就是 GDI+,而 Pillow 在 Windows 上走 GDI 的
PlayMetaFile,两者对同一份记录的解释不同 —— 几何会被非等比压扁、矢量笔画会断成几段。

裁剪/判空/存盘这一段依赖 Pillow (`PIL.Image`)。如果 Pillow 不支持 EMF/WMF(老版本或
非 Windows 构建)且 GDI+ 也用不了,转换失败,原 EMF 仍留在 media 目录里,前端拿不到
预览但不阻塞主流程。

WMF/EMF 是矢量图,`Image.open` 之后不重绘就是按 72 dpi 落地 —— 公式预览会糊成
8×13 这种尺寸。所以 Pillow 那条路按 dpi 阶梯重绘:长边目标 720 px、上限 1200 px。
重绘之后再按墨迹外接框裁掉画布上的大片空白(WMF 的画布常常比字大好几倍,
不裁就是一个字浮在大白框里),四周补一圈统一留白。
重绘出来的 PNG 如果是空白(空公式的预览),可以按调用方的要求拦下来。

媒体抽出接口(`extract_and_convert_media`)返回结构化 ExtractedMedia 列表,
包含本地路径 / 原 zip 路径 / kind(image/video/audio/other)/ ext。
按 kind 分别连续编号:image_001.png, image_002.png, ..., video_001.mp4, ...
调用方负责传入排序后的 media_files(保持文档引用顺序)。
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

from . import wmf_render
from ._utils import ExtractedMedia, classify_media, media_filename

# 重绘阶梯:从 96 dpi 起逐级加大,长边够 720 px 就停。
# 96 这一级保留在原位 —— 它是「原图在屏幕上的自然尺寸」,极小图样也至少能拿到这一级。
_DPI_LADDER = (96, 192, 288, 384, 576, 768, 1200)
_TARGET_LONG_SIDE = 720
_MAX_LONG_SIDE = 1200
# 单张 PNG 的上限。公式是线稿,720 px 长边通常几 KB;真超了就往回降一档重绘。
_MAX_PNG_BYTES = 120 * 1024
_SHRINK_LADDER = (600, 480)

# GDI+ 那条路:一次渲到长边 1440(裁墨迹有余量,矢量放大不损质量),体积超上限时
# 按这个阶梯换个长边重渲 —— 只换分辨率,别退回 Pillow:GDI 那套解释正是要避开的东西。
_GDI_LONG_SIDE = 1440
_GDI_SHRINK_SIDES = (1080, 800)

# 墨迹裁剪:按墨迹外接框裁掉画布上的大片空白,再补一圈留白。
# 留白按墨迹框长边的 8% 算,夹在 6–24 px —— 太小会切到笔画,太大又把刚裁掉的空白还回去。
_PAD_RATIO = 0.08
_PAD_MIN = 6
_PAD_MAX = 24

# 补偿重绘的护栏:画布上大片空白的图样(墨迹只占 4%),光靠 1200 dpi 的阶梯裁完长边
# 可能只有几十像素。按线性关系估一个 dpi 再重绘一次把它拉到目标尺寸。两个上限防止
# 一个极小图样把内存和耗时拖爆。
_COMPENSATE_MAX_DPI = 9600
_COMPENSATE_MAX_CANVAS = 4000

# 空白判定:暗像素(<200)占比低于千分之五就算空白。纯黑/纯白走 extrema 直接判。
_DARK_LEVEL = 200
_MIN_DARK_RATIO = 0.0005
# 墨迹掩码的查找表:比自己 _DARK_LEVEL 暗的算墨迹。跟空白判据用的是同一个界限。
_INK_LUT = [255 if level < _DARK_LEVEL else 0 for level in range(256)]
# 判「这张图是黑白线稿」用的容差:三个通道的平均偏离。见 _is_neutral。
_GRAY_MEAN_TOLERANCE = 2.0


def _open_at(src: str, dpi: float):
    """按 dpi 让 Pillow 重绘一次并加载,返回可直接操作的 Image。"""
    from PIL import Image

    im = Image.open(src)
    try:
        im.load(dpi=dpi)
    except Exception:
        im.close()
        raise
    return im


def _ink_bbox(im):
    """墨迹的外接框(灰度 < 200 的像素围出来的矩形)。没有墨迹返回 None。"""
    mask = im.convert("L").point(_INK_LUT)
    return mask.getbbox()


def _cap(im):
    """长边超上限就按单一比例缩回来;不超就原样返回。"""
    from PIL import Image

    long_side = max(im.size)
    if long_side <= _MAX_LONG_SIDE:
        return im
    ratio = _MAX_LONG_SIDE / long_side
    shrunk = im.resize(
        (max(1, round(im.size[0] * ratio)), max(1, round(im.size[1] * ratio))),
        Image.LANCZOS,
    )
    im.close()
    return shrunk


def _trim(im):
    """按墨迹外接框裁掉四周空白,再补一圈统一留白。

    返回一张新图(调用方负责关掉传进来的那张)。留白按墨迹框长边的 8% 算,夹在
    6–24 px;宽高各加同样的一圈,不存在拉伸。留白加完长边超上限就按单一比例缩回来 ——
    没裁的图也走同一道封顶。

    墨迹框退化(整张没墨迹,或某一维只有 1–2 px)时按原图处理:宁可不裁,
    也不能切出一张只剩几个像素的碎片。空白图走到这里就是这条路,后面的判空照旧能拦住它。
    """
    from PIL import Image

    box = _ink_bbox(im)
    if box is None:
        return _cap(im.copy())
    left, top, right, bottom = box
    ink_width, ink_height = right - left, bottom - top
    if ink_width <= 2 or ink_height <= 2:
        return _cap(im.copy())

    pad = round(max(ink_width, ink_height) * _PAD_RATIO)
    pad = max(_PAD_MIN, min(_PAD_MAX, pad))

    canvas = Image.new(
        im.mode,
        (ink_width + 2 * pad, ink_height + 2 * pad),
        "white",
    )
    canvas.paste(im.crop((left, top, right, bottom)), (pad, pad))
    return _cap(canvas)


def _render_preview(src: str):
    """按 dpi 阶梯重绘 + 裁墨迹,返回长边最接近目标的那一张。

    量的是裁完(含留白)的尺寸,不是画布尺寸:WMF 的画布常常比里面的字大好几倍,
    不裁的话「够 720 px」量到的是白边,落进正文就是一个字浮在大白框里。
    打不开/重绘异常返回 None,由调用方保持「转不出来」的老行为。
    """
    best = None
    best_dpi = None
    canvas_long = 0
    for dpi in _DPI_LADDER:
        try:
            im = _open_at(src, dpi)
        except Exception:
            # 某一档重绘不出来(极小图样在小 dpi 下会缩成 0 像素)就试下一档，
            # 全阶梯都失败才算「转不出来」。
            continue
        try:
            canvas_long = max(im.size)
            framed = _trim(im)
        finally:
            im.close()
        if best is not None:
            best.close()
        best = framed
        best_dpi = dpi
        if max(best.size) >= _TARGET_LONG_SIDE:
            return best

    # 阶梯走完了还没够 720 px:一种是真的极小图样，另一种是画布大片空白、墨迹只占
    # 一小块（裁完只剩几十像素）。后者按 dpi 与尺寸的线性关系补一次：算一个能到
    # 目标的 dpi 直接重绘，不再一级一级试。空白图没有墨迹可放大，走不到这里。
    if best is not None and best_dpi and _ink_bbox(best) is not None:
        need = best_dpi * _TARGET_LONG_SIDE / max(best.size)
        need = min(need, _COMPENSATE_MAX_DPI)
        if need > best_dpi * 1.05 and canvas_long * need / best_dpi <= _COMPENSATE_MAX_CANVAS:
            try:
                im = _open_at(src, need)
            except Exception:
                im = None
            if im is not None:
                try:
                    framed = _trim(im)
                finally:
                    im.close()
                if max(framed.size) > max(best.size):
                    best.close()
                    best = framed
                else:
                    framed.close()
    return best


def _is_neutral(im) -> bool:
    """够不够「黑白」：整张图平均通道偏离 ≤ 2 就算。

    WMF 经 GDI 重绘会给黑字带上 ClearType 彩边：单像素最多差 102，但只落在 1% 左右
    的像素上，整张平均下来不到 1。真彩色图平均偏离在 20 以上。按平均判，既能
    把公式存成单通道，也不会把彩色图洗成灰。
    """
    from PIL import ImageChops

    try:
        r, g, b = (im if im.mode == "RGB" else im.convert("RGB")).split()
        for first, second in ((r, g), (g, b)):
            histogram = ImageChops.difference(first, second).histogram()
            total = sum(histogram)
            if not total:
                continue
            mean = sum(level * count for level, count in enumerate(histogram)) / total
            if mean > _GRAY_MEAN_TOLERANCE:
                return False
        return True
    except Exception:
        return False


def _save_png(im, dst: str) -> None:
    """存 PNG。公式是黑白线稿,灰阶图按 mode="L" 存(体积约三分之一)。"""
    out = im
    if im.mode not in ("1", "L") and _is_neutral(im):
        out = im.convert("L")
    try:
        out.save(dst, "PNG", optimize=True)
    finally:
        if out is not im:
            out.close()


def _gdi_preview(src: str, tmp_png: str, long_side: int):
    """让 GDI+ 渲一张到临时 PNG,读回来套同一套裁墨迹。渲不出来返回 None。"""
    from PIL import Image

    if not wmf_render.render_to_png(src, tmp_png, long_side):
        return None
    try:
        im = Image.open(tmp_png)
        im.load()
    except Exception:
        return None
    try:
        return _trim(im)
    finally:
        im.close()


def _convert_with_gdi(emf_path: str, png_path: str) -> bool:
    """GDI+ 渲一遍,再走共用的裁墨迹 / 封顶 / 灰阶存盘。失败返回 False(由调用方回退)。"""
    fd, tmp_png = tempfile.mkstemp(prefix="docintake-wmf-", suffix=".png")
    os.close(fd)
    try:
        for long_side in (_GDI_LONG_SIDE,) + _GDI_SHRINK_SIDES:
            framed = _gdi_preview(emf_path, tmp_png, long_side)
            if framed is None:
                return False
            try:
                _save_png(framed, png_path)
            finally:
                framed.close()
            if os.path.getsize(png_path) <= _MAX_PNG_BYTES:
                return True
        # 阶梯降到底还超上限就接受,不无限降(与 Pillow 那条路的取舍一致)。
        return True
    except Exception:
        return False
    finally:
        _unlink(tmp_png)


def convert_emf_to_png(emf_path: str, png_path: str) -> bool:
    """EMF/WMF 按矢量高 DPI 重绘、裁到墨迹框之后存成 PNG。失败返回 False。"""
    if wmf_render.is_available() and _convert_with_gdi(emf_path, png_path):
        return True
    return _convert_with_pillow(emf_path, png_path)


def _convert_with_pillow(emf_path: str, png_path: str) -> bool:
    """Pillow 的 dpi 阶梯那条路:GDI+ 用不了时的退路,行为与老版本一致。"""
    best = _render_preview(emf_path)
    if best is None:
        return False
    try:
        _save_png(best, png_path)
        # 超了就往回降一档重绘:先 600、再 480,还超就接受,不无限降。
        if os.path.getsize(png_path) > _MAX_PNG_BYTES:
            for dpi in _SHRINK_LADDER:
                try:
                    im = _open_at(emf_path, dpi)
                except Exception:
                    break
                try:
                    framed = _trim(im)
                finally:
                    im.close()
                try:
                    _save_png(framed, png_path)
                finally:
                    framed.close()
                if os.path.getsize(png_path) <= _MAX_PNG_BYTES:
                    break
        return True
    except Exception:
        return False
    finally:
        best.close()


def preview_is_blank(png_path: str) -> bool:
    """EMF/WMF 转出来的预览是不是空白图(空公式)。

    只用于判断「我们刚从矢量图渲染出来的那张 PNG」:纯黑/纯白(extrema 两端相等),
    或暗像素(<200)占比低于千分之五。用户自己贴的位图不经过这里。
    读不出来一律当作不空白 —— 宁可留着,也不误删。
    """
    try:
        from PIL import Image

        with Image.open(png_path) as im:
            gray = im.convert("L")
            low, high = gray.getextrema()
            if low == high:
                return True
            histogram = gray.histogram()
            total = sum(histogram)
            if not total:
                return True
            return sum(histogram[:_DARK_LEVEL]) / total < _MIN_DARK_RATIO
    except Exception:
        return False


def _unlink(path) -> None:
    """删掉一个临时文件,删不掉(被占用)就算了 —— 不阻塞主流程。"""
    try:
        Path(path).unlink()
    except OSError:
        pass


def extract_and_convert_media(
    media_files: list[str],
    zf,
    output_dir: str,
    stem: str,
    *,
    warnings: list[str] | None = None,
    blank_previews: set | None = None,
) -> list[ExtractedMedia]:
    """从 zip 里解出所有媒体文件,EMF 转 PNG。

    Args:
        media_files: zip 内的媒体文件路径列表(已按文档引用顺序排好)。
                     docx 用 'word/media/xxx.png',xlsx 用 'xl/media/xxx.png'。
        zf: 已打开的 zipfile.ZipFile。
        output_dir: 解出后的输出目录。
        stem: 文件名前缀,跟 extractor 自己的 stem 对齐。
        warnings: 结果里的 warnings 列表,空白预览被跳过时在这里记事。
        blank_previews: 传一个集合进来才启用「空白预览拦截」,被拦掉的 zip 内路径
                     会放进这个集合(调用方据此在正文里连占位都不留)。不传就是
                     老行为:EMF/WMF 一律转换、一律产出。
                     只有 docx(公式预览)用它;xlsx/epub 的编号来自 drawing 锚点
                     索引,中间抽掉一张会让后面的图错位,所以那边不启用。

    Returns:
        ExtractedMedia 列表,与输入顺序对齐(各 kind 分别连续编号)。
        output_dir 为空时,只返回 kind 信息,local_path 用 zip 内路径占位。
    """
    if not media_files:
        return []

    # 没有输出目录:只构造 kind 信息,本地路径用 zip 原始路径占位
    # (供上层 markdown 渲染判断 kind,不实际抽文件)
    if not output_dir:
        return [
            ExtractedMedia(
                local_path=m,
                original_path=m,
                kind=classify_media(Path(m).suffix),
                ext=Path(m).suffix.lower(),
            )
            for m in media_files
        ]

    media_dir = Path(output_dir) / f"{stem}_media"
    media_dir.mkdir(parents=True, exist_ok=True)

    extracted: list[ExtractedMedia] = []
    counters = {"image": 0, "video": 0, "audio": 0, "other": 0}
    preview_index = 0

    for media_name in media_files:
        ext = Path(media_name).suffix.lower()
        kind = classify_media(ext)

        # EMF/WMF:先按原扩展名抽出,转 PNG 成功后改用 image_NNN.png,
        # 转换失败则保留原 EMF 并用 image_NNN.emf 占位(Pillow 不支持时)。
        if ext in (".emf", ".wmf"):
            preview_index += 1
            # 编号先算但不落账:只有确实留下一张图才算用掉一个号。空白预览被拦掉时
            # 下一张图接着用这个号,正文里不会出现 image_002 -> image_004 这种跳号。
            counter = counters["image"] + 1
            raw_path = media_dir / f"image_{counter:03d}{ext}"
            png_path = media_dir / media_filename("image", counter, ".png")
            with zf.open(media_name) as src, open(raw_path, "wb") as dst:
                dst.write(src.read())
            if convert_emf_to_png(str(raw_path), str(png_path)):
                if blank_previews is not None and preview_is_blank(str(png_path)):
                    _unlink(png_path)
                    _unlink(raw_path)
                    blank_previews.add(media_name)
                    if warnings is not None:
                        warnings.append(f"第 {preview_index} 个公式的预览是空白图，已跳过")
                    continue
                counters["image"] = counter
                _unlink(raw_path)
                extracted.append(ExtractedMedia(
                    local_path=str(png_path),
                    original_path=media_name,
                    kind="image",
                    ext=".png",
                ))
            else:
                # 保留原 EMF(WMF/EMF 实际 kind 仍算 image,但以原扩展名存)
                counters["image"] = counter
                try:
                    raw_path.rename(png_path.with_suffix(ext))
                    final_path = str(png_path.with_suffix(ext))
                except OSError:
                    final_path = str(raw_path)
                extracted.append(ExtractedMedia(
                    local_path=final_path,
                    original_path=media_name,
                    kind="image",
                    ext=ext,
                ))
            continue

        # 普通媒体(图片/视频/音频/其他):按 kind 分别连续编号
        counters[kind] += 1
        out_name = media_filename(kind, counters[kind], ext)
        out_path = media_dir / out_name

        with zf.open(media_name) as src, open(out_path, "wb") as dst:
            dst.write(src.read())

        extracted.append(ExtractedMedia(
            local_path=str(out_path),
            original_path=media_name,
            kind=kind,
            ext=ext,
        ))

    return extracted
