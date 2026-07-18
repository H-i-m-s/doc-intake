"""PDF 提取器 - 本地兜底(PDF 降级链的最末档)

只做 PDF 内嵌文本/图片提取(基于 PyMuPDF)。
不做 OCR、不识别公式、不识别表格、不重排分栏。
是有总比没有好的兜底——保证用户拿到字符流。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from .base import BaseExtractor, ExtractionResult
from logger import get_logger

logger = get_logger("pdf_extractor")

# 页码范围解析: "1-3,8,11-12" -> [1,2,3,8,11,12]
_PAGE_RANGE_PATTERN = re.compile(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*")


def parse_page_range(spec: Optional[str], total_pages: int) -> list[int]:
    """解析页码范围字符串,返回 1-based 页码列表。无 spec 返回全部。"""
    if not spec:
        return list(range(1, total_pages + 1))
    selected: set[int] = set()
    for m in _PAGE_RANGE_PATTERN.finditer(spec):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if start > end:
            start, end = end, start
        for p in range(start, end + 1):
            if 1 <= p <= total_pages:
                selected.add(p)
    return sorted(selected)


class PdfExtractor(BaseExtractor):
    """PDF 本地兜底提取器

    能力:
    - 提取每页文本字符(按 reading order,大致顺序)
    - 提取 PDF 内嵌图片
    - 支持 page_range 子集提取

    不做(留云端 OCR/MinerU):
    - 扫描版 OCR(没文本层则返回空)
    - 表格识别
    - 公式识别
    - 分栏重排
    """

    name = "pdf"

    def extract(
        self,
        source: str,
        output_dir: Optional[str] = None,
        page_range: Optional[str] = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        import fitz  # PyMuPDF

        result = ExtractionResult()
        warnings: list[str] = []

        doc = fitz.open(source)
        total = len(doc)
        pages = parse_page_range(page_range, total)

        if not pages:
            warnings.append("页码范围筛选后无有效页")
            result.markdown = "# 提取结果\n\n（页码范围无有效页）"
            doc.close()
            return result

        saved_images: list[str] = []
        images_dir: Optional[Path] = None
        if include_images and output_dir:
            stem = Path(source).stem
            images_dir = Path(output_dir) / f"{stem}_images"
            images_dir.mkdir(parents=True, exist_ok=True)

        page_chunks: list[str] = []
        total_chars = 0
        empty_pages = 0

        for page_num in pages:
            page = doc[page_num - 1]
            text = page.get_text().strip()
            total_chars += len(text)

            if not text:
                empty_pages += 1
                page_chunks.append(f"<!-- Page {page_num}: 本地无文本层,需 OCR 才能识别 -->\n")
                continue

            page_chunks.append(f"## Page {page_num}\n\n{text}\n")

            if include_images:
                saved_images.extend(self._extract_page_images(
                    page, page_num, images_dir, doc, source
                ))

        doc.close()

        if not total_chars:
            warnings.append(
                "本地 PyMuPDF 提取到 0 字符 — PDF 可能是扫描版且本档无 OCR 能力,无法降级"
            )

        if empty_pages and empty_pages < len(pages):
            warnings.append(
                f"本地提取: {empty_pages}/{len(pages)} 页为图片/扫描版,无文本可提取"
            )

        result.markdown = (
            f"# PDF 本地提取结果\n\n"
            + f"源文件: {source}\n"
            + f"提取页: {len(pages)}/{total}\n"
            + f"字符总数: {total_chars}\n\n"
            + "\n".join(page_chunks)
        )
        result.images = saved_images
        result.warnings = warnings
        result.metadata = {
            "format": "pdf",
            "reader": "pymupdf-fallback",
            "pages": {"selected": len(pages), "total": total},
            "chars": total_chars,
            "empty_pages": empty_pages,
        }
        result.output_dir = str(output_dir) if output_dir else None

        logger.info(
            "PDF 本地兜底提取完成",
            source=source,
            pages=f"{len(pages)}/{total}",
            chars=total_chars,
            images=len(saved_images),
            empty_pages=empty_pages,
        )
        return result

    def _extract_page_images(self, page, page_num: int, images_dir, doc, source: str) -> list[str]:
        """从单页提取内嵌图片。已提取过的不重复。"""
        if images_dir is None:
            return []

        saved: list[str] = []
        seen: set[int] = set()
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                img_bytes = doc.extract_image(xref)["image"]
                ext = doc.extract_image(xref)["ext"]
                out_path = images_dir / f"page{page_num:03d}_xref{xref}.{ext}"
                out_path.write_bytes(img_bytes)
                saved.append(str(out_path))
            except Exception as e:
                logger.warning(
                    "PDF 图片提取失败",
                    xref=xref,
                    page=page_num,
                    error=str(e),
                )
        return saved
