"""doc-intake Python 主入口"""
from __future__ import annotations

import argparse
import json
import os
import re as _re
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional, Iterable

# 添加当前目录到 path
sys.path.insert(0, str(Path(__file__).parent))

# 使用绝对导入，避免相对导入问题
from extractors.base import BaseExtractor, ExtractionResult
from extractors import get_extractor
from extractors._utils import markdown_media_path
from logger import configure_logging, get_logger, log
from pdf_splitter import PdfMemoryChunk, iter_pdf_memory_chunks, pdf_page_count
from auth_ledger import drain as _drain_auth_failures
import barcode_scan


@contextmanager
def redirect_io_to_stderr() -> Iterator[None]:
    """将 stdout 临时重定向到 stderr，避免第三方库的 print() 污染最终 JSON 输出。

    退出 with 块后 stdout 自动恢复。
    """
    original_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = original_stdout


def detect_file_type(source: str) -> str:
    """检测文件类型"""
    # URL 默认当作 HTML 处理
    if source.startswith(("http://", "https://")):
        return "html"
    
    ext = Path(source).suffix.lower()
    type_map = {
        ".pdf": "pdf",
        ".jpg": "image",
        ".jpeg": "image",
        ".png": "image",
        ".bmp": "image",
        ".tiff": "image",
        ".tif": "image",
        ".webp": "image",
        ".gif": "image",
        ".docx": "docx",
        ".doc": "doc",
        ".pptx": "pptx",
        ".ppt": "ppt",
        ".xlsx": "xlsx",
        ".xls": "xls",
        ".xlsm": "xlsm",
        ".html": "html",
        ".htm": "html",
    }
    return type_map.get(ext, "unknown")


