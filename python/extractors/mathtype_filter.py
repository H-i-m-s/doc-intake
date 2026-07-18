"""MathType 预览图片过滤器"""
from __future__ import annotations

from pathlib import Path


def filter_mathtype_previews(
    media_files: list[str],
    zf,
    max_wmf_size: int = 5000,
) -> list[str]:
    """
    过滤掉 MathType 公式的预览图片（通常是小的 WMF 文件）
    
    Args:
        media_files: 媒体文件路径列表
        zf: zipfile 对象
        max_wmf_size: WMF 文件大小阈值（字节），小于此值的 WMF 文件被认为是 MathType 预览
        
    Returns:
        过滤后的媒体文件列表
    """
    mathtype_preview_files = set()
    
    for media in media_files:
        # 检查是否是 WMF 文件
        if media.lower().endswith(".wmf"):
            try:
                info = zf.getinfo(media)
                if info.file_size < max_wmf_size:
                    mathtype_preview_files.add(media)
            except KeyError:
                pass
    
    return [m for m in media_files if m not in mathtype_preview_files]


def should_skip_media(media_name: str, zf, max_wmf_size: int = 5000) -> bool:
    """
    判断是否应该跳过某个媒体文件
    
    Args:
        media_name: 媒体文件名
        zf: zipfile 对象
        max_wmf_size: WMF 文件大小阈值
        
    Returns:
        True 如果应该跳过，False 如果应该保留
    """
    if media_name.lower().endswith(".wmf"):
        try:
            info = zf.getinfo(media_name)
            return info.file_size < max_wmf_size
        except KeyError:
            return False
    return False