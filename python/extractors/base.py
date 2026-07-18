"""基类和数据结构定义"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class ExtractionResult:
    """提取结果"""
    markdown: str = ""
    images: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    output_dir: Optional[str] = None
    name: Optional[str] = None
    md_path: Optional[str] = None
    images_dir: Optional[str] = None


class BaseExtractor:
    """提取器基类"""

    name: str = "base"

    def __init__(self, settings: dict):
        self.settings = settings

    def extract(
        self,
        source: str,
        output_dir: Optional[str] = None,
        page_range: Optional[str] = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        raise NotImplementedError

    def _get_python_path(self) -> str:
        return self.settings.get("pythonPath", "") or "python"

    def _check_file_exists(self, path: str) -> Path:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"文件不存在: {path}")
        return p
