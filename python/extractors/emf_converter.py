"""EMF/WMF 到 PNG 转换器

依赖 Pillow (`PIL.Image`)。如果 Pillow 不支持 EMF/WMF(老版本),
转换失败,原 EMF 仍留在 images 目录里,前端拿不到预览但不阻塞主流程。
"""
from __future__ import annotations

import os
from pathlib import Path


def convert_emf_to_png(emf_path: str, png_path: str) -> bool:
    """EMF/WMF 转 PNG。失败返回 False(调用方决定如何处理)。"""
    try:
        from PIL import Image
        img = Image.open(emf_path)
        img.save(png_path, "PNG")
        return True
    except Exception:
        return False


def process_image_file(file_path: str, output_dir: str, stem: str, counter: int) -> tuple[str, str]:
    """处理图片文件:EMF/WMF 尝试转 PNG,成功后删原文件。"""
    ext = Path(file_path).suffix.lower()

    if ext in [".emf", ".wmf"]:
        images_dir = Path(output_dir) / f"{stem}_images"
        png_path = images_dir / f"image_{counter:03d}.png"
        if convert_emf_to_png(file_path, str(png_path)):
            try:
                os.remove(file_path)
            except OSError:
                pass
            return str(png_path), ".png"

    return file_path, ext


def extract_and_convert_media(
    media_files: list[str],
    zf,
    output_dir: str,
    stem: str,
    media_prefix: str = "word/media/",
) -> list[str]:
    """从 zip 里解出媒体文件,EMF 转 PNG。

    Args:
        media_files: zip 内的媒体文件路径列表(word/media/xxx.png 等)。
        zf: 已打开的 zipfile.ZipFile。
        output_dir: 解出后的输出目录。
        stem: 文件名前缀,跟 extractor 自己的 stem 对齐。
        media_prefix: zip 内路径前缀,docx 用 "word/media/",xlsx 用 "xl/media/"。

    Returns:
        解出后的本地文件路径列表。
    """
    if not media_files:
        return []

    if not output_dir:
        return media_files

    images_dir = Path(output_dir) / f"{stem}_images"
    images_dir.mkdir(parents=True, exist_ok=True)

    extracted = []
    counter = 1

    for media_name in media_files:
        ext = Path(media_name).suffix
        out_name = f"image_{counter:03d}{ext}"
        out_path = images_dir / out_name

        with zf.open(media_name) as src, open(out_path, "wb") as dst:
            dst.write(src.read())

        final_path, _ = process_image_file(str(out_path), output_dir, stem, counter)
        extracted.append(final_path)
        counter += 1

    return extracted