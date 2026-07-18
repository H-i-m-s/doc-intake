"""图片分割算法"""
from __future__ import annotations

import math
from pathlib import Path
from typing import List, Optional

try:
    from PIL import Image
except ImportError:
    Image = None


class ImageSplitter:
    """长图分割器"""

    def __init__(
        self,
        enable_threshold: float = 1.2,
        color_tolerance: float = 15.0,
        blank_ratio: float = 0.98,
        min_continuous_blank: int = 5,
        scan_start_ratio: float = 1.2,
        scan_end_ratio: float = 1.5,
        overlap_ratio: float = 0.1,
    ):
        """
        Args:
            enable_threshold: 高度/宽度超过此值才启用分割
            color_tolerance: 欧氏距离色差阈值
            blank_ratio: 一行中多少比例的像素相近才算空白
            min_continuous_blank: 连续多少行空白才作为切割点
            scan_start_ratio: 从宽度的多少倍开始扫描（1.2）
            scan_end_ratio: 扫描到宽度的多少倍截止（1.5）
            overlap_ratio: 重叠比例（0.1 = 10%）
        """
        self.enable_threshold = enable_threshold
        self.color_tolerance = color_tolerance
        self.blank_ratio = blank_ratio
        self.min_continuous_blank = min_continuous_blank
        self.scan_start_ratio = scan_start_ratio
        self.scan_end_ratio = scan_end_ratio
        self.overlap_ratio = overlap_ratio

    def need_split(self, image: Image.Image) -> bool:
        """判断是否需要分割"""
        width, height = image.size
        return height > width * self.enable_threshold

    def split(self, image: Image.Image) -> List[Image.Image]:
        """
        分割长图

        Returns:
            分割后的图片列表
        """
        if not self.need_split(image):
            return [image]

        width, height = image.size
        chunks = []
        y_start = 0

        while y_start < height:
            # 计算扫描范围
            scan_start = y_start + int(width * self.scan_start_ratio)
            scan_end = y_start + int(width * self.scan_end_ratio)

            # 寻找切割点
            cut_y = self._find_cut_point(image, scan_start, scan_end, width)
            found_blank = cut_y is not None

            if not found_blank:
                # 没找到空白行，强制在 1.5W 处切割（带重叠，防止文字被切）
                cut_y = y_start + int(width * self.scan_end_ratio)

            # 确保不超过图片高度
            cut_y = min(cut_y, height)

            # 检查剩余高度
            remaining = height - cut_y
            if remaining < width * 0.5:
                # 剩余太少，合并到当前块
                cut_y = height

            # 切割
            chunk = image.crop((0, y_start, width, cut_y))
            chunks.append(chunk)

            # 更新起始位置
            if cut_y < height:
                if found_blank:
                    # 找到空白行，直接从此处继续，无重叠
                    y_start = cut_y
                else:
                    # 强制切割，带重叠防止文字被切
                    overlap = int(width * self.overlap_ratio)
                    y_start = cut_y - overlap
            else:
                y_start = cut_y

        return chunks

    def _find_cut_point(
        self,
        image: Image.Image,
        scan_start: int,
        scan_end: int,
        width: int,
    ) -> Optional[int]:
        """
        在扫描范围内寻找切割点
        """
        pixels = image.load()
        blank_start = None
        blank_count = 0

        for y in range(scan_start, min(scan_end, image.height)):
            if self._is_blank_row(pixels, y, width):
                if blank_start is None:
                    blank_start = y
                blank_count += 1

                if blank_count >= self.min_continuous_blank:
                    # 找到足够的连续空白行，在中间切割
                    return blank_start + blank_count // 2
            else:
                blank_start = None
                blank_count = 0

        return None

    def _is_blank_row(self, pixels, y: int, width: int) -> bool:
        """
        判断一行是否为空白行

        使用欧氏距离计算色差，98% 以上像素与中位数相近则认为空白。
        """
        row_pixels = [pixels[x, y] for x in range(width)]

        # 取中位数作为参考色
        row_pixels.sort(key=lambda p: (p[0] + p[1] + p[2]) / 3)
        median = row_pixels[len(row_pixels) // 2]

        # 计算与中位数相近的像素比例
        similar_count = 0
        for pixel in row_pixels:
            distance = math.sqrt(
                (pixel[0] - median[0]) ** 2 +
                (pixel[1] - median[1]) ** 2 +
                (pixel[2] - median[2]) ** 2
            )
            if distance < self.color_tolerance:
                similar_count += 1

        ratio = similar_count / len(row_pixels)
        return ratio >= self.blank_ratio

    def split_and_save(
        self,
        image_path: str,
        output_dir: str,
        prefix: str = "split",
    ) -> List[str]:
        """
        分割图片并保存
        """
        image = Image.open(image_path)
        chunks = self.split(image)

        if len(chunks) == 1:
            return [image_path]

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        saved_paths = []
        stem = Path(image_path).stem
        suffix = Path(image_path).suffix or ".png"

        for i, chunk in enumerate(chunks):
            filename = f"{prefix}_{stem}_{i:03d}{suffix}"
            filepath = output_path / filename
            chunk.save(str(filepath))
            saved_paths.append(str(filepath))

        return saved_paths


def merge_markdown_deduplicate(markdowns: List[str]) -> str:
    """
    合并多个 markdown 并去重

    对比上一个末尾和下一个开头，有重叠则只保留一个。
    """
    if not markdowns:
        return ""
    if len(markdowns) == 1:
        return markdowns[0]

    result = markdowns[0]

    for md in markdowns[1:]:
        # 取上一个末尾 200 字符，下一个开头 200 字符
        tail = result[-100:]
        head = md[:100]

        # 找重叠部分
        overlap_len = _find_overlap_length(tail, head)

        if overlap_len > 0:
            # 去掉重叠部分，拼接
            result = result[:-overlap_len] + md
        else:
            result += "\n\n" + md

    return result


def _find_overlap_length(tail: str, head: str) -> int:
    """
    找到 tail 末尾和 head 开头的重叠长度
    """
    max_overlap = min(len(tail), len(head))

    # 从最大可能的重叠开始尝试
    for length in range(max_overlap, 10, -1):
        if tail[-length:] == head[:length]:
            return length

    return 0
