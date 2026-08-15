"""提取器包"""
import sys
from pathlib import Path

# 把 mathtype 模块加入 sys.path，让 docx/pptx 内的 mathtype_converter 延迟 import 能找到
_mathtype_dir = Path(__file__).parent.parent / "mathtype"
if str(_mathtype_dir) not in sys.path:
    sys.path.insert(0, str(_mathtype_dir))

from .base import BaseExtractor, ExtractionResult
from .docx_extractor import DocxExtractor
from .pptx_extractor import PptxExtractor
from .xlsx_extractor import XlsxExtractor
from .html_extractor import HtmlExtractor
from .pdf_extractor import PdfExtractor

__all__ = [
    "BaseExtractor",
    "ExtractionResult",
    "DocxExtractor",
    "PptxExtractor",
    "XlsxExtractor",
    "HtmlExtractor",
    "PdfExtractor",
]


def get_extractor(file_type: str, settings: dict) -> BaseExtractor:
    """根据文件类型获取对应的本地提取器"""
    extractors = {
        "docx": DocxExtractor,
        "doc": DocxExtractor,
        "pptx": PptxExtractor,
        "ppt": PptxExtractor,
        "xlsx": XlsxExtractor,
        "xls": XlsxExtractor,
        "xlsm": XlsxExtractor,
        "html": HtmlExtractor,
        "htm": HtmlExtractor,
        "pdf": PdfExtractor,
    }
    extractor_cls = extractors.get(file_type)
    if not extractor_cls:
        raise ValueError(f"不支持的本地提取格式: {file_type}")
    return extractor_cls(settings)
