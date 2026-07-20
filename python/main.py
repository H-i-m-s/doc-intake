"""doc-intake Python 主入口"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

# 添加当前目录到 path
sys.path.insert(0, str(Path(__file__).parent))

# 使用绝对导入，避免相对导入问题
from extractors.base import BaseExtractor, ExtractionResult
from extractors import get_extractor
from logger import get_logger, log


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
    """从 DOC_INTAKE_SETTINGS 环境变量加载配置"""
    settings_str = os.environ.get("DOC_INTAKE_SETTINGS")
    if settings_str:
        try:
            return json.loads(settings_str)
        except json.JSONDecodeError:
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
        chain = settings.get("pdfBackendChain") or ["mineru", "paddleocr", "local"]
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
        logger.info("尝试后端", source=source, backend=current_backend)
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
            )
            duration = time.time() - start_time

            if _is_successful_result(result):
                logger.log_api_call(
                    api_name=current_backend,
                    success=True,
                    duration=duration,
                )
                _annotate_chain_result(result, backend_chain, current_backend, failed_atts)
                return result

            reason = result.markdown[:80] if result.markdown else "空结果"
            logger.warning(
                "后端返回空/错误结果", backend=current_backend, reason=reason
            )
            failed_atts.append({"backend": current_backend, "reason": reason})
            continue

        except Exception as e:
            duration = time.time() - start_time
            error_msg = str(e)
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
            result.warnings.append(f"  {att['backend']}: {att['reason']}")
    else:
        result.warnings.append("后端链为空")
        result.markdown = "# 错误\n\n后端链为空"

    _annotate_chain_result(result, backend_chain, attempted[-1] if attempted else None, failed_atts)
    return result


def _is_successful_result(result: ExtractionResult) -> bool:
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
) -> None:
    """在 result.metadata 里标出后端链实际走了几档、用哪档。降级原因合并到 warnings。"""
    result.metadata = result.metadata or {}
    result.metadata["backendChain"] = backend_chain
    result.metadata["usedBackendInChain"] = (
        used_backend in backend_chain if used_backend else False
    )
    # 降级原因合并到 warnings，统一警告输出。避免 fallbackReasons 与 warnings 重叠。
    for att in failed_atts:
        result.warnings.append(f"  {att['backend']}: {att['reason']}")


def _extract_with_backend(
    source: str,
    output_dir: Optional[str],
    backend: str,
    settings: dict,
    page_range: Optional[str],
    language: str,
    include_images: bool,
    available_credentials: list,
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
        )

    else:
        raise ValueError(f"不支持的后端: {backend}")


def _flatten_media_paths(media_paths) -> list[str]:
    """把 mediaPathMap (dict 或 list) 拍平成完整路径字符串数组。key (虚拟路径) 丢掉，只留 value。"""
    if not media_paths:
        return []
    if isinstance(media_paths, dict):
        return list(media_paths.values())
    if isinstance(media_paths, list):
        return list(media_paths)
    return []


# 媒体标签 / Markdown 图片 / base64 data URL 三类模式
_DATA_URL_IMG_MD_RE = __import__("re").compile(r'!\[([^\]]*)\]\((data:[^)]+)\)')
_DATA_URL_IMG_HTML_RE = __import__("re").compile(r'<img[^>]*\bsrc="(data:[^"]+)"[^>]*>', __import__("re").IGNORECASE)
_ANY_IMG_MD_RE = __import__("re").compile(r'!\[([^\]]*)\]\(([^)]+)\)')
# <img ...> 整体匹配(为了判断是否要保留 / 抹除)
_ANY_IMG_HTML_RE = __import__("re").compile(r'<img\b[^>]*>', __import__("re").IGNORECASE)
_ANY_IMG_HTML_ALT_RE = __import__("re").compile(r'\balt="([^"]*)"', __import__("re").IGNORECASE)
# <video> / <audio> 整标签 — 不抹除,只动 base64 图片
_VIDEO_TAG_RE = __import__("re").compile(r'<video\b[^>]*>.*?</video>|<video\b[^>]*/>', __import__("re").IGNORECASE | __import__("re").DOTALL)
_AUDIO_TAG_RE = __import__("re").compile(r'<audio\b[^>]*>.*?</audio>|<audio\b[^>]*/>', __import__("re").IGNORECASE | __import__("re").DOTALL)


def _strip_data_url_images(markdown: str) -> str:
    """把 markdown 里 base64 (data URL) 图片标签替换成占位文本。不动 <video>/<audio>/非 base64 <img>。"""
    if not markdown:
        return markdown
    # 抹除 markdown 格式的 base64 图片: ![alt](data:...)
    markdown = _DATA_URL_IMG_MD_RE.sub(r'[图片]', markdown)
    # 抹除 HTML 格式的 base64 图片: <img src="data:...">
    markdown = _DATA_URL_IMG_HTML_RE.sub(r'', markdown)
    return __import__("re").sub(r'\n{3,}', '\n\n', markdown)


def _strip_all_image_tags(markdown: str) -> str:
    """没保存图路径(output_dir 没设)时,抹所有 <img> 标签和 base64 markdown 图片。
    保留 <video>/<audio>(它们通常指向本地路径,留着有意义)。
    """
    if not markdown:
        return markdown
    markdown = _DATA_URL_IMG_MD_RE.sub(r'[图片]', markdown)
    markdown = _ANY_IMG_HTML_RE.sub('', markdown)
    return __import__("re").sub(r'\n{3,}', '\n\n', markdown)


def _replace_image_placeholders(markdown: str, predicate) -> str:
    """(保留旧 API 用于 batch output 警告文案场景)按出现顺序替换 <img> / ![](url) 为占位文本。"""
    if not markdown or "<img" not in markdown and "![" not in markdown:
        return markdown
    md_iter = _ANY_IMG_MD_RE.finditer(markdown)
    html_iter = _ANY_IMG_HTML_RE.finditer(markdown)
    pending = []
    for m in md_iter:
        if predicate(m.group(0)):
            pending.append((m.start(), m.end(), m.group(1) or ""))
    for m in html_iter:
        if predicate(m.group(0)):
            alt_match = _ANY_IMG_HTML_ALT_RE.search(m.group(0))
            alt = alt_match.group(1) if alt_match else ""
            pending.append((m.start(), m.end(), alt))
    if not pending:
        return markdown
    pending.sort(key=lambda x: x[0])
    counter = [0]
    seen_alts: dict[str, int] = {}
    def _new_counter() -> int:
        counter[0] += 1
        return counter[0]
    def _placeholder_for(alt: str) -> str:
        alt = (alt or "").strip()
        if alt and alt in seen_alts:
            return f"[图片 {seen_alts[alt]}]"
        n = _new_counter()
        if alt:
            seen_alts[alt] = n
            return f"[图片 {n}: {alt}]"
        return f"[图片 {n}]"
    replacements = [(s, e, _placeholder_for(alt)) for s, e, alt in pending]
    pieces = []
    cursor = len(markdown)
    for start, end, placeholder in reversed(replacements):
        pieces.append(placeholder)
        pieces.append(markdown[end:cursor])
        cursor = start
    pieces.append(markdown[:cursor])
    pieces.reverse()
    return __import__("re").sub(r'\n{3,}', '\n\n', "".join(pieces))


def format_result(result: ExtractionResult) -> dict:
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
    # mediaPaths / mediaKinds 与 result.images / result.media_kinds 对齐。
    compact_meta = {
        "mediaPaths": list(result.images or []),
        "mediaKinds": list(result.media_kinds or []),
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

    args = parser.parse_args()

    # 整个主流程放在 context 内，避免 print 污染 JSON；输出 JSON 时退出 context 后 sys.stdout 已恢复
    with redirect_io_to_stderr():
        formatted = _run(args)

    sys.stdout.write(json.dumps(formatted, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")


def _run(args) -> dict:
    settings = load_settings(args)

    start_time = time.time()
    backend = settings.get("defaultBackend", "auto")
    log.log_request(source=args.source, backend=backend, output_dir=args.output_dir)

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

        duration = time.time() - start_time
        log.log_response(markdown_length=len(result.markdown), image_count=len(result.images), duration=duration)

        return format_result(result)

    backend_chain = select_backend_chain(file_type, backend, settings)

    result = extract_with_chain(
        source=args.source,
        file_type=file_type,
        output_dir=output_dir,
        backend_chain=backend_chain,
        settings=settings,
        page_range=args.page_range,
        language=settings.get("defaultLanguage", "zh"),
        include_images=settings.get("includeImages", False),
        available_credentials=available_credentials,
    )

    if output_dir and result.markdown:
        result.name = args.source
        save_result(result, args.source, output_dir, settings.get("saveJson", False))

    duration = time.time() - start_time
    log.log_response(
        markdown_length=len(result.markdown),
        image_count=len(result.images),
        duration=duration
    )

    return format_result(result)


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

    # 顶部设 result.md_path / result.images_dir。JSON 写入会读 result.md_path（批量模式 metadata 需要）。
    # images_dir 字段名仅为向后兼容 — 实际指向 {stem}_media 目录。
    stem = Path(filename).stem
    result.md_path = str(md_path)
    if result.images:
        result.images_dir = str(output_path / f"{stem}_media")

    # 重写 markdown 里的虚拟路径(比如 MinerU 返回的 'images/xxx.png'、
    # PaddleOCR 的 'imgs/xxx.jpg') → 本地路径 '{stem}_media/xxx.ext'。
    final_markdown = result.markdown
    meta = result.metadata or {}
    media_map_for_rewrite = meta.get("mediaMap") or meta.get("imagePathMap")
    if media_map_for_rewrite:
        import re as _re
        for virtual_path, local_info in media_map_for_rewrite.items():
            # 兼容旧 PaddleOCR dict{local}和新 dict{original: {local_path, kind}}
            if isinstance(local_info, dict) and "local_path" in local_info:
                local_name = Path(local_info["local_path"]).name
            else:
                local_name = Path(str(local_info)).name
            rel = f"{stem}_media/{local_name}"
            vp_escaped = _re.escape(virtual_path)
            final_markdown = _re.sub(rf'src="{vp_escaped}"', f'src="{rel}"', final_markdown)
            final_markdown = _re.sub(
                rf'\]\({vp_escaped}(\s+[^)]*)?\)',
                f']({rel}\\1)',
                final_markdown,
            )
        logger.debug("Markdown 媒体路径已重写",
                     rewritten_count=len(media_map_for_rewrite),
                     total=len(media_map_for_rewrite))

    try:
        # base64 图片最后抹除，防止一坨 base64 进 markdown 让人看 / agent 渲染。
        final_markdown = _strip_data_url_images(final_markdown)

        # 保存 Markdown
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(final_markdown)

        logger.log_file_operation(
            operation="保存",
            path=str(md_path),
            success=True,
            size=len(final_markdown.encode('utf-8'))
        )

        # 保存 JSON（如果启用了 saveJson）
        if save_json:
            json_data = {
                "content": final_markdown,
                "metadata": {
                    "mediaPaths": list(result.images or []),
                    "mediaKinds": list(result.media_kinds or []),
                    "format": meta.get("format"),
                    "reader": meta.get("reader"),
                    "backendChain": meta.get("backendChain"),
                    "warnings": result.warnings,
                    "usedBackendInChain": meta.get("usedBackendInChain"),
                },
            }
            with open(json_path, "w", encoding="utf-8") as f:
                import json
                json.dump(json_data, f, ensure_ascii=False, indent=2)

            logger.log_file_operation(
                operation="保存",
                path=str(json_path),
                success=True,
                size=len(json.dumps(json_data, ensure_ascii=False).encode('utf-8'))
            )
    except Exception as e:
        logger.log_file_operation(
            operation="保存",
            path=str(md_path),
            success=False
        )
        logger.error(f"保存文件失败: {e}")

    result.output_dir = str(output_path)


if __name__ == "__main__":
    main()