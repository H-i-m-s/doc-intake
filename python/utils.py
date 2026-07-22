"""工具函数：图片归一化"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import List, Optional, Union

import requests
from PIL import Image

from logger import get_logger

logger = get_logger("utils")


def normalize_images(
    raw_images: List[Union[str, Path, dict]],
    output_dir: str,
    stem: str,
    cleanup_temps: bool = True,
    media_prefix: str = "",
) -> List[str]:
    """
    归一化媒体路径：统一放到 {stem}_media/ 目录

    Args:
        raw_images: 原始图片列表，支持以下类型混传：
            - str/Path: URL 或本地路径
            - dict: {"url": str, "virtual_path": str}（PaddleOCR 格式）
                    会按 virtual_path 的 basename 保存文件
        output_dir: 输出目录
        stem: 文件名前缀（不含扩展名）
        cleanup_temps: 是否清理临时文件（分割产生的）
        media_prefix: 媒体文件名前缀，用于并发分块结果去重

    Returns:
        归一化后的本地路径列表
    """
    if not raw_images:
        return []

    if not output_dir:
        return [str(img.get("url", img) if isinstance(img, dict) else img) for img in raw_images]

    media_dir = Path(output_dir) / f"{stem}_media"
    media_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    temp_paths = []  # 记录临时文件,后续清理

    for i, img in enumerate(raw_images, 1):
        # dict 格式（PaddleOCR）：按 virtual_path 的 basename 保存
        if isinstance(img, dict):
            src_url = img.get("url", "")
            virtual_path = img.get("virtual_path", "")
            if not src_url:
                continue
            # 用 virtual_path 的 basename 当文件名，避免重名覆盖
            base = Path(virtual_path).name if virtual_path else f"{i:03d}.jpg"
            dest = media_dir / f"{media_prefix}{base}"
            try:
                # 用 with 让 Response 走完流程后立刻释放连接,
                # 避免 HTTP 连接池被占满 / 流未释放。
                with requests.get(src_url, timeout=30) as response:
                    response.raise_for_status()
                    dest.write_bytes(response.content)
                saved_paths.append(str(dest))
            except Exception as e:
                logger.warning(f"保存图片 {i} 失败", error=str(e), src=src_url[:200])
            continue

        # mineru.Image 对象（name, data, path）—— 用 Image.name 当文件名（保留原扩展名）
        if hasattr(img, "data") and hasattr(img, "path") and hasattr(img, "name"):
            try:
                dest = media_dir / f"{media_prefix}{Path(img.name).name}"
                img.save(str(dest))
                saved_paths.append(str(dest))
            except Exception as e:
                logger.warning(f"保存图片 {i} 失败", error=str(e), src=str(img)[:200])
            continue

        # string/Path 格式（保留原逻辑）
        filename = f"{i:03d}.png"
        dest = media_dir / f"{media_prefix}{filename}"

        try:
            if isinstance(img, str) and img.startswith("http"):
                # 用 with 让 Response 走完流程后立刻释放连接。
                with requests.get(img, timeout=30) as response:
                    response.raise_for_status()
                    dest.write_bytes(response.content)

            elif hasattr(img, "save"):
                img.save(str(dest))

            elif isinstance(img, (str, Path)):
                src = Path(img)
                if src.exists():
                    shutil.copy2(str(src), str(dest))
                    if cleanup_temps and "split" in src.stem.lower():
                        temp_paths.append(src)
                else:
                    continue

            saved_paths.append(str(dest))

        except Exception as e:
            logger.warning(f"保存图片 {i} 失败", error=str(e), src=str(img)[:200])
            continue

    if cleanup_temps and temp_paths:
        for temp in temp_paths:
            try:
                temp.unlink(missing_ok=True)
            except Exception:
                pass

        try:
            temp_dir = temp_paths[0].parent
            if temp_dir.exists() and not any(temp_dir.iterdir()):
                temp_dir.rmdir()
        except Exception:
            pass

    return saved_paths