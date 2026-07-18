"""PDF splitter - PyMuPDF 实现的大 PDF 按页数切分。

仅做 PDF 内部切分(纯本地),不调任何云端 API。
"""
from __future__ import annotations

from pathlib import Path
from typing import List
import shutil

import fitz  # PyMuPDF

from logger import get_logger

logger = get_logger("pdf_splitter")


def split_pdf(
    source: str | Path,
    output_dir: str | Path,
    pages_per_chunk: int = 180,
) -> List[Path]:
    """按页数切分 PDF。返回 chunk 文件路径列表。

    Args:
        source: 源 PDF 路径
        output_dir: chunk 文件输出目录(每个 source 一个子目录)
        pages_per_chunk: 每块最大页数,小于等于此值不切

    Returns:
        chunk 文件路径列表。空 / 非 PDF 抛错。
        切分后的文件名约定: <stem>_chunk_NNN.pdf
    """
    source = Path(source)
    if not source.exists():
        raise FileNotFoundError(f"PDF 不存在: {source}")

    stem = source.stem
    src_dir = source.parent

    src_doc = fitz.open(source)
    total = len(src_doc)

    if total <= pages_per_chunk:
        src_doc.close()
        logger.info("PDF 不超阈值,不切", source=str(source), pages=total)
        return [source]

    # chunk 跟原 PDF 同目录放,避免不同挂载盘 IO,clean-up 也方便
    chunk_dir = src_dir / f"{stem}_chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)

    chunks: List[Path] = []
    page_index = 0
    chunk_idx = 0
    while page_index < total:
        chunk_idx += 1
        end_index = min(page_index + pages_per_chunk, total)
        # 创建切片 doc:导入 [page_index, end_index)
        chunk_doc = fitz.open()
        chunk_doc.insert_pdf(src_doc, from_page=page_index, to_page=end_index - 1)
        chunk_path = chunk_dir / f"{stem}_chunk_{chunk_idx:03d}.pdf"
        chunk_doc.save(str(chunk_path))
        chunk_doc.close()
        chunks.append(chunk_path)
        logger.info(
            "PDF 切分",
            source=str(source),
            chunk_index=chunk_idx,
            pages=f"{page_index + 1}-{end_index}",
            target=chunk_path.name,
        )
        page_index = end_index

    src_doc.close()
    return chunks


def cleanup_chunks(chunks: List[Path]) -> None:
    """rmtree 整个 chunk 目录（force=True,不管里面有没有 stray 文件)。"""
    if not chunks:
        return
    parents = {c.parent for c in chunks}
    for parent in parents:
        try:
            shutil.rmtree(parent, ignore_errors=True)
            logger.info("清理 chunk 目录", path=str(parent))
        except Exception as e:
            logger.warning("清理 chunk 目录失败", path=str(parent), error=str(e))
