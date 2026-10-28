"""PaddleOCR 自建服务客户端（PaddleX Serving，paddlex --serve --pipeline OCR）。

与 PaddleClient 的区别只有传输层：云端走建任务 + 轮询 + 下载 jsonl，本地是一请求一响应。
markdown 的拼装约定与 paddle_client 保持一致（逐页取文本，页与页之间空行分隔）。
"""
from __future__ import annotations

import base64
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Optional

import requests

sys.path.insert(0, str(Path(__file__).parent))

from extractors.base import ExtractionResult
from logger import get_logger
from utils import align_image_refs, normalize_images

_PROBE_TIMEOUT = 10
# OCR 在本地 CPU 上跑一页要几秒，整份文档给足时间。
_TIMEOUT = (_PROBE_TIMEOUT, 1800)
_DOWNLOAD_TIMEOUT = (30, 300)

_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}

# PaddleX 的 fileType：0 = PDF，1 = 图像。
_FILE_TYPE_PDF = 0
_FILE_TYPE_IMAGE = 1

# PaddleX 产线默认只取前 10 张输入图，除非产线配置里把 Serving.extra.max_num_input_imgs 设成 null。
_DEFAULT_PAGE_LIMIT = 10

_PAGE_LIMIT_WARNING = (
    "PaddleX Serving 默认最多处理 10 页：本次只拿回 {returned}/{requested} 页。"
    "需在产线配置里设置 Serving.extra.max_num_input_imgs: null 才能放开这个上限。"
)


def _snippet(response: requests.Response, limit: int = 300) -> str:
    try:
        text = response.text
    except Exception:
        return "<无法读取响应体>"
    text = " ".join(str(text or "").split())
    return text[:limit] + ("…" if len(text) > limit else "")


def _pdf_page_count(data: bytes) -> int:
    """数实际送去识别的页数，用来和返回的页数对比。"""
    import fitz

    document = fitz.open(stream=data, filetype="pdf")
    try:
        return len(document)
    finally:
        document.close()


def _crop_pdf_bytes(data: bytes, page_range: str) -> bytes:
    """pageRange 是边界：先裁再编码，不能把整份 PDF 交给服务端。"""
    import fitz

    from pdf_splitter import parse_page_range

    document = fitz.open(stream=data, filetype="pdf")
    try:
        pages = parse_page_range(page_range, len(document))
        if not pages:
            raise ValueError("页码范围无有效页")
        cropped = fitz.open()
        try:
            for page in pages:
                cropped.insert_pdf(document, from_page=page - 1, to_page=page - 1)
            return cropped.tobytes()
        finally:
            cropped.close()
    finally:
        document.close()


def _decode_image(value: Any) -> Optional[bytes]:
    """PaddleX 的 ocrImage / inputImage 是 base64 或 data URL，空值时给 None。"""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.startswith("data:"):
        head, _, payload = text.partition(",")
        if "base64" not in head:
            return None
        text = payload
    try:
        return base64.b64decode("".join(text.split()), validate=True)
    except Exception:
        return None


def _page_markdown(pruned: dict) -> str:
    """单页 markdown。

    与 paddle_client 的取法一致：优先 markdown.text；PaddleX 的产线结果没有这一层时，
    再按结构化块（parsing_res_list）或识别行（rec_texts）拼。
    """
    if not isinstance(pruned, dict):
        return ""

    markdown = pruned.get("markdown")
    if isinstance(markdown, dict):
        text = markdown.get("text")
        if isinstance(text, str) and text.strip():
            return text
    elif isinstance(markdown, str) and markdown.strip():
        return markdown

    blocks = pruned.get("parsing_res_list")
    if isinstance(blocks, list):
        parts = [
            str(block.get("block_content") or "").strip()
            for block in blocks
            if isinstance(block, dict)
        ]
        body = "\n\n".join(part for part in parts if part)
        if body:
            return body

    lines = pruned.get("rec_texts")
    if isinstance(lines, list):
        body = "\n".join(str(line) for line in lines if str(line).strip())
        if body:
            return body

    return ""