def load_settings(args) -> dict:
    """读取 JS 通过 stdin 传入的设置，环境变量仅作为旧版兼容回退。

    当前入口的 stdin 只承载一份完整 JSON 配置，读取完成后立即关闭管道。
    Windows 下不能可靠地用 select 轮询 TextIOWrapper，因此直接读取 EOF。
    JS 端会在 spawn 后写入 JSON 并关闭 stdin，不会产生永久等待。
    """
    try:
        # JS 正式入口将 stdin 连接为 pipe；直接在终端运行时不读取控制台，避免阻塞。
        if not sys.stdin.isatty():
            settings_str = sys.stdin.read().lstrip("\ufeff")
            if settings_str and settings_str.strip():
                loaded = json.loads(settings_str)
                if isinstance(loaded, dict):
                    return loaded
    except (EOFError, OSError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        pass

    # 兼容直接命令行启动旧版本的调用方式；正式 JS 入口不会再注入该环境变量。
    settings_str = os.environ.get("DOC_INTAKE_SETTINGS")
    if settings_str:
        try:
            loaded = json.loads(settings_str)
            return loaded if isinstance(loaded, dict) else {}
        except (TypeError, json.JSONDecodeError):
            pass
    return {}


def default_save_path() -> str:
    """savePath 留空时的默认位置：系统文档目录下的 doc-intake（没有 Documents 就退到家目录）。

    不写死任何盘符：这个 app 要装到别人电脑上，位置得按各自的机器算。
    """
    home = os.path.expanduser("~")
    docs = os.path.join(home, "Documents")
    return os.path.join(docs if os.path.isdir(docs) else home, "doc-intake")


def determine_output_dir(args, settings) -> Optional[str]:
    """确定输出目录（要不要落盘、落在哪的唯一权威）。

    为什么放在这边：JS 侧进程受 Node Permission Model 限制，只能读安装目录 /
    app-data / 宿主 locales，探测「有没有 Documents 目录」会抛 ERR_ACCESS_DENIED，
    所以带文件系统判断的默认值只能在不受限的子进程里算。
    """
    if args.output_dir:
        return args.output_dir

    # summaryOnly 要留下可读取的完整结果，否则调用方只有状态而没有路径。
    if settings.get("autoSave", False) or settings.get("summaryOnly", False):
        return settings.get("savePath") or default_save_path()

    return None


# 「只有码、没有正文」的判定门槛。全都往保守里取：宁可多走一次正常提取，
# 也不要把一份真文档误判成一张二维码，让用户拿不到正文。
# ratio 是码的四角点面积占整图的比例，实测分布：文档页里嵌的码 0.002~0.081，
# 扫描页中间放一个大码 0.139~0.337，码几乎占满画面 0.62~0.96。取 0.30 是唯一能把
# 前两档排掉、又不漏掉「整页就一个码」的分界。
_BARCODE_ONLY_MAX_TEXT_CHARS = 20
_BARCODE_ONLY_MAX_PAGES = 3
_BARCODE_ONLY_MAX_MEDIA = 3
_BARCODE_ONLY_MIN_RATIO = 0.30


def _scan_source_for_barcodes(
    source: str,
    file_type: str,
    max_pages: Optional[int] = None,
    metadata_only: bool = False,
):
    """按文件类型挑一个扫描入口；不支持的格式返回 None（等于「没结论」）。"""
    try:
        if file_type == "pdf":
            return barcode_scan.scan_pdf(source, max_pages=max_pages, metadata_only=metadata_only)
        if file_type == "image":
            # 图片没有「只数规模」这回事：不真正解一次就不知道有没有码
            return barcode_scan.scan_image_file(source)
        if file_type in ("docx", "pptx", "xlsx", "xlsm"):
            return barcode_scan.scan_office(
                source, Path(source).suffix, metadata_only=metadata_only
            )
    except Exception:
        return None
    return None


def _barcode_scan_over_threshold(scan) -> bool:
    """量出的规模是否已经让免落盘短路不可能成立。"""
    if scan is None:
        return False
    return (
        scan.text_chars > _BARCODE_ONLY_MAX_TEXT_CHARS
        or scan.page_count > _BARCODE_ONLY_MAX_PAGES
        or scan.media_count > _BARCODE_ONLY_MAX_MEDIA
    )


def _prefetch_barcode_scan(args, settings: dict, file_type: str, output_dir: Optional[str]):
    """规模已超阈值时，把完整扫码扔到后台，和随后的提取重叠。

    返回 (future, pool, over_threshold)。over_threshold=True 表示短路注定不成立，
    调用方不必再跑一次短路判定 —— 那会为了必输的判定把全文再扫一遍。

    只对 PDF / Office 做这个预判：单张图片的正文数、页数、媒体数恒定在阈值之下，
    探一次等于白解一次码。这里的 metadata_only 探测只数页与成员，成本可忽略。
    云端 HTTP 读和本地 zxing 都释放 GIL，两边才能真并行。
    """
    if output_dir or not settings.get("barcodeScan", True) or not barcode_scan.is_available():
        return None, None, False
    if file_type not in ("pdf", "docx", "pptx", "xlsx", "xlsm"):
        return None, None, False

    meta = _scan_source_for_barcodes(
        args.source, file_type, _BARCODE_ONLY_MAX_PAGES, metadata_only=True
    )
    if not _barcode_scan_over_threshold(meta):
        return None, None, False

    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(
        _scan_source_for_barcodes, args.source, file_type, _BARCODE_ONLY_MAX_PAGES, False
    )
    return future, pool, True


def _take_barcode_prefetch(future, pool) -> Optional[list]:
    """取后台扫码结果并折算成 dedupe 后的结构；失败只当没有码。"""
    if future is None:
        return None
    scan = None
    try:
        scan = future.result()
    except Exception:
        scan = None
    finally:
        # 任务已经结束，不再等它；wait=False 避免意外阻塞现场
        if pool is not None:
            pool.shutdown(wait=False)
    if scan is None or not scan.hits:
        return None
    return barcode_scan.dedupe(scan.hits)


def _barcode_only_markdown(codes: list[dict]) -> str:
    lines = [
        "# 仅含二维码/条码（未保存到本地）",
        "",
        "该文件里没有可提取的正文，内容只有码，未保存到本地。",
        "",
    ]
    for code in codes:
        label = code.get("format_label") or "条码"
        if not code.get("text"):
            lines.append(f"- {label}：无法解码（{code.get('error') or '未知错误'}）")
            continue
        body = barcode_scan.code_lines(code["text"])
        if len(body) == 1:
            lines.append(f"- {label}：{body[0]}")
        else:
            lines.append(f"- {label}：")
            lines.extend(body)
    return "\n".join(lines).rstrip() + "\n"


def _append_barcode_section(markdown: str, codes: list[dict]) -> str:
    """未落盘时，把码内容作为一节追加到正文末尾。

    落盘时码内容挂在引用它的那张图下面；不落盘就没有媒体文件可挂，只能集中放末尾。
    末尾说明扫描只覆盖前几页，免得读者以为全文都扫过了。
    """
    if not codes:
        return markdown
    lines = ["## 二维码与条码", ""]
    for code in codes:
        label = code.get("format_label") or "条码"
        if not code.get("text"):
            lines.append(f"- {label}：无法解码（{code.get('error') or '未知错误'}）")
            continue
        body = barcode_scan.code_lines(code["text"])
        if len(body) == 1:
            lines.append(f"- {label}：{body[0]}")
        else:
            lines.append(f"- {label}：")
            lines.extend(body)
    lines.append("")
    lines.append("（以上来自文件前 3 页的扫描，未覆盖全文）")
    base = (markdown or "").rstrip("\n")
    return f"{base}\n\n" + "\n".join(lines) + "\n"


def _barcode_only_result(args, settings: dict, file_type: str, output_dir: Optional[str]):
    """文件只有码、没有正文时直接给结果，不进后端链。

    返回值是 (短路结果, 已扫到的 codes)。短路结果非 None 时就是最终回复；codes 不管
    短路与否都交出去，提取完成后可以复用到正文末尾。以前判定失败就直接丢掉扫描结果，
    图片这类不走预判的类型等于白扫一次，码也拿不到。

    为什么要这条短路：一页纯二维码的扫描件送进云端 OCR，花掉一次调用后拿回来的只有
    「图片占位 + 空正文」，而码内容本地几十毫秒就能解出来。
    但只在完全没要求落盘时走：用户要文件时，媒体必须由正常提取流程落下来。
    """
    if output_dir is not None:
        return None, None
    if not settings.get("barcodeScan", True):
        return None, None
    if not barcode_scan.is_available():
        return None, None

    scan = _scan_source_for_barcodes(args.source, file_type, _BARCODE_ONLY_MAX_PAGES)
    if scan is None:
        return None, None
    hits = scan.hits or []
    codes = barcode_scan.dedupe(hits) if hits else None
    if scan.text_chars > _BARCODE_ONLY_MAX_TEXT_CHARS:
        return None, codes
    if scan.page_count > _BARCODE_ONLY_MAX_PAGES or scan.media_count > _BARCODE_ONLY_MAX_MEDIA:
        return None, codes
    if not any(hit.readable and hit.ratio >= _BARCODE_ONLY_MIN_RATIO for hit in hits):
        return None, codes

    result = ExtractionResult()
    result.name = args.source
    result.markdown = _barcode_only_markdown(codes or [])
    result.metadata = {
        "format": file_type,
        "reader": "barcode-only",
        "barcodeOnlyDocument": True,
        "barcodeCodes": codes or [],
    }
    return format_result(result), codes


# PDF 后端降级链留空时的自动档：先云端 MinerU，再 PaddleOCR，再两个自建服务，最后本地。
# 自建服务排在云端后面：填了地址才生效，没填的会在选链时被剔除。
DEFAULT_PDF_BACKEND_CHAIN = [
    "mineru",
    "paddleocr",
    "mineru-local",
    "paddleocr-local",
    "local",
]

# 图片链留空时的兜底：云端 PaddleOCR 优先，其次自建 PaddleX。
DEFAULT_IMAGE_BACKEND_CHAIN = ["paddleocr", "paddleocr-local"]

# 自建后端只有填了地址才算可用，键是后端 id，值是必须填的设置项。
_LOCAL_BACKEND_REQUIREMENTS = {
    "mineru-local": "mineruLocalEndpoint",
    "paddleocr-local": "paddleLocalEndpoint",
}


def _backend_configured(backend: str, settings: dict) -> bool:
    """本地后端只有在填了地址时才算可用。"""
    required = _LOCAL_BACKEND_REQUIREMENTS.get(backend)
    if not required:
        return True
    return bool(str(settings.get(required) or "").strip())


def select_backend_chain(
    file_type: str,
    explicit_backend: str,
    settings: dict,
) -> list[str]:
    """根据文件类型从 settings 里读后端链。返回有序列表（首选 -> 兑底）。

    语义：
    - 用户显式给 backend：链上就是 [explicit_backend]；自建后端没填地址时报错，不静默剔除
    - auto: 从 settings.pdfBackendChain / settings.imageBackendChain 读，剔除未配置的自建后端
    """
    logger = get_logger("backend_selector")

    if explicit_backend and explicit_backend != "auto":
        if not _backend_configured(explicit_backend, settings):
            required = _LOCAL_BACKEND_REQUIREMENTS[explicit_backend]
            raise ValueError(
                f"后端 {explicit_backend} 需要先在设置里填写「{required}」"
            )
        return [explicit_backend]

    if file_type == "pdf":
        chain = list(settings.get("pdfBackendChain") or DEFAULT_PDF_BACKEND_CHAIN)
    elif file_type == "image":
        chain = list(settings.get("imageBackendChain") or DEFAULT_IMAGE_BACKEND_CHAIN)
    elif file_type in ("docx", "doc", "pptx", "ppt", "xlsx", "xls", "xlsm", "html", "htm"):
        chain = ["local"]
    else:
        chain = ["local"]

    usable: list[str] = []
    for backend in chain:
        if _backend_configured(backend, settings):
            usable.append(backend)
            continue
        logger.info(
            "跳过未配置的本地后端",
            backend=backend,
            required_setting=_LOCAL_BACKEND_REQUIREMENTS[backend],
        )

    logger.debug("后端链选定", file_type=file_type, chain=usable)
    return usable


def extract_with_chain(
    source: str,
    file_type: str,
    output_dir: Optional[str],
    backend_chain: list[str],
    settings: dict,
    page_range: Optional[str],
    language: str,
    include_images: bool,
    available_credentials: dict,
    pdf_bytes: bytes | None = None,
    display_name: str | None = None,
    page_offset: int = 0,
) -> ExtractionResult:
    """沿 backend_chain 逐档尝试，成功则返回。"""
    logger = get_logger("extractor")
    attempted: list[str] = []
    failed_atts: list[dict[str, str]] = []

    if not backend_chain:
        result = ExtractionResult()
        result.warnings.append("后端链为空")
        result.markdown = "# 错误\n\n后端链为空"
        return result

    for current_backend in backend_chain:
        attempted.append(current_backend)
        logger.info("尝试后端", source=_display_source(source), backend=current_backend)
        start_time = time.time()

        try:
            result = _extract_with_backend(
                source=source,
                output_dir=output_dir,
                backend=current_backend,
                settings=settings,
                page_range=page_range,
                language=language,
                include_images=include_images,
                available_credentials=available_credentials.get(current_backend, []),
                pdf_bytes=pdf_bytes,
                display_name=display_name,
                page_offset=page_offset,
            )
            duration = time.time() - start_time

            if _is_successful_result(result):
                logger.log_api_call(
                    api_name=current_backend,
                    success=True,
                    duration=duration,
                )
                _annotate_chain_result(
                    result, backend_chain, current_backend, failed_atts, settings
                )
                return result

            # 旧格式转换失败属于终止性错误，不应被包装成普通后端降级失败，
            # 否则转换错误码和原始格式信息会在链路收尾时丢失。
            if (result.metadata or {}).get("conversionStatus") == "failed":
                logger.log_api_call(
                    api_name=current_backend,
                    success=False,
                    duration=duration,
                    error=(result.warnings or ["旧格式转换失败"])[-1],
                )
                _annotate_chain_result(
                    result, backend_chain, None, failed_atts, settings
                )
                return result

            reason = result.markdown[:80] if result.markdown else "空结果"
            logger.warning(
                "后端返回空/错误结果", backend=current_backend, reason=reason
            )
            failed_atts.append({"backend": current_backend, "reason": reason})
            continue

        except Exception as e:
            duration = time.time() - start_time
            error_msg = _redact_runtime_secret(str(e), settings)
            logger.log_api_call(
                api_name=current_backend,
                success=False,
                duration=duration,
                error=error_msg,
            )
            logger.warning("后端异常", backend=current_backend, error=error_msg)
            failed_atts.append({"backend": current_backend, "reason": error_msg})
            continue

    # 所有档都失败
    result = ExtractionResult()
    if attempted:
        last = attempted[-1]
        result.warnings.append(f"所有后端都失败（最后档: {last}）")
        result.markdown = "# 错误\n\n所有提取后端都失败"
        for att in failed_atts:
            result.warnings.append(
                f"  {att['backend']}: {_redact_runtime_secret(att['reason'], settings)}"
            )
    else:
        result.warnings.append("后端链为空")
        result.markdown = "# 错误\n\n后端链为空"

    _annotate_chain_result(
        result,
        backend_chain,
        None,
        failed_atts,
        settings,
    )
    return result


def _display_source(source: str) -> str:
    """日志中只保留文件名，避免把完整本地路径写入日志。"""
    if source.startswith(("http://", "https://")):
        return "<remote-url>"
    return Path(source).name


def _redact_runtime_secret(text: str, settings: dict) -> str:
    """从通用降级错误中移除当前配置中的完整凭证。"""
    value = str(text or "")
    secrets = []
    for item in settings.get("paddleTokens") or []:
        if isinstance(item, str):
            secrets.append(item)
    for item in settings.get("mineruCredentials") or []:
        if isinstance(item, dict):
            secrets.extend([item.get("accessKey", ""), item.get("secretKey", "")])
        elif isinstance(item, str):
            secrets.append(item)
    local_key = settings.get("mineruLocalApiKey")
    if isinstance(local_key, str):
        secrets.append(local_key)
    for secret in secrets:
        if secret:
            value = value.replace(str(secret), "[REDACTED]")
    return value


def _is_successful_result(result: ExtractionResult):
    """后端产出是否看作"成功"——有非错误 markdown 或有图片。"""
    if result.markdown and not result.markdown.startswith("# 错误"):
        return True
    if result.images and len(result.images) > 0:
        return True
    return False


def _annotate_chain_result(
    result: ExtractionResult,
    backend_chain: list[str],
    used_backend: Optional[str],
    failed_atts: list[dict[str, str]],
    settings: dict,
) -> None:
    """在 result.metadata 里标出后端链实际走了几档、用哪档。降级原因合并到 warnings。"""
    result.metadata = result.metadata or {}
    result.metadata["backendChain"] = backend_chain
    result.metadata["usedBackend"] = used_backend
    result.metadata["usedBackendInChain"] = bool(
        used_backend and used_backend in backend_chain
    )
    # 降级原因合并到 warnings，统一警告输出。避免 fallbackReasons 与 warnings 重叠。
    for att in failed_atts:
        result.warnings.append(
            f"  {att['backend']}: {_redact_runtime_secret(att['reason'], settings)}"
        )


def _extract_with_backend(
    source: str,
    output_dir: Optional[str],
    backend: str,
    settings: dict,
    page_range: Optional[str],
    language: str,
    include_images: bool,
    available_credentials: list,
    pdf_bytes: bytes | None = None,
    display_name: str | None = None,
    page_offset: int = 0,
) -> ExtractionResult:
    """使用指定后端提取"""
    logger = get_logger("backend")

    if backend == "mineru":
        from mineru_client import MinerUClient
        client = MinerUClient(settings)
        return client.extract(
            source=source,
            output_dir=output_dir,
            page_range=page_range,
            language=language,
            include_images=include_images,
            credentials=available_credentials,
            pdf_bytes=pdf_bytes,
            display_name=display_name,
        )

    elif backend == "paddleocr":
        from paddle_client import PaddleClient
        client = PaddleClient(settings)
        return client.extract(
            source=source,
            output_dir=output_dir,
            page_range=page_range,
            language=language,
            include_images=include_images,
            keys=available_credentials,
            pdf_bytes=pdf_bytes,
            display_name=display_name,
        )

    elif backend == "mineru-local":
        from mineru_local_client import MinerULocalClient
        client = MinerULocalClient(settings)
        return client.extract(
            source=source,
            output_dir=output_dir,
            page_range=page_range,
            language=language,
            include_images=include_images,
            credentials=available_credentials,
            pdf_bytes=pdf_bytes,
            display_name=display_name,
        )

    elif backend == "paddleocr-local":
        from paddle_local_client import PaddleLocalClient
        client = PaddleLocalClient(settings)
        return client.extract(
            source=source,
            output_dir=output_dir,
            page_range=page_range,
            language=language,
            include_images=include_images,
            keys=available_credentials,
            pdf_bytes=pdf_bytes,
            display_name=display_name,
        )

    elif backend == "local":
        file_type = detect_file_type(source)
        extractor = get_extractor(file_type, settings)
        return extractor.extract(
            source=source,
            output_dir=output_dir,
            page_range=page_range,
            language=language,
            include_images=include_images,
            pdf_bytes=pdf_bytes,
            display_name=display_name,
            page_offset=page_offset,
            # Excel 统一行列上限：.xls、.xlsx、.xlsm 共用同一套配置。
            max_rows=settings.get("xlsxMaxRows"),
            max_cols=settings.get("xlsxMaxCols"),
        )

    else:
        raise ValueError(f"不支持的后端: {backend}")


# 媒体标签 / Markdown 图片 / base64 data URL 三类模式
_DATA_URL_IMG_MD_RE = _re.compile(r'!\[([^\]]*)\]\((data:[^)]+)\)')
_DATA_URL_IMG_HTML_RE = _re.compile(r'<img[^>]*\bsrc="(data:[^"]+)"[^>]*>', _re.IGNORECASE)
_ANY_IMG_MD_RE = _re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')
# <img ...> 整体匹配(为了判断是否要保留 / 抹除)
_ANY_IMG_HTML_RE = _re.compile(r'<img\b[^>]*>', _re.IGNORECASE)
_ANY_IMG_HTML_ALT_RE = _re.compile(r'\balt="([^"]*)"', _re.IGNORECASE)
# <video> / <audio> 整标签 — 不抹除,只动 base64 图片
_VIDEO_TAG_RE = _re.compile(r'<video\b[^>]*>.*?</video>|<video\b[^>]*/>', _re.IGNORECASE | _re.DOTALL)
_AUDIO_TAG_RE = _re.compile(r'<audio\b[^>]*>.*?</audio>|<audio\b[^>]*/>', _re.IGNORECASE | _re.DOTALL)


def _strip_data_url_images(markdown: str) -> str:
    """把 markdown 里 base64 (data URL) 图片标签替换成占位文本。不动 <video>/<audio>/非 base64 <img>。"""
    if not markdown:
        return markdown
    # 抹除 markdown 格式的 base64 图片: ![alt](data:...)
    markdown = _DATA_URL_IMG_MD_RE.sub(r'[图片]', markdown)
    # 抹除 HTML 格式的 base64 图片: <img src="data:...">
    markdown = _DATA_URL_IMG_HTML_RE.sub(r'', markdown)
    return _re.sub(r'\n{3,}', '\n\n', markdown)


def _strip_all_image_tags(markdown: str) -> str:
    """没保存图路径(output_dir 没设)时,抹所有 <img> 标签和 base64 markdown 图片。
    保留 <video>/<audio>(它们通常指向本地路径,留着有意义)。
    """
    if not markdown:
        return markdown
    markdown = _DATA_URL_IMG_MD_RE.sub(r'[图片]', markdown)
    markdown = _ANY_IMG_HTML_RE.sub('', markdown)
    return _re.sub(r'\n{3,}', '\n\n', markdown)


def _replace_markdown_media_reference(markdown: str, escaped_path: str, relative_path: str) -> str:
    """替换 Markdown 图片路径，同时保留可选 title，不让空格被解析成 title。"""
    pattern = rf'\]\(\s*{escaped_path}(?:\s+["\']([^"\']*)["\'])?\s*\)'
    return _re.sub(
        pattern,
        lambda match: f']({relative_path}'
        + (f' "{match.group(1)}"' if match.group(1) is not None else '')
        + ')',
        markdown,
    )


def _rewrite_media_paths(markdown: str, metadata: dict, stem: str) -> str:
    """将后端虚拟媒体路径改成统一输出目录下的相对路径。"""
    if not markdown:
        return markdown
    media_map = metadata.get("mediaMap") or metadata.get("imagePathMap") or {}
    if not media_map:
        return markdown

    for virtual_path, local_info in media_map.items():
        if isinstance(local_info, dict) and "local_path" in local_info:
            local_name = Path(local_info["local_path"]).name
        else:
            local_name = Path(str(local_info)).name
        rel = f"{stem}_media/{local_name}"
        rel_encoded = markdown_media_path(rel)
        vp_escaped = _re.escape(virtual_path)
        markdown = _re.sub(
            rf'src="{vp_escaped}"',
            f'src="{rel_encoded}"',
            markdown,
        )
        markdown = _replace_markdown_media_reference(markdown, vp_escaped, rel_encoded)
    return markdown


def format_result(result: ExtractionResult):
    """返回给 JS 端的 dict，结构与本地 JSON 的 metadata 对齐（顶层有 name/outputDir/markdown/metadata）。"""
    meta = result.metadata or {}

    # 鉴权失败账本：drain() 只在此处调一次 —— format_result 是所有结果路径
    # （单后端链、分块合并、split-only）的唯一出口，因而两边都覆盖。
    # 既进 compact_meta（Node 实际读这里），也回写 result.metadata。
    auth_failures = _drain_auth_failures()
    meta["authFailures"] = auth_failures

    # 没保存图路径（output_dir 没设）→ 抹所有 <img> 标签和 base64 markdown 图片。
    # video/audio 标签始终保留(它们 src 是本地路径,不会进 base64)。
    # 有保存路径 → 只 strip base64，<img src="本地路径"> 保留供 agent 看。
    raw_markdown = result.markdown or ""
    if not result.output_dir:
        cleaned_markdown = _strip_all_image_tags(raw_markdown)
    else:
        cleaned_markdown = _strip_data_url_images(raw_markdown)

    # 给 JS 端用的运行时结构。落盘 JSON 仍由 save_result 单独构造，保持原格式不变。
    # mediaDir / mdPath / jsonPath 只用于 Agent 获取实际输出路径。
    compact_meta = {
        "mediaPaths": list(result.images or []),
        "format": meta.get("format"),
        "reader": meta.get("reader"),
        "backendChain": meta.get("backendChain"),
        "usedBackend": meta.get("usedBackend"),
        "usedBackends": meta.get("usedBackends"),
        "originalFormat": meta.get("originalFormat"),
        "convertedFormat": meta.get("convertedFormat"),
        "conversionProvider": meta.get("conversionProvider"),
        "conversionStatus": meta.get("conversionStatus"),
        "conversionErrorCode": meta.get("conversionErrorCode"),
        "conversionWarnings": meta.get("conversionWarnings"),
        "conversionDurationMs": meta.get("conversionDurationMs"),
        "warnings": result.warnings,
        "usedBackendInChain": meta.get("usedBackendInChain"),
        "authFailures": auth_failures,
    }
    if meta.get("barcodeCodes"):
        compact_meta["barcodeCodes"] = meta["barcodeCodes"]
    if meta.get("barcodeOnlyDocument"):
        compact_meta["barcodeOnlyDocument"] = True
    if result.md_path:
        compact_meta["mdPath"] = result.md_path
    if result.images_dir:
        compact_meta["mediaDir"] = result.images_dir
    if meta.get("jsonPath"):
        compact_meta["jsonPath"] = meta["jsonPath"]

    return {
        "name": result.name,
        "outputDir": result.output_dir,
        "markdown": cleaned_markdown,
        "metadata": compact_meta,
    }


def main():
    parser = argparse.ArgumentParser(description="Doc Intake - 文档/图片内容提取")
    parser.add_argument("--source", required=True, help="文件路径或 URL")
    parser.add_argument("--output-dir", help="输出目录")
    parser.add_argument("--page-range", help="PDF 页码范围")
    parser.add_argument("--split-only", action="store_true", help="仅做图片分割，不调用后端")
    parser.add_argument("--defer-save", action="store_true", help="延迟保存，由 JS 聚合后统一落盘")
    parser.add_argument("--output-stem", help="统一输出文件 stem（用于分块结果）")
    parser.add_argument("--media-prefix", default="", help="媒体文件名前缀（用于分块结果去重）")

    args = parser.parse_args()

    # 整个主流程放在 context 内，避免 print 污染 JSON；输出 JSON 时退出 context 后 sys.stdout 已恢复
    with redirect_io_to_stderr():
        formatted = _run(args)

    sys.stdout.write(json.dumps(formatted, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def _iter_pdf_chunks_if_needed(args, settings: dict):
    """在内存中生成 PDF chunk；非 PDF 或未超阈值时返回 None。"""
    if detect_file_type(args.source) != "pdf":
        return None
    # 指定页码范围由 _run 在进入云端链前裁剪，不能把原始 PDF 直接上传。
    if args.page_range:
        return None
    if settings.get("autoSplitLargePDF", True) is False:
        return None
    pages_per_chunk = int(settings.get("splitChunkPages") or 180)
    if pages_per_chunk <= 0:
        return None

    total_pages = pdf_page_count(args.source)
    if total_pages <= pages_per_chunk:
        return None

    chunks = iter_pdf_memory_chunks(args.source, pages_per_chunk)
    first = next(chunks, None)
    if first is None:
        return None
    return (first, chunks)


def _run(args) -> dict:
    settings = load_settings(args)
    configure_logging(settings)

    start_time = time.time()
    backend = settings.get("defaultBackend", "auto")
    log.log_request(source=_display_source(args.source), backend=backend, output_dir="<configured>" if args.output_dir else None)

    # 凭证按后端分别存，避免 PaddleOCR 拿到 MinerU 的 dict 凭证
    available_credentials = {
        "paddleocr": settings.get("paddleTokens") or [],
        "mineru": settings.get("mineruCredentials") or [],
    }

    file_type = detect_file_type(args.source)
    output_dir = determine_output_dir(args, settings)

    # 仅做图片分割，不调用后端
    if args.split_only:
        from image_splitter import ImageSplitter
        from PIL import Image

        if not output_dir:
            output_dir = settings.get("savePath") or default_save_path()

        img = Image.open(args.source)
        # 用 with 包裹 — PIL 持有源图 file handle,Windows 不 close 会锁到 GC。
        try:
            splitter = ImageSplitter(
                enable_threshold=settings.get("splitImageThreshold") or 1.2,
                color_tolerance=settings.get("splitImageTolerance") or 15.0,
                blank_ratio=settings.get("splitImageBlankRatio") or 0.98,
                min_continuous_blank=settings.get("splitImageMinBlank") or 5,
            )
            chunks = splitter.split(img)

            split_dir = Path(output_dir) / f"{Path(args.source).name}_split"
            split_dir.mkdir(parents=True, exist_ok=True)

            saved = []
            for i, chunk in enumerate(chunks):
                path = split_dir / f"{Path(args.source).stem}_块{i+1:02d}{Path(args.source).suffix or '.png'}"
                chunk.save(str(path))
                saved.append(str(path))

            result = ExtractionResult()
            result.markdown = f"# 图片分割结果\n\n源文件: {args.source}\n"
            result.markdown += f"原图大小: {img.size[0]}x{img.size[1]} 像素\n"
            result.markdown += f"高宽比: {img.size[1]/img.size[0]:.2f}\n"
            result.markdown += f"拆分成 {len(chunks)} 块\n\n"
            if settings.get("splitImageMinBlank"):
                result.markdown += f"参数: 连续 {settings.get('splitImageMinBlank')} 行空白切一刀\n\n"
            for i, p in enumerate(saved):
                result.markdown += f"![块{i+1}]({markdown_media_path(p)})\n"
            result.images = saved
            result.metadata = {"format": "split_test"}
            result.output_dir = str(split_dir)
        finally:
            img.close()

        duration = time.time() - start_time
        log.log_response(markdown_length=len(result.markdown), image_count=len(result.images), duration=duration)

        return format_result(result)

    # 规模已超短路阈值的文件，先把完整扫码扔后台，和随后的提取重叠；
    # 短路注定不成立，就不再白跑一遍判定。
    barcode_future, barcode_pool, barcode_over_threshold = _prefetch_barcode_scan(
        args, settings, file_type, output_dir
    )

    # 只有码、没正文且不需要落盘：不碰 extractor、不调云端，直接给码内容。
    # 判定不短路时，那次扫描的结果照样接住，提取完补到正文末尾，不再重扫。
    probe_codes = None
    if not barcode_over_threshold:
        barcode_only, probe_codes = _barcode_only_result(args, settings, file_type, output_dir)
        if barcode_only is not None:
            return barcode_only

    backend_chain = select_backend_chain(file_type, backend, settings)
    include_images = settings.get("includeMedia", settings.get("includeImages", True))

    chunk_state = _iter_pdf_chunks_if_needed(args, settings)
    if chunk_state is None:
        result = extract_with_chain(
            source=args.source,
            file_type=file_type,
            output_dir=output_dir,
            backend_chain=backend_chain,
            settings=settings,
            page_range=args.page_range,
            language=settings.get("defaultLanguage", "zh"),
            include_images=include_images,
            available_credentials=available_credentials,
        )
    else:
        first_chunk, remaining_chunks = chunk_state
        result = _extract_memory_pdf_chunks(
            args=args,
            settings=settings,
            output_dir=output_dir,
            backend_chain=backend_chain,
            include_images=include_images,
            available_credentials=available_credentials,
            first_chunk=first_chunk,
            remaining_chunks=remaining_chunks,
        )

    prefetched_codes = _take_barcode_prefetch(barcode_future, barcode_pool) or probe_codes
    return _finalize_single_result(
        result, args, output_dir, settings, start_time, prefetched_codes
    )


def _finalize_single_result(
    result: ExtractionResult,
    args,
    output_dir: Optional[str],
    settings: dict,
    start_time: float,
    prefetched_codes: Optional[list] = None,
) -> dict:
    result.name = args.source
    if output_dir and result.markdown:
        try:
            save_result(result, args.source, output_dir, settings.get("saveJson", False), settings)
        except Exception as exc:
            result.warnings.append(f"保存失败: {exc}")
            result.metadata["saveStatus"] = "failed"
            result.output_dir = None
    else:
        result.output_dir = output_dir
        # 只有未落盘时才追加：落盘时码内容已经挂在图片下面，再来一节就是重复。
        if prefetched_codes:
            result.markdown = _append_barcode_section(result.markdown, prefetched_codes)
            result.metadata = result.metadata or {}
            result.metadata["barcodeCodes"] = prefetched_codes

    duration = time.time() - start_time
    log.log_response(
        markdown_length=len(result.markdown),
        image_count=len(result.images),
        duration=duration,
    )
    return format_result(result)


def _extract_memory_pdf_chunks(
    *,
    args,
    settings: dict,
    output_dir: Optional[str],
    backend_chain: list[str],
    include_images: bool,
    available_credentials: dict,
    first_chunk: PdfMemoryChunk,
    remaining_chunks: Iterable[PdfMemoryChunk],
) -> ExtractionResult:
    """顺序消费内存 chunk，按 chunk index 合并，不产生 chunk 文件。"""
    merged = ExtractionResult()
    markdown_parts: list[str] = []
    all_images: list[str] = []
    all_warnings: list[str] = []
    chunk_results: list[tuple[int, ExtractionResult]] = []
    source_name = Path(args.source).name
    stem = Path(args.source).stem
    settings["outputStem"] = stem

    try:
        for chunk in (chunk for chunk in [first_chunk] if chunk is not None):
            chunk_results.append((chunk.index, _extract_one_memory_chunk(
                chunk, args, settings, output_dir, backend_chain,
                include_images, available_credentials, source_name,
            )))
            del chunk
        for chunk in remaining_chunks:
            try:
                chunk_results.append((chunk.index, _extract_one_memory_chunk(
                    chunk, args, settings, output_dir, backend_chain,
                    include_images, available_credentials, source_name,
                )))
            finally:
                del chunk
    finally:
        settings.pop("outputStem", None)

    for index, result in sorted(chunk_results, key=lambda item: item[0]):
        if result.markdown:
            markdown_parts.append(result.markdown)
        all_images.extend(result.images or [])
        all_warnings.extend(result.warnings or [])

    merged.markdown = "\n\n---\n\n".join(markdown_parts)
    merged.images = all_images
    merged.warnings = all_warnings
    used_backends = {
        chunk_result.metadata.get("usedBackend")
        for _, chunk_result in chunk_results
        if chunk_result.metadata and chunk_result.metadata.get("usedBackend")
    }
    merged.metadata = {
        "format": "pdf",
        "reader": "chunked-memory",
        "chunkCount": len(chunk_results),
        "backendChain": backend_chain,
        "usedBackendInChain": bool(used_backends),
        "usedBackends": sorted(used_backends),
    }
    merged.output_dir = output_dir
    return merged


def _extract_one_memory_chunk(
    chunk: PdfMemoryChunk,
    args,
    settings: dict,
    output_dir: Optional[str],
    backend_chain: list[str],
    include_images: bool,
    available_credentials: dict,
    source_name: str,
) -> ExtractionResult:
    chunk_settings = dict(settings)
    chunk_settings["mediaPrefix"] = f"chunk_{chunk.index:03d}_"
    chunk_settings["isMemoryChunk"] = True
    result = extract_with_chain(
        source=args.source,
        file_type="pdf",
        output_dir=output_dir,
        backend_chain=backend_chain,
        settings=chunk_settings,
        page_range=None,
        language=settings.get("defaultLanguage", "zh"),
        include_images=include_images,
        available_credentials=available_credentials,
        pdf_bytes=chunk.data,
        display_name=source_name,
        page_offset=chunk.start_page - 1,
    )
    if output_dir:
        result.markdown = _rewrite_media_paths(
            result.markdown,
            result.metadata or {},
            chunk_settings["outputStem"],
        )
    return result


_BARCODE_MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff", ".gif"}
_BARCODE_MAX_IMAGES = 200
# 注释是额外挂在正文上的东西，不能把返回体撞大；超了按媒体顺序截断。
_BARCODE_ANNOTATION_BUDGET = 8 * 1024


def _fit_annotation_budget(markdown: str, per_media: dict, budget: int) -> dict:
    """按媒体顺序挑出能在预算内注完的那一批。

    逐张试算而不是预估字节数：预估算法得和 annotate_markdown 的内部分支平行演进，
    一旦对不上就会算出错误的截断点，而这种截断一年也碰不到一次。
    """
    base_bytes = len(markdown.encode("utf-8"))
    allowed: dict = {}
    used = 0
    for name, hits in per_media.items():
        trial = barcode_scan.annotate_markdown(markdown, {name: hits}, set())
        cost = len(trial.encode("utf-8")) - base_bytes
        if used + cost > budget:
            break
        used += cost
        allowed[name] = hits
    return allowed


def _inject_barcode_annotations(result: ExtractionResult, markdown: str, settings: Optional[dict]) -> str:
    """把已落盘媒体里的码内容注到 markdown 对应图片下面。

    必须在媒体路径重写之后调：那里才把云端的 `images/xxx.png` 改成
    `{stem}_media/xxx.png`，注释定位靠 basename，两边对不上就注不进去。
    """
    if not markdown:
        return markdown
    if not (settings or {}).get("barcodeScan", True):
        return markdown

    images = [
        path for path in (result.images or [])
        if Path(path).suffix.lower() in _BARCODE_MEDIA_SUFFIXES
    ]
    if not images:
        return markdown

    if not barcode_scan.is_available():
        result.warnings.append("未安装 zxing-cpp，二维码解析已跳过")
        return markdown

    try:
        # 宿主同时可能跑多个文件，核是被分掉的，并发度得按这个折算
        hint = int((settings or {}).get("maxConcurrentLocal", 8) or 8)
        return _annotate_media(result, markdown, images, hint)
    except Exception as exc:
        # 标注是附加信息，不能因为它让整份结果保存失败
        result.warnings.append(f"二维码解析失败: {exc}")
        return markdown


def _annotate_media(
    result: ExtractionResult, markdown: str, images: list[str], concurrent_hint: int = 8
) -> str:
    batch = images[:_BARCODE_MAX_IMAGES]
    skipped = len(images) - len(batch)
    if skipped > 0:
        result.warnings.append(f"还有 {skipped} 张图未扫描条码")

    scans = barcode_scan.scan_image_files(batch, concurrent_hint=concurrent_hint)
    per_media: dict[str, list] = {}
    for path, scan in zip(batch, scans):
        hits = scan.hits if scan is not None else []
        if hits:
            per_media[Path(path).name] = hits
    if not per_media:
        return markdown

    annotated = barcode_scan.annotate_markdown(markdown, per_media, set())
    if len(annotated.encode("utf-8")) - len(markdown.encode("utf-8")) > _BARCODE_ANNOTATION_BUDGET:
        allowed = _fit_annotation_budget(markdown, per_media, _BARCODE_ANNOTATION_BUDGET)
        annotated = barcode_scan.annotate_markdown(markdown, allowed, set())
        result.warnings.append("条码注释超过 8 KiB，已按媒体顺序截断")

    result.metadata = result.metadata or {}
    result.metadata["barcodeCodes"] = barcode_scan.dedupe(
        [hit for hits in per_media.values() for hit in hits]
    )
    return annotated


def save_result(result: ExtractionResult, source: str, output_dir: str, save_json: bool = False, settings: Optional[dict] = None):
    """保存提取结果到文件"""
    logger = get_logger("file_saver")

    # 对于 URL，使用简化的文件名
    if source.startswith(("http://", "https://")):
        # 从 URL 提取域名作为文件名
        from urllib.parse import urlparse
        parsed = urlparse(source)
        filename = parsed.netloc.replace(".", "_")
    else:
        # 使用完整文件名（包括扩展名）
        filename = Path(source).name

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    md_path = output_path / f"{filename}.md"
    json_path = output_path / f"{filename}.json"
    # 直接覆盖同名产物：提取本身可重复执行，超时重试、修完 bug 重跑都依赖这一点。
    # 写入走 atomic_write（临时文件 + os.replace），不会留下半截文件。

    # 只有全部写入并回读验证成功后，才把路径写入结果。
    stem = Path(filename).stem

    # 重写 markdown 里的虚拟路径(比如 MinerU 返回的 'images/xxx.png'、
    # PaddleOCR 的 'imgs/xxx.jpg') → 本地路径 '{stem}_media/xxx.ext'。
    final_markdown = result.markdown
    meta = result.metadata or {}
    media_map_for_rewrite = meta.get("mediaMap") or meta.get("imagePathMap")
    if media_map_for_rewrite:
        for virtual_path, local_info in media_map_for_rewrite.items():
            # 兼容旧 PaddleOCR dict{local}和新 dict{original: {local_path, kind}}
            if isinstance(local_info, dict) and "local_path" in local_info:
                local_name = Path(local_info["local_path"]).name
            else:
                local_name = Path(str(local_info)).name
            rel = f"{stem}_media/{local_name}"
            rel_encoded = markdown_media_path(rel)
            vp_escaped = _re.escape(virtual_path)
            final_markdown = _re.sub(rf'src="{vp_escaped}"', f'src="{rel_encoded}"', final_markdown)
            final_markdown = _replace_markdown_media_reference(
                final_markdown,
                vp_escaped,
                rel_encoded,
            )
        logger.debug("Markdown 媒体路径已重写",
                     rewritten_count=len(media_map_for_rewrite),
                     total=len(media_map_for_rewrite))

    temp_paths: list[Path] = []
    committed_paths: list[Path] = []
    try:
        # base64 图片最后抹除，防止一坨 base64 进 markdown 让人看 / agent 渲染。
        final_markdown = _strip_data_url_images(final_markdown)
        final_markdown = _inject_barcode_annotations(result, final_markdown, settings)
        md_bytes = final_markdown.encode("utf-8")
        # 运行时结果也必须使用保存后的 Markdown，避免 Agent 继续看到云端原始长文件名。
        result.markdown = final_markdown

        json_data = None
        json_bytes = None
        if save_json:
            json_media_paths = [
                f"{stem}_media/{Path(media_path).name}"
                for media_path in (result.images or [])
            ]
            json_data = {
                "content": final_markdown,
                "metadata": {
                    "mediaPaths": json_media_paths,
                    "format": meta.get("format"),
                    "reader": meta.get("reader"),
                    "backendChain": meta.get("backendChain"),
                    "usedBackend": meta.get("usedBackend"),
                    "usedBackends": meta.get("usedBackends"),
                    "warnings": result.warnings,
                    "usedBackendInChain": meta.get("usedBackendInChain"),
                    "barcodeCodes": (result.metadata or {}).get("barcodeCodes"),
                },
            }
            json_bytes = json.dumps(json_data, ensure_ascii=False, indent=2).encode("utf-8")

        def atomic_write(path: Path, data: bytes) -> None:
            fd, temp_name = tempfile.mkstemp(
                prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent)
            )
            temp_path = Path(temp_name)
            temp_paths.append(temp_path)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp_path, path)
                temp_paths.remove(temp_path)
                committed_paths.append(path)
            except Exception:
                try:
                    os.close(fd)
                except OSError:
                    pass
                raise

        atomic_write(md_path, md_bytes)
        if md_path.read_bytes() != md_bytes:
            raise OSError(f"写后校验失败: {md_path}")
        if json_bytes is not None:
            atomic_write(json_path, json_bytes)
            if json_path.read_bytes() != json_bytes:
                raise OSError(f"写后校验失败: {json_path}")

        result.md_path = str(md_path)
        if result.images:
            result.images_dir = str(output_path / f"{stem}_media")
        result.output_dir = str(output_path)
        result.metadata["saveStatus"] = "saved"
        result.metadata["mdPath"] = str(md_path)
        if json_bytes is not None:
            result.metadata["jsonPath"] = str(json_path)
        logger.log_file_operation(
            operation="保存",
            path=str(md_path),
            success=True,
            size=len(md_bytes),
        )
    except Exception as e:
        for temp_path in temp_paths + committed_paths:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
        result.md_path = None
        result.images_dir = None
        result.output_dir = None
        result.metadata["saveStatus"] = "failed"
        logger.log_file_operation(
            operation="保存",
            path=str(md_path),
            success=False,
        )
        logger.error(f"保存文件失败: {_redact_runtime_secret(str(e), {})}")
        raise OSError(f"保存结果失败: {e}") from e


if __name__ == "__main__":
    main()
