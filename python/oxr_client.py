"""SoMark（OXR）HTTP API 客户端封装（轻量级，不依赖 PyTorch）

结构照 paddle_client.py：KeyPool 轮询多把 Token、pageRange 本地预裁、
长图分割后逐个上传、结果里的图片统一落到 {stem}_media/。

与 PaddleOCR 的两处硬差异，都在这里收口：
1. SoMark 的错误一律 HTTP 200，成败只看 body 里的 code —— 判据是 code，不是 status_code。
2. 没有 language 入参，也没有「模型」选择：请求体只有文件、输出格式和两组开关。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional

import requests
from api_retry import request_with_retry, RetryExhausted

sys.path.insert(0, str(Path(__file__).parent))

from extractors.base import ExtractionResult
from image_splitter import ImageSplitter, merge_markdown_deduplicate
from utils import normalize_images
from logger import get_logger
from key_pool import KeyPool, _mask
from pdf_splitter import crop_pdf_to_page_range


def _redact_secret_text(text: str, secret: str | None = None) -> str:
    """从异常/日志文本中移除可能回显的完整 Token。"""
    value = str(text or "")
    if secret:
        value = value.replace(secret, "[REDACTED]")
    return value


# code 的三档分类。SoMark 的 message 是中文人话，直接带给上层就能看懂。
_AUTH_ERROR_CODES = frozenset({1107, 1108, 1123})
_RATE_LIMIT_ERROR_CODES = frozenset({1101, 1124})
_AUTH_CODE_REASONS = {
    1107: "Token 无效",
    1108: "账号没有有效订单",
    1123: "套餐剩余页数不足",
}

# Markdown 里的图片引用：`![alt](url "title")` 与 `<img src="...">`（单双引号都收）。
_MD_IMAGE_RE = re.compile(r'!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+["\'][^"\']*["\'])?\s*\)')
_HTML_IMAGE_SRC_RE = re.compile(
    r'<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|\'([^\']+)\')',
    re.IGNORECASE,
)


def _is_remote_url(value: str) -> bool:
    return str(value or "").startswith(("http://", "https://"))


def _basename_key(url: str) -> str:
    """取 URL 或相对路径的文件名，去掉查询串，小写比较。配对图片用。"""
    text = str(url or "").split("?", 1)[0].split("#", 1)[0]
    return Path(text).name.lower()


class OxrError(Exception):
    """SoMark 返回 code != 0 时抛出的通用错误，带上 code 便于上层分流。"""

    def __init__(self, message: str, code=None):
        super().__init__(message)
        self.code = code


class OxrAuthError(OxrError):
    """这一把 Token 不可用（无效 / 无订单 / 页数不足），应当换下一把。"""


class OxrRateLimitError(OxrError):
    """频率限制（1101 / 1124）：同一把 Token 退避后重试，不标记失效。"""


class OxrClient:
    """SoMark（OXR）HTTP API 客户端"""

    BASE_URL = "https://somark.cn/api/v1"
    SUBMIT_URL = f"{BASE_URL}/parse/async"
    CHECK_URL = f"{BASE_URL}/parse/async_check"

    POLL_INTERVAL = 3
    POLL_TIMEOUT = 600

    # markdown 给人看，json 用来取图片地址与页数，两个都要。
    OUTPUT_FORMATS = ["markdown", "json"]
    # 图片给 URL（本地再落盘）、公式给 LaTeX、表格给 HTML、行内公式给图片 —— 与其它后端的中立口径一致。
    ELEMENT_FORMATS = {"image": "url", "formula": "latex", "table": "html", "cs": "image"}
    # 三个可选的「增强识别」开关，全部显式关掉。
    #
    # 键名不是猜的：2026-11-21 用真实 Key 按这三个键提交过一次，服务端收下了并且
    # 解析正常（code=0）。不传它们时服务端默认也是 false，但默认值会随服务端变，
    # 显式写死才是「我们这一版的行为」；写错键名的后果是 1133 参数错误，所以只在
    # 实测过之后才写具体键名。
    FEATURE_CONFIG: dict = {
        "enable_text_cross_page": False,
        "enable_table_cross_page": False,
        "enable_title_level_recognition": False,
    }

    def __init__(self, settings: dict):
        self.settings = settings
        self.tokens = self._token_list(settings.get("oxrTokens"))
        self.max_concurrent = settings.get("maxConcurrent")
        self.logger = get_logger("oxr")
        self._pool = KeyPool(
            self.tokens,
            logger_name="oxr",
            provider="oxr",
            on_failure=self._log_key_failure if self.settings.get("notifyKeyFailure", True) else None,
        )

    @staticmethod
    def _token_list(value) -> List[str]:
        """oxrTokens 正常是列表；万一是字符串（老配置 / 手改配置文件）也拆开，别按字符轮询。"""
        if isinstance(value, str):
            return [part.strip() for part in re.split(r"[;\n]+", value) if part.strip()]
        if isinstance(value, (list, tuple)):
            return [str(item).strip() for item in value if str(item or "").strip()]
        return []

    def _log_key_failure(self, masked_key: str, available: int, total: int) -> None:
        self.logger.warning(
            "SoMark Key 失效已自动跳过",
            key=masked_key,
            available=f"{available}/{total}",
        )

    def _get_token(self, keys: Optional[List[str]] = None) -> Optional[str]:
        """获取下一个可用 Token（跳过已失败的）。传 keys 重置池，不传沿用 mark_failed 状态。"""
        if keys is not None:
            self._pool.set_credentials(keys)
        cred = self._pool.get_next()
        if isinstance(cred, str):
            return cred
        return None

    def mark_token_failed(self, token: str, reason: str = "") -> bool:
        """标记 Token 失败，后续不再使用。返回是否新增失败标记。"""
        return self._pool.mark_failed(token, reason)

    def reset_key_pool(self) -> None:
        """重置 Key 池（清除失败状态）。"""
        self._pool.reset()

    def get_pool_stats(self) -> dict:
        """查看 Key 池状态。"""
        return self._pool.stats()

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
        """提取入口。

        language 只为与 PaddleClient 的签名对齐而收下：SoMark 的解析请求里没有语言入参，
        识别语言由服务端自己判断，这个值不会进请求体。
        """
        result = ExtractionResult()
        start_time = time.time()
        retry_enabled = self.settings.get("keyRetryOnFailure", True)

        # pageRange 是云端边界：上传前先在本地裁剪，不能把原始 PDF 交给 API。
        if (
            pdf_bytes is None
            and page_range
            and Path(source).suffix.lower() == ".pdf"
            and not _is_remote_url(source)
        ):
            self.logger.debug("按 pageRange 在本地裁剪 PDF", page_range=page_range)
            pdf_bytes = crop_pdf_to_page_range(source, page_range)

        # 准备一次性创建的资源（图片分割等），不随 token retry 重做
        file_payloads: list[tuple[str | None, bytes | None, str]] = [
            (source, None, Path(source).name)
        ]
        is_split = False
        split_temp_dir: Optional[str] = None

        if pdf_bytes is not None:
            file_payloads = [
                (None, pdf_bytes, display_name or Path(source).name)
            ]
        if not _is_remote_url(source) and self._is_image(source):
            from PIL import Image
            # 用 with 包裹 — PIL 持有源图 file handle,Windows 不 close 会锁到 GC。
            with Image.open(source) as img:
                splitter = ImageSplitter(
                    enable_threshold=self.settings.get("splitImageThreshold"),
                    color_tolerance=self.settings.get("splitImageTolerance"),
                    blank_ratio=self.settings.get("splitImageBlankRatio"),
                    min_continuous_blank=self.settings.get("splitImageMinBlank"),
                )
                if splitter.need_split(img):
                    split_temp_dir = tempfile.mkdtemp(prefix="doc-intake-oxr-split-")
                    split_paths = splitter.split_and_save(source, split_temp_dir)
                    file_payloads = [
                        (path, None, Path(path).name) for path in split_paths
                    ]
                    is_split = len(file_payloads) > 1
                    self.logger.info("图片已分割", count=len(file_payloads))

        try:
            all_raw_images: list[dict] = []
            all_markdown: list[str] = []
            page_total = 0
            unresolved_images: list[str] = []
            last_error: Optional[Exception] = None
            last_token: Optional[str] = None

            # Key 轮询：失败一次换下一个 token，全部失败后才放弃
            key_list = keys if keys is not None else self.tokens
            max_attempts = max(1, len(key_list))
            for attempt in range(max_attempts):
                token = self._get_token(keys if attempt == 0 else None)
                if not token:
                    raise ValueError("SoMark（OXR）需要配置 API Key")
                last_token = token

                self.logger.info("开始 SoMark 提取",
                                 source=source,
                                 output_dir=output_dir,
                                 attempt=attempt + 1,
                                 max_attempts=max_attempts)

                attempt_failed = False
                all_markdown = []
                all_raw_images = []
                page_total = 0
                unresolved_images = []

                for i, (file_path, file_data, file_name) in enumerate(file_payloads):
                    self.logger.debug(f"处理文件 {i+1}/{len(file_payloads)}",
                                      file_path=file_path or file_name)

                    try:
                        page_result = self._process_single_file(
                            file_path,
                            token,
                            include_images,
                            file_bytes=file_data,
                            file_name=file_name,
                        )
                    except OxrAuthError as e:
                        # 这一把 Token 不可用：标记 + 换下一把，不把半截结果带下去。
                        last_error = e
                        self.mark_token_failed(token, reason=_AUTH_CODE_REASONS.get(e.code, "鉴权失败"))
                        self.logger.warning(
                            f"Token {_mask(token)} 报错，准备切换",
                            error=_redact_secret_text(str(e), token),
                        )
                        attempt_failed = True
                        break

                    all_markdown.append(page_result["markdown"])
                    all_raw_images.extend(page_result["images"])
                    page_total += int(page_result.get("page_num") or 0)
                    unresolved_images.extend(page_result.get("unresolved_images") or [])

                    self.logger.debug("文件处理完成",
                                      markdown_length=len(page_result["markdown"]),
                                      image_count=len(page_result["images"]))

                if not attempt_failed:
                    break
                if not retry_enabled:
                    break

            if not all_markdown and last_error is not None:
                if isinstance(last_error, OxrAuthError):
                    if last_token:
                        self._pool.record_auth_failure(last_token, "Token 失效或配额不足")
                    raise OxrAuthError(
                        f"SoMark Token 失效或配额不足: {_redact_secret_text(str(last_error), last_token)}",
                        last_error.code,
                    )
                raise last_error

            # 合并 Markdown（去重 100 字符）
            merged_markdown = merge_markdown_deduplicate(all_markdown) if all_markdown else "# 文档提取结果\n\n（无内容）"
        finally:
            if split_temp_dir:
                shutil.rmtree(split_temp_dir, ignore_errors=True)

        if unresolved_images:
            head = "、".join(unresolved_images[:5])
            more = f" 等 {len(unresolved_images)} 张" if len(unresolved_images) > 5 else ""
            result.warnings.append(
                f"SoMark 返回里这些图片没有可下载地址，未能本地化：{head}{more}。Markdown 里保留的是原始引用。"
            )

        # 归一化图片路径
        stem = self.settings.get("outputStem") or Path(source).stem
        media_prefix = self.settings.get("mediaPrefix", "")
        image_path_map: dict[str, str] = {}
        normalized_images = normalize_images(
            all_raw_images,
            output_dir,
            stem,
            cleanup_temps=is_split,
            media_prefix=media_prefix,
            path_map=image_path_map,
        )

        # 下载失败的那几张必须说出来：normalize_images 只写日志，不回报失败。
        missing = [
            entry["virtual_path"]
            for entry in all_raw_images
            if image_path_map.get(entry["virtual_path"]) is None
        ]
        if missing and output_dir:
            head = "、".join(missing[:5])
            more = f" 等 {len(missing)} 张" if len(missing) > 5 else ""
            result.warnings.append(
                f"SoMark 有图片没能落到本地：{head}{more}。Markdown 里这些位置还是远端地址。"
            )

        result.markdown = merged_markdown
        result.images = normalized_images
        result.metadata = {
            "format": "document",
            "reader": "oxr-http",
            "model": "SoMark",
            "pageNum": page_total or None,
            "split_count": len(file_payloads),
            "imagePathMap": image_path_map,
        }

        duration = time.time() - start_time
        self.logger.log_api_call(
            api_name="oxr",
            success=True,
            duration=duration
        )

        return result

    def _is_image(self, file_path: str) -> bool:
        # 与 PaddleClient 同一份清单：这里只决定「要不要先看长图分割」。
        # 不在清单里的格式（SoMark 同样支持的 jp2 / heic）会当作普通文件直接上传，不丢功能。
        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}
        return Path(file_path).suffix.lower() in image_extensions

    # ---------------------------------------------------------------- 单文件

    def _process_single_file(
        self,
        file_path: str | None,
        token: str,
        include_images: bool,
        file_bytes: bytes | None = None,
        file_name: str | None = None,
    ) -> dict:
        self.logger.debug("提交 SoMark 解析任务", file_path=file_path or file_name)
        start_time = time.time()

        task_id = self._call_with_rate_limit_retry(
            lambda: self._submit_task(token, file_path, file_bytes, file_name),
            token,
            "提交任务",
        )
        submit_duration = time.time() - start_time
        self.logger.debug("任务已提交", task_id=task_id, duration_ms=submit_duration * 1000)

        payload = self._poll_task(task_id, token)
        return self._parse_payload(payload, include_images, token)

    def _call_with_rate_limit_retry(self, fn, token: str, stage: str):
        """只对频率限制（1101 / 1124）退避重试，且重试同一把 Token。

        其它的 code 一律直接抛给上游：鉴权类换 Key，其余交给降级链换下一档。
        """
        max_retries = int(self.settings.get("maxRetries", 3) or 0)
        base_delay = max(1.0, float(self.settings.get("retryBaseDelayMs", 1000) or 1000) / 1000.0)

        for attempt in range(max_retries + 1):
            try:
                return fn()
            except OxrRateLimitError as e:
                if attempt >= max_retries:
                    raise
                wait_s = min(60.0, base_delay * (2 ** attempt))
                self.logger.warning(
                    "SoMark 频率限制，退避后重试同一把 Token",
                    stage=stage,
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    wait_s=round(wait_s, 1),
                    error=_redact_secret_text(str(e), token),
                )
                time.sleep(wait_s)

        raise OxrError(f"SoMark {stage}重试耗尽")

    def _decode(self, response, token: str, stage: str) -> dict:
        """解析回包并按 code 分流。判据只认 code —— SoMark 的错误也是 HTTP 200。"""
        try:
            body = response.json()
        except ValueError as e:
            raise OxrError(
                f"SoMark {stage}返回非 JSON（HTTP {response.status_code}）："
                f"{_redact_secret_text(str(getattr(response, 'text', '') or '')[:200], token)}"
            ) from e
        if not isinstance(body, dict):
            raise OxrError(f"SoMark {stage}返回结构异常（HTTP {response.status_code}）")

        code = body.get("code")
        if code in (0, "0"):
            return body

        message = _redact_secret_text(str(body.get("message") or "").strip() or "未知原因", token)
        text = f"SoMark {stage}失败（code={code}）：{message}"
        if code in _AUTH_ERROR_CODES:
            raise OxrAuthError(text, code)
        if code in _RATE_LIMIT_ERROR_CODES:
            raise OxrRateLimitError(text, code)
        raise OxrError(text, code)

    def _submit_task(
        self,
        token: str,
        file_path: str | None,
        file_bytes: bytes | None,
        file_name: str | None,
    ) -> str:
        form = {
            "api_key": token,
            "output_formats": list(self.OUTPUT_FORMATS),
            "element_formats": json.dumps(self.ELEMENT_FORMATS, ensure_ascii=False),
            "feature_config": json.dumps(self.FEATURE_CONFIG, ensure_ascii=False),
        }
        max_retries = self.settings.get("maxRetries", 3)
        base_delay_ms = self.settings.get("retryBaseDelayMs", 1000)

        try:
            if file_path and _is_remote_url(file_path):
                # 远端文件走 file_url，不下载到自己这边再上传。
                response = request_with_retry(
                    "POST", self.SUBMIT_URL,
                    data={**form, "file_url": file_path}, timeout=60,
                    max_retries=max_retries, base_delay_ms=base_delay_ms,
                    logger_name="oxr",
                )
            elif file_bytes is not None:
                files = {"file": (file_name or "document.pdf", file_bytes, "application/pdf")}
                response = request_with_retry(
                    "POST", self.SUBMIT_URL,
                    data=form, files=files, timeout=120,
                    max_retries=max_retries, base_delay_ms=base_delay_ms,
                    logger_name="oxr",
                )
            else:
                if not file_path or not os.path.exists(file_path):
                    raise FileNotFoundError(f"文件不存在: {file_path}")
                with open(file_path, "rb") as f:
                    files = {"file": (file_name or Path(file_path).name, f)}
                    response = request_with_retry(
                        "POST", self.SUBMIT_URL,
                        data=form, files=files, timeout=120,
                        max_retries=max_retries, base_delay_ms=base_delay_ms,
                        logger_name="oxr",
                    )
        except RetryExhausted as e:
            status = e.response.status_code if e.response else 0
            raise OxrError(
                f"SoMark 提交任务失败重试耗尽: HTTP {status}, error="
                f"{_redact_secret_text(str(e.cause or '网络'), token)}"
            ) from e

        body = self._decode(response, token, "提交任务")
        data = body.get("data") or {}
        task_id = str((data.get("task_id") if isinstance(data, dict) else "") or "").strip()
        if not task_id:
            raise OxrError("SoMark 提交任务成功但没返回 task_id")
        return task_id

    def _poll_task(self, task_id: str, token: str) -> dict:
        """每 3 秒问一次，上限 600 秒。返回 SUCCESS 时的 data。"""
        start_time = time.time()
        poll_count = 0

        while time.time() - start_time < self.POLL_TIMEOUT:
            # 解码必须在这个被重试的闭包里：频率限制是 code，不是 HTTP 状态，
            # 放在外面的话 1124 会直接冒出轮询、把整次提取打断，而不是退避重试。
            def _poll_once() -> dict:
                response = request_with_retry(
                    "POST", self.CHECK_URL,
                    data={"api_key": token, "task_id": task_id}, timeout=30,
                    max_retries=self.settings.get("maxRetries", 3),
                    base_delay_ms=self.settings.get("retryBaseDelayMs", 1000),
                    logger_name="oxr-poll",
                )
                return self._decode(response, token, "查询任务状态")

            try:
                body = self._call_with_rate_limit_retry(_poll_once, token, "查询任务状态")
            except RetryExhausted as e:
                status = e.response.status_code if e.response else 0
                raise OxrError(
                    f"SoMark 查询任务状态失败重试耗尽: HTTP {status}"
                ) from e

            data = body.get("data") or {}
            if not isinstance(data, dict):
                raise OxrError("SoMark 任务状态返回结构异常")
            state = str(data.get("status") or "").upper()
            poll_count += 1

            if poll_count % 10 == 0:  # 每 30 秒记录一次
                elapsed = time.time() - start_time
                self.logger.debug("轮询任务状态",
                                  task_id=task_id,
                                  status=state,
                                  elapsed_s=f"{elapsed:.1f}")

            if state == "SUCCESS":
                self.logger.debug("任务完成", task_id=task_id, elapsed_s=f"{time.time() - start_time:.1f}")
                return data
            if state == "FAILED":
                raise OxrError(f"SoMark 解析失败（task_id={task_id}）")

            time.sleep(self.POLL_INTERVAL)

        raise TimeoutError(f"SoMark 任务超时（{self.POLL_TIMEOUT}秒）")

    # ---------------------------------------------------------------- 结果

    def _parse_payload(self, data: dict, include_images: bool, token: str) -> dict:
        result = data.get("result") or {}
        outputs = result.get("outputs") or {}
        markdown = outputs.get("markdown") or ""
        if not isinstance(markdown, str):
            markdown = str(markdown)
        doc_json = outputs.get("json") or {}
        metadata = data.get("metadata") or {}
        page_num = metadata.get("page_num") if isinstance(metadata, dict) else None

        images: list[dict] = []
        unresolved: list[str] = []
        if include_images:
            images, unresolved = self._collect_images(markdown, doc_json)

        self.logger.debug("结果解析完成",
                          markdown_length=len(markdown),
                          image_count=len(images),
                          page_num=page_num)
        return {
            "markdown": markdown,
            "images": images,
            "page_num": page_num,
            "unresolved_images": unresolved,
        }

    def _collect_images(self, markdown: str, doc_json: dict) -> tuple[list[dict], list[str]]:
        """两路收图：json 里的 img_url + markdown 里的引用。

        条目形状与 PaddleClient 一致：{"url": 可下载地址, "virtual_path": markdown 里那个原样字符串}。
        virtual_path 是后续重写 Markdown 的键，所以一律逐字照抄 markdown 里的写法，
        不做 imgs/ 前缀之类的归一 —— 换掉任何一个字符，main.py 的重写就会落空。
        """
        block_urls: list[str] = []
        pages = doc_json.get("pages") if isinstance(doc_json, dict) else None
        for page in pages if isinstance(pages, list) else []:
            blocks = page.get("blocks") if isinstance(page, dict) else None
            for block in blocks if isinstance(blocks, list) else []:
                if not isinstance(block, dict):
                    continue
                url = block.get("img_url")
                if isinstance(url, str) and url.strip():
                    block_urls.append(url.strip())

        by_name: dict[str, str] = {}
        for url in block_urls:
            by_name.setdefault(_basename_key(url), url)

        entries: dict[str, dict] = {}
        unresolved: list[str] = []

        for ref in self._markdown_image_refs(markdown):
            if ref in entries:
                continue
            if _is_remote_url(ref):
                entries[ref] = {"url": ref, "virtual_path": ref}
                continue
            # 相对路径：用文件名去 json 的 img_url 里找同名的那个，找不到就没法本地化。
            hit = by_name.get(_basename_key(ref))
            if hit:
                entries[ref] = {"url": hit, "virtual_path": ref}
            else:
                unresolved.append(ref)

        # json 里有、markdown 里没引用的图也收：它们确实解析出来了，不该只留在远端。
        # 这种没有 markdown 原样引用，virtual_path 就用地址本身，重写时不会命中任何东西。
        # 已经通过引用收过的地址要跳过，否则同一张图会被下载两次。
        used_urls = {entry["url"] for entry in entries.values()}
        for url in block_urls:
            if url in used_urls:
                continue
            entries[url] = {"url": url, "virtual_path": url}
            used_urls.add(url)

        return list(entries.values()), unresolved

    @staticmethod
    def _markdown_image_refs(markdown: str) -> list[str]:
        refs: list[str] = []
        for match in _MD_IMAGE_RE.finditer(markdown or ""):
            refs.append(match.group(1))
        for match in _HTML_IMAGE_SRC_RE.finditer(markdown or ""):
            value = match.group(1) or match.group(2) or ""
            if value:
                refs.append(value)
        return [ref for ref in refs if ref and not ref.startswith("data:")]