class PaddleLocalClient:
    """自建 PaddleX Serving 客户端（无鉴权）。"""

    def __init__(self, settings: dict):
        self.settings = settings
        self.endpoint = str(settings.get("paddleLocalEndpoint") or "").strip().rstrip("/")
        self.logger = get_logger("paddleocr-local")
        if not self.endpoint:
            raise ValueError(
                "paddleocr-local 后端需要先填写「PaddleOCR 本地服务地址」(paddleLocalEndpoint)"
            )

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        keys: list[str] | None = None,
        pdf_bytes: bytes | None = None,
        display_name: str | None = None,
        **kwargs,
    ) -> ExtractionResult:
        # keys 只为保持与 PaddleClient 同签名：PaddleX Serving 默认不校验鉴权。
        start_time = time.time()

        data = self._read_source_bytes(source, pdf_bytes)
        is_pdf = self._is_pdf(source, data)
        if is_pdf and page_range:
            self.logger.debug("按 pageRange 在本地裁剪 PDF", page_range=page_range)
            data = _crop_pdf_bytes(data, page_range)

        requested_pages = _pdf_page_count(data) if is_pdf else None
        self.logger.info(
            "开始 PaddleOCR 本地提取",
            source=Path(source).name,
            endpoint=self.endpoint,
            file_type="pdf" if is_pdf else "image",
            pages=requested_pages,
        )

        payload = {
            "file": base64.b64encode(data).decode("ascii"),
            "fileType": _FILE_TYPE_PDF if is_pdf else _FILE_TYPE_IMAGE,
        }
        response = requests.post(
            f"{self.endpoint}/ocr", json=payload, timeout=_TIMEOUT
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"PaddleOCR 本地服务返回失败: HTTP {response.status_code} {_snippet(response)}"
            )
        try:
            body = response.json()
        except ValueError as e:
            raise RuntimeError(
                f"PaddleOCR 本地服务响应不是 JSON: {_snippet(response)}"
            ) from e

        error_code = body.get("errorCode")
        if error_code not in (0, "0", None):
            raise RuntimeError(
                f"PaddleOCR 本地服务报错: errorCode={error_code} {body.get('errorMsg') or ''}".strip()
            )

        result_block = body.get("result") or {}
        ocr_results = result_block.get("ocrResults")
        if not isinstance(ocr_results, list) or not ocr_results:
            raise RuntimeError(
                f"PaddleOCR 本地服务没有返回 ocrResults: keys={sorted(body)[:8]}"
            )

        result = ExtractionResult()
        work_dir = Path(tempfile.mkdtemp(prefix="doc-intake-paddle-local-"))
        try:
            page_texts: list[str] = []
            media_entries: list[tuple[Any, str]] = []
            for index, item in enumerate(ocr_results, 1):
                if not isinstance(item, dict):
                    continue
                page_texts.append(_page_markdown(item.get("prunedResult") or {}))
                media_entries.extend(
                    self._collect_images(item, index, work_dir)
                )

            # 与 paddle_client 一致：逐页文本用空行分隔，页内换行保持原样。
            markdown = "\n\n".join(text for text in page_texts if text)
            result.images, image_path_map = self._save_media(
                media_entries, output_dir, include_images, display_name or source
            )
            # 本地产线给的 markdown 引用可能是 images/x.png，而映射键是 imgs/x.png，
            # 形态不一致时上游重写会落空，这里先按文件名对齐。
            result.markdown = align_image_refs(markdown, image_path_map)
            result.metadata = {
                "format": "document",
                "reader": "paddleocr-local",
                "usedBackend": "paddleocr-local",
                "endpoint": self.endpoint,
                "pageCount": len(ocr_results),
                "imagePathMap": image_path_map,
            }
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        if requested_pages and len(ocr_results) < requested_pages:
            result.warnings.append(
                _PAGE_LIMIT_WARNING.format(returned=len(ocr_results), requested=requested_pages)
            )
            self.logger.warning(
                "PaddleOCR 本地返回页数少于请求页数",
                returned=len(ocr_results),
                requested=requested_pages,
                default_limit=_DEFAULT_PAGE_LIMIT,
            )

        self.logger.log_api_call(
            api_name="paddleocr-local", success=True, duration=time.time() - start_time
        )
        return result

    def _is_pdf(self, source: str, data: bytes) -> bool:
        if Path(source).suffix.lower() == ".pdf":
            return True
        if Path(source).suffix.lower() in _IMAGE_SUFFIXES:
            return False
        return data[:5] == b"%PDF-"

    def _read_source_bytes(self, source: str, pdf_bytes: Optional[bytes]) -> bytes:
        if pdf_bytes is not None:
            return pdf_bytes
        if source.startswith(("http://", "https://")):
            response = requests.get(source, timeout=_DOWNLOAD_TIMEOUT)
            response.raise_for_status()
            return response.content
        path = Path(source)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {source}")
        return path.read_bytes()

    def _collect_images(
        self, item: dict, page_index: int, work_dir: Path
    ) -> list[tuple[Any, str]]:
        """收集这一页能落盘的图：markdown.images（云端同款结构）与 ocrImage / inputImage。"""
        entries: list[tuple[Any, str]] = []

        pruned = item.get("prunedResult") or {}
        markdown_block = pruned.get("markdown") if isinstance(pruned, dict) else None
        if isinstance(markdown_block, dict):
            for virtual_path, real_url in (markdown_block.get("images") or {}).items():
                if isinstance(real_url, str) and real_url.startswith(("http://", "https://")):
                    entries.append(({"url": real_url, "virtual_path": str(virtual_path)}, str(virtual_path)))
                else:
                    entry = self._write_image(work_dir, str(virtual_path), real_url, page_index)
                    if entry:
                        entries.append(entry)

        for field in ("ocrImage", "inputImage"):
            entry = self._write_image(
                work_dir, f"imgs/page_{page_index}.jpg", item.get(field), page_index
            )
            if entry:
                entries.append(entry)

        return entries

    def _write_image(
        self, work_dir: Path, virtual_path: str, value: Any, page_index: int
    ) -> Optional[tuple[str, str]]:
        data = _decode_image(value)
        if data is None:
            return None
        key = virtual_path if virtual_path.startswith("imgs/") else f"imgs/{Path(virtual_path).name}"
        target = work_dir / key
        # key 含服务端给的路径段，属于外部输入；落盘前确认没越出临时目录，
        # 越界就退回 basename 再写。映射键保持原样，markdown 里的引用才对得上。
        if not target.resolve().is_relative_to(work_dir.resolve()):
            target = work_dir / "imgs" / Path(key).name
        target.parent.mkdir(parents=True, exist_ok=True)
        suffix = Path(virtual_path).suffix.lower() or ".jpg"
        if target.suffix.lower() != suffix:
            target = target.with_suffix(suffix)
        target.write_bytes(data)
        return (str(target), key)

    def _save_media(
        self,
        media_entries: list[tuple[Any, str]],
        output_dir: Optional[str],
        include_images: bool,
        source: str,
    ) -> tuple[list[str], dict[str, str]]:
        if not include_images or not media_entries:
            return [], {}

        raw_images = [raw for raw, _ in media_entries]
        stem = self.settings.get("outputStem") or Path(source).stem
        media_prefix = self.settings.get("mediaPrefix", "")
        path_map: dict[str, str] = {}
        saved = normalize_images(
            raw_images,
            output_dir,
            stem,
            media_prefix=media_prefix,
            path_map=path_map,
        )

        image_path_map: dict[str, str] = {}
        for raw, virtual_key in media_entries:
            source_key = str(raw.get("virtual_path") or raw.get("url")) if isinstance(raw, dict) else str(raw)
            local_path = path_map.get(source_key)
            if not local_path:
                continue
            key = virtual_key if virtual_key.startswith("imgs/") else f"imgs/{Path(virtual_key).name}"
            image_path_map[key] = local_path
        return saved, image_path_map
