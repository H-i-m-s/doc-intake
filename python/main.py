"""doc-intake Python 主入口"""
from __future__ import annotations

import argparse
import json
import os
import re as _re
import sys
import tempfile
import time
from urllib.parse import quote as _url_quote
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional, Iterable

# 添加当前目录到 path
sys.path.insert(0, str(Path(__file__).parent))

# 使用绝对导入，避免相对导入问题
from extractors.base import BaseExtractor, ExtractionResult
from extractors import get_extractor
from logger import get_logger, log
from pdf_splitter import PdfMemoryChunk, iter_pdf_memory_chunks, pdf_page_count


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
        ".pptx": "pptx",
        ".ppt": "ppt",
        ".xlsx": "xlsx",
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
            settings_str = sys.stdin.read()
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


def determine_output_dir(args, settings) -> Optional[str]:
    """确定输出目录"""
    if args.output_dir:
        return args.output_dir
    
    if settings.get("autoSave", False):
        return settings.get("savePath")
    
    return None


def select_backend_chain(
    file_type: str,
    explicit_backend: str,
    settings: dict,
) -> list[str]:
    """根据文件类型从 settings 里读后端链。返回有序列表（首选 -> 兑底）。

    语义：
    - 用户显式给 backend：链上就是 [explicit_backend]
    - auto: 从 settings.pdfBackendChain / settings.imageBackendChain 读
    """
    logger = get_logger("backend_selector")

    if explicit_backend and explicit_backend != "auto":
        return [explicit_backend]

    if file_type == "pdf":
        chain = settings.get("pdfBackendChain") or ["local"]
    elif file_type == "image":
        chain = ["paddleocr"]
    elif file_type in ("docx", "pptx", "ppt", "xlsx", "xlsm", "html", "htm"):
        chain = ["local"]
    else:
        chain = ["local"]

    logger.debug("后端链选定", file_type=file_type, chain=chain)
    return chain


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
        rel_encoded = _url_quote(rel, safe="/:._-", encoding="utf-8")
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

    # 没保存图路径（output_dir 没设）→ 抹所有 <img> 标签和 base64 markdown 图片。
    # video/audio 标签始终保留(它们 src 是本地路径,不会进 base64)。
    # 有保存路径 → 只 strip base64，<img src="本地路径"> 保留供 agent 看。
    raw_markdown = result.markdown or ""
    if not result.output_dir:
        cleaned_markdown = _strip_all_image_tags(raw_markdown)
    else:
        cleaned_markdown = _strip_data_url_images(raw_markdown)

    # 给 JS 端用的结构。metadata 字段顺序与本地 JSON 对齐，多 mdPath/imagesDir 给批量模式用。
    # mediaPaths 与 result.images 对齐。JS 端按文件扩展名推断 kind。
    compact_meta = {
        "mediaPaths": list(result.images or []),
        "format": meta.get("format"),
        "reader": meta.get("reader"),
        "backendChain": meta.get("backendChain"),
        "warnings": result.warnings,
        "usedBackendInChain": meta.get("usedBackendInChain"),
    }
    if result.md_path:
        compact_meta["mdPath"] = result.md_path
    if result.images_dir:
        compact_meta["imagesDir"] = result.images_dir

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
        return []
    return (first, chunks)


def _run(args) -> dict:
    settings = load_settings(args)

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
            output_dir = settings.get("savePath")

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
                result.markdown += f"![块{i+1}]({p})\n"
            result.images = saved
            result.metadata = {"format": "split_test"}
            result.output_dir = str(split_dir)
        finally:
            img.close()

        duration = time.time() - start_time
        log.log_response(markdown_length=len(result.markdown), image_count=len(result.images), duration=duration)

        return format_result(result)

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
        return _finalize_single_result(result, args, output_dir, settings, start_time)

    first_chunk, remaining_chunks = chunk_state
    merged = _extract_memory_pdf_chunks(
        args=args,
        settings=settings,
        output_dir=output_dir,
        backend_chain=backend_chain,
        include_images=include_images,
        available_credentials=available_credentials,
        first_chunk=first_chunk,
        remaining_chunks=remaining_chunks,
    )
    return _finalize_single_result(merged, args, output_dir, settings, start_time)


def _finalize_single_result(
    result: ExtractionResult,
    args,
    output_dir: Optional[str],
    settings: dict,
    start_time: float,
) -> dict:
    result.name = args.source
    if output_dir and result.markdown:
        try:
            save_result(result, args.source, output_dir, settings.get("saveJson", False))
        except Exception as exc:
            result.warnings.append(f"保存失败: {exc}")
            result.metadata["saveStatus"] = "failed"
            result.output_dir = None
    else:
        result.output_dir = output_dir

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
    merged.metadata = {
        "format": "pdf",
        "reader": "chunked-memory",
        "chunkCount": len(chunk_results),
        "backendChain": backend_chain,
        "usedBackendInChain": True,
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


def save_result(result: ExtractionResult, source: str, output_dir: str, save_json: bool = False):
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
    if md_path.exists() or json_path.exists():
        result.metadata["saveStatus"] = "failed"
        raise FileExistsError(
            f"输出文件已存在，默认拒绝覆盖: {md_path}"
        )

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
            rel_encoded = _url_quote(rel, safe="/:._-", encoding="utf-8")
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
        md_bytes = final_markdown.encode("utf-8")

        json_data = None
        json_bytes = None
        if save_json:
            json_data = {
                "content": final_markdown,
                "metadata": {
                    "mediaPaths": list(result.images or []),
                    "format": meta.get("format"),
                    "reader": meta.get("reader"),
                    "backendChain": meta.get("backendChain"),
                    "warnings": result.warnings,
                    "usedBackendInChain": meta.get("usedBackendInChain"),
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