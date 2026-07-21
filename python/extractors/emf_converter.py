"""EMF/WMF 到 PNG 转换器 与 媒体通用抽取器。

依赖 Pillow (`PIL.Image`)。如果 Pillow 不支持 EMF/WMF(老版本),
转换失败,原 EMF 仍留在 media 目录里,前端拿不到预览但不阻塞主流程。

媒体抽出接口(`extract_and_convert_media`)返回结构化 ExtractedMedia 列表,
包含本地路径 / 原 zip 路径 / kind(image/video/audio/other)/ ext。
按 kind 分别连续编号:image_001.png, image_002.png, ..., video_001.mp4, ...
调用方负责传入排序后的 media_files(保持文档引用顺序)。
"""
from __future__ import annotations

import os
from pathlib import Path

from ._utils import ExtractedMedia, classify_media, media_filename


def convert_emf_to_png(emf_path: str, png_path: str) -> bool:
    """EMF/WMF 转 PNG。失败返回 False(调用方决定如何处理)。"""
    try:
        from PIL import Image
        # 用 with 包裹 Image.open — PIL 持有 file handle 直到 close,
        # 否则源 EMF/WMF 会被锁到 GC,Windows 下表现为“文件被占用”。
        with Image.open(emf_path) as img:
            img.save(png_path, "PNG")
        return True
    except Exception:
        return False


def extract_and_convert_media(
    media_files: list[str],
    zf,
    output_dir: str,
    stem: str,
) -> list[ExtractedMedia]:
    """从 zip 里解出所有媒体文件,EMF 转 PNG。

    Args:
        media_files: zip 内的媒体文件路径列表(已按文档引用顺序排好)。
                     docx 用 'word/media/xxx.png',xlsx 用 'xl/media/xxx.png'。
        zf: 已打开的 zipfile.ZipFile。
        output_dir: 解出后的输出目录。
        stem: 文件名前缀,跟 extractor 自己的 stem 对齐。

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

    for media_name in media_files:
        ext = Path(media_name).suffix.lower()
        kind = classify_media(ext)

        # EMF/WMF:先按原扩展名抽出,转 PNG 成功后改用 image_NNN.png,
        # 转换失败则保留原 EMF 并用 image_NNN.emf 占位(Pillow 不支持时)。
        if ext in (".emf", ".wmf"):
            counters["image"] += 1
            counter = counters["image"]
            raw_path = media_dir / f"image_{counter:03d}{ext}"
            png_path = media_dir / media_filename("image", counter, ".png")
            with zf.open(media_name) as src, open(raw_path, "wb") as dst:
                dst.write(src.read())
            if convert_emf_to_png(str(raw_path), str(png_path)):
                try:
                    raw_path.unlink()
                except OSError:
                    pass
                extracted.append(ExtractedMedia(
                    local_path=str(png_path),
                    original_path=media_name,
                    kind="image",
                    ext=".png",
                ))
            else:
                # 保留原 EMF(WMF/EMF 实际 kind 仍算 image,但以原扩展名存)
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