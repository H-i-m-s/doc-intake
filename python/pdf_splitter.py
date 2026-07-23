"""PDF 分块工具。

插件运行时使用内存分块：PyMuPDF 生成 PDF bytes 后直接交给云端后端，
不在源文件目录创建 chunk PDF 或 *_chunks 目录。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, List
import re
import shutil

import fitz  # PyMuPDF

from logger import get_logger

logger = get_logger("pdf_splitter")

_PAGE_RANGE_PATTERN = re.compile(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*")


def parse_page_range(spec: str | None, total_pages: int) -> list[int]:
    """解析 1-based 页码范围，并返回去重后的升序页码列表。"""
    if not spec:
        return list(range(1, total_pages + 1))

    selected: set[int] = set()
    for match in _PAGE_RANGE_PATTERN.finditer(spec):
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else start
        if start > end:
            start, end = end, start
        selected.update(
            page for page in range(start, end + 1)
            if 1 <= page <= total_pages
        )
    return sorted(selected)


def crop_pdf_to_page_range(source: str | Path, page_range: str) -> bytes:
    """在本地裁剪 PDF，只返回指定页组成的新 PDF bytes。

    该函数用于云端后端上传前的边界处理，调用方不得在 page_range 无效时
    回退为上传原始 PDF。
    """
    source = Path(source)
    if not source.exists():
        raise FileNotFoundError(f"PDF 不存在: {source}")

    src_doc = fitz.open(source)
    try:
        pages = parse_page_range(page_range, len(src_doc))
        if not pages:
            raise ValueError("页码范围无有效页")

        cropped = fitz.open()
        try:
            for page in pages:
                cropped.insert_pdf(src_doc, from_page=page - 1, to_page=page - 1)
            return cropped.tobytes()
        finally:
            cropped.close()
    finally:
        src_doc.close()


@dataclass(frozen=True)
class PdfMemoryChunk:
    """一个仅存在于内存中的 PDF 分块。"""

    index: int
    start_page: int  # 1-based, inclusive
    end_page: int  # 1-based, inclusive
    name: str
    data: bytes


def iter_pdf_memory_chunks(
    source: str | Path,
    pages_per_chunk: int = 180,
) -> Iterator[PdfMemoryChunk]:
    """按页数生成内存 PDF 分块。

    每次 yield 一个独立的 PDF bytes，调用方消费后即可释放该分块。
    源文件只以只读方式打开，整个流程不会创建 chunk 文件。
    """
    source = Path(source)
    if not source.exists():
        raise FileNotFoundError(f"PDF 不存在: {source}")
    if pages_per_chunk <= 0:
        raise ValueError("pages_per_chunk 必须大于 0")

    src_doc = fitz.open(source)
    try:
        total = len(src_doc)
        stem = source.stem
        if total <= pages_per_chunk:
            logger.info("PDF 不超阈值,不切", source=str(source), pages=total)
            data = source.read_bytes()
            yield PdfMemoryChunk(
                index=1,
                start_page=1,
                end_page=total,
                name=source.name,
                data=data,
            )
            return

        page_index = 0
        chunk_idx = 0
        while page_index < total:
            chunk_idx += 1
            end_index = min(page_index + pages_per_chunk, total)
            chunk_doc = fitz.open()
            try:
                chunk_doc.insert_pdf(
                    src_doc,
                    from_page=page_index,
                    to_page=end_index - 1,
                )
                data = chunk_doc.tobytes()
            finally:
                chunk_doc.close()

            chunk_name = f"{stem}_chunk_{chunk_idx:03d}.pdf"
            logger.info(
                "PDF 内存分块",
                source=str(source),
                chunk_index=chunk_idx,
                pages=f"{page_index + 1}-{end_index}",
                bytes=len(data),
            )
            yield PdfMemoryChunk(
                index=chunk_idx,
                start_page=page_index + 1,
                end_page=end_index,
                name=chunk_name,
                data=data,
            )
            page_index = end_index
    finally:
        src_doc.close()


def pdf_page_count(source: str | Path) -> int:
    """读取 PDF 页数，不创建任何中间文件。"""
    source = Path(source)
    doc = fitz.open(source)
    try:
        return len(doc)
    finally:
        doc.close()


# 兼容旧版 split_cli。插件主流程不再调用此函数；外部手动调用时仍保留旧行为。
def split_pdf(
    source: str | Path,
    output_dir: str | Path,
    pages_per_chunk: int = 180,
) -> List[Path]:
    """将 PDF 写入指定目录的旧版兼容接口。"""
    source = Path(source)
    if not source.exists():
        raise FileNotFoundError(f"PDF 不存在: {source}")

    stem = source.stem
    output_dir = Path(output_dir)
    chunk_dir = output_dir / f"{stem}_chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)

    chunks: List[Path] = []
    for chunk in iter_pdf_memory_chunks(source, pages_per_chunk):
        if chunk.start_page == 1 and chunk.end_page == pdf_page_count(source):
            chunks.append(source)
            break
        chunk_path = chunk_dir / chunk.name
        chunk_path.write_bytes(chunk.data)
        chunks.append(chunk_path)
    return chunks


def cleanup_chunks(chunks: List[Path]) -> None:
    """兼容旧版调用，清理旧式 chunk 目录。"""
    if not chunks:
        return
    parents = {c.parent for c in chunks}
    for parent in parents:
        try:
            shutil.rmtree(parent, ignore_errors=True)
            logger.info("清理 chunk 目录", path=str(parent))
        except Exception as e:
            logger.warning("清理 chunk 目录失败", path=str(parent), error=str(e))
