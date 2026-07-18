"""PaddleOCR HTTP API 客户端封装（轻量级，不依赖 PyTorch）"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import List, Optional
import tempfile
import shutil

import requests
from api_retry import request_with_retry, RetryExhausted

sys.path.insert(0, str(Path(__file__).parent))

from extractors.base import ExtractionResult
from image_splitter import ImageSplitter, merge_markdown_deduplicate
from utils import normalize_images
from logger import get_logger
from key_pool import KeyPool


class PaddleClient:
    """PaddleOCR HTTP API 客户端（不依赖 PyTorch）"""

    JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"

    def __init__(self, settings: dict):
        self.settings = settings
        self.tokens = settings.get("paddleTokens", [])
        self.max_concurrent = settings.get("maxConcurrent")
        self.logger = get_logger("paddleocr")
        self._pool = KeyPool(
            self.tokens,
            logger_name="paddleocr",
            on_failure=self._log_key_failure if self.settings.get("notifyKeyFailure", True) else None,
        )

    def _log_key_failure(self, masked_key: str, available: int, total: int) -> None:
        self.logger.warning(
            "PaddleOCR Key 失效已自动跳过",
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

    def mark_token_failed(self, token: str) -> bool:
        """标记 Token 失败，后续不再使用。返回是否新增失败标记。"""
        return self._pool.mark_failed(token)

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
        **kwargs,
    ) -> ExtractionResult:
        result = ExtractionResult()
        start_time = time.time()
        retry_enabled = self.settings.get("keyRetryOnFailure", True)

        # 准备一次性创建的资源（图片分割等），不随 token retry 重做
        files_to_process = [source]
        is_split = False
        # split_temp_dir 存在时无论结果如何都 rmtree（finally 清理），不让临时文件留在 output_dir
        split_temp_dir: Optional[str] = None

        # PDF 不做预处理了：PaddleOCR API 本身能接 PDF 直接 OCR。
        # 这一档只是 chain 上的降级档（Mineru 替代），过度设计已经被清掉。
        if not source.startswith("http") and self._is_image(source):
            from PIL import Image
            img = Image.open(source)
            splitter = ImageSplitter(
                enable_threshold=self.settings.get("splitImageThreshold"),
                color_tolerance=self.settings.get("splitImageTolerance"),
                blank_ratio=self.settings.get("splitImageBlankRatio"),
                min_continuous_blank=self.settings.get("splitImageMinBlank"),
            )
            if splitter.need_split(img):
                # 用系统 temp 目录而不是 output_dir，处理完自动清理
                split_temp_dir = tempfile.mkdtemp(prefix="doc-intake-paddle-split-")
                files_to_process = splitter.split_and_save(source, split_temp_dir)
                is_split = len(files_to_process) > 1
                self.logger.info("图片已分割", count=len(files_to_process))

        optional_params = self._build_optional_params()

        try:
            all_raw_images = []
            all_markdown = []
            raw_json = None
            last_error: Optional[Exception] = None

            # Key 轮询：失败一次换下一个 token，全部失败后才放弃
            max_attempts = max(1, len(keys if keys else self.tokens))
            for attempt in range(max_attempts):
                token = self._get_token(keys if attempt == 0 else None)
                if not token:
                    raise ValueError("PaddleOCR 需要配置 Access Token")

                self.logger.info("开始 PaddleOCR 提取",
                                 source=source,
                                 output_dir=output_dir,
                                 attempt=attempt + 1,
                                 max_attempts=max_attempts)

                attempt_failed = False
                for i, file_path in enumerate(files_to_process):
                    self.logger.debug(f"处理文件 {i+1}/{len(files_to_process)}",
                                      file_path=file_path)

                    try:
                        page_result = self._process_single_file(
                            file_path, token, optional_params, include_images
                        )
                        all_markdown.append(page_result["markdown"])
                        all_raw_images.extend(page_result["images"])
                        if i == 0:
                            raw_json = page_result.get("raw_json")

                        self.logger.debug("文件处理完成",
                                          markdown_length=len(page_result["markdown"]),
                                          image_count=len(page_result["images"]))

                    except Exception as e:
                        last_error = e
                        error_msg = str(e).lower()
                        # 认证/配额错误 → 标记当前 token 失败，换下一个
                        if any(k in error_msg for k in ["auth", "token", "401", "403", "quota", "limit"]):
                            self.mark_token_failed(token)
                            self.logger.warning(
                                f"Token {self._mask_key(token)} 报错，准备切换",
                                error=str(e),
                            )
                            attempt_failed = True
                            all_markdown = []
                            all_raw_images = []
                            break
                        # 其他错误（网络/解析）→ 不换 token，直接记录失败
                        err_text = f"文件 {file_path} 提取失败: {str(e)}"
                        self.logger.error(err_text)
                        all_markdown.append(f"# 提取失败\n\n{err_text}")

                if not attempt_failed:
                    break
                if not retry_enabled:
                    break

            if not all_markdown and last_error is not None:
                # 所有 token 都失败了。把最后一次错误按 token/其他分类抛出
                err_lower = str(last_error).lower()
                if any(k in err_lower for k in ["auth", "token", "401", "403", "quota", "limit"]):
                    raise PaddleAuthError(f"PaddleOCR Token 失效或配额不足: {last_error}")
                raise last_error

            # 合并 Markdown（去重 100 字符）
            merged_markdown = merge_markdown_deduplicate(all_markdown) if all_markdown else "# 文档提取结果\n\n（无内容）"
        finally:
            # split_temp_dir 是系统 temp 里的临时目录，处理完（或异常）一律 rmtree
            if split_temp_dir:
                shutil.rmtree(split_temp_dir, ignore_errors=True)

        # 归一化图片路径
        stem = Path(source).stem
        normalized_images = normalize_images(
            all_raw_images, output_dir, stem, cleanup_temps=is_split
        )

        # 构建虚拟路径 -> 本地路径 映射，供 main.py 重写 markdown <img src>
        image_path_map: dict[str, str] = {}
        for img_info, local_path in zip(all_raw_images, normalized_images):
            if isinstance(img_info, dict) and "virtual_path" in img_info:
                vp = img_info["virtual_path"]
                # 标准化成 'imgs/xxx.jpg' （可能不含 imgs/ 前缀）
                if not vp.startswith("imgs/"):
                    vp = "imgs/" + Path(vp).name
                image_path_map[vp] = local_path

        result.markdown = merged_markdown
        result.images = normalized_images
        result.metadata = {
            "format": "document",
            "reader": "paddleocr-http",
            "model": "PaddleOCR-VL-1.6",
            "split_count": len(files_to_process),
            "imagePathMap": image_path_map,
        }
        # raw_json ({"lines": N}) 不再单独写文件 ——
        #   main.py 的 save_result 会写完整 metadata JSON，这个内部统计无价值。

        duration = time.time() - start_time
        self.logger.log_api_call(
            api_name="paddleocr",
            success=True,
            duration=duration
        )

        return result

    def _is_image(self, file_path: str) -> bool:
        image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"}
        return Path(file_path).suffix.lower() in image_extensions

    def _build_optional_params(self) -> dict:
        """只推送开启的可选参数。None/False 都不发，避免 PaddleOCR API 对 null 字段歧义。"""
        flag_map = {
            "useDocOrientationClassify": "paddleUseDocOrientationClassify",
            "useDocUnwarping": "paddleUseDocUnwarping",
            "useChartRecognition": "paddleUseChartRecognition",
            "useSealRecognition": "paddleUseSealRecognition",
            "useTableRecognition": "paddleUseTableRecognition",
            "useFormulaRecognition": "paddleUseFormulaRecognition",
        }
        params = {}
        for param_key, settings_key in flag_map.items():
            if self.settings.get(settings_key):
                params[param_key] = True
        return params

    def _process_single_file(
        self,
        file_path: str,
        token: str,
        optional_params: dict,
        include_images: bool,
    ) -> dict:
        headers = {"Authorization": f"bearer {token}"}

        self.logger.debug("提交 OCR 任务", file_path=file_path)
        start_time = time.time()

        max_retries = self.settings.get("maxRetries", 3)
        base_delay_ms = self.settings.get("retryBaseDelayMs", 1000)

        # 提交任务
        try:
            if file_path.startswith("http"):
                headers["Content-Type"] = "application/json"
                payload = {
                    "fileUrl": file_path,
                    "model": "PaddleOCR-VL-1.6",
                    "optionalPayload": optional_params,
                }
                response = request_with_retry(
                    "POST", self.JOB_URL,
                    json=payload, headers=headers, timeout=30,
                    max_retries=max_retries, base_delay_ms=base_delay_ms,
                    logger_name="paddleocr",
                )
            else:
                if not os.path.exists(file_path):
                    raise FileNotFoundError(f"文件不存在: {file_path}")

                data = {
                    "model": "PaddleOCR-VL-1.6",
                    "optionalPayload": json.dumps(optional_params),
                }

                with open(file_path, "rb") as f:
                    files = {"file": f}
                    response = request_with_retry(
                        "POST", self.JOB_URL,
                        headers=headers, data=data, files=files, timeout=30,
                        max_retries=max_retries, base_delay_ms=base_delay_ms,
                        logger_name="paddleocr",
                    )
        except RetryExhausted as e:
            status = e.response.status_code if e.response else 0
            raise Exception(f"提交任务失败重试耗尽: HTTP {status}, error={e.cause or '网络'}") from e

        if response.status_code != 200:
            raise Exception(f"提交任务失败: {response.status_code} - {response.text}")

        job_id = response.json()["data"]["jobId"]
        submit_duration = time.time() - start_time
        self.logger.debug("任务已提交", job_id=job_id, duration_ms=submit_duration * 1000)

        # 轮询等待结果
        result_url = self._poll_job(job_id, token)

        # 下载并解析结果
        return self._download_and_parse_result(result_url, include_images)

    def _poll_job(self, job_id: str, token: str, timeout: int = 600) -> str:
        headers = {"Authorization": f"bearer {token}"}
        start_time = time.time()
        poll_count = 0

        while time.time() - start_time < timeout:
            try:
                response = request_with_retry(
                    "GET", f"{self.JOB_URL}/{job_id}",
                    headers=headers, timeout=30,
                    max_retries=self.settings.get("maxRetries", 3),
                    base_delay_ms=self.settings.get("retryBaseDelayMs", 1000),
                    logger_name="paddleocr-poll",
                )
            except RetryExhausted as e:
                status = e.response.status_code if e.response else 0
                raise Exception(f"查询任务状态失败重试耗尽: HTTP {status}") from e

            if response.status_code != 200:
                raise Exception(f"查询任务状态失败: {response.status_code}")

            data = response.json()["data"]
            state = data["state"]
            poll_count += 1

            if poll_count % 6 == 0:  # 每30秒记录一次
                elapsed = time.time() - start_time
                self.logger.debug("轮询任务状态", 
                                job_id=job_id, 
                                state=state, 
                                elapsed_s=f"{elapsed:.1f}")

            if state == "done":
                self.logger.debug("任务完成", job_id=job_id, elapsed_s=f"{time.time() - start_time:.1f}")
                return data.get("resultUrl", {}).get("jsonUrl")
            elif state == "failed":
                raise Exception(f"任务失败: {data.get('errorMsg', '未知错误')}")

            time.sleep(5)

        raise TimeoutError(f"任务超时（{timeout}秒）")

    def _download_and_parse_result(self, jsonl_url: str, include_images: bool) -> dict:
        self.logger.debug("下载结果", url=jsonl_url)
        start_time = time.time()

        try:
            jsonl_response = request_with_retry(
                "GET", jsonl_url, timeout=60,
                max_retries=self.settings.get("maxRetries", 3),
                base_delay_ms=self.settings.get("retryBaseDelayMs", 1000),
                logger_name="paddleocr-download",
            )
        except RetryExhausted as e:
            status = e.response.status_code if e.response else 0
            raise Exception(f"下载结果重试耗尽: HTTP {status}, error={e.cause or '网络'}") from e

        jsonl_response.raise_for_status()

        lines = jsonl_response.text.strip().split("\n")
        all_markdown = []
        all_images = []

        for line_num, line in enumerate(lines, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                result_data = json.loads(line)["result"]
            except (json.JSONDecodeError, KeyError):
                continue

            for page_result in result_data.get("layoutParsingResults", []):
                markdown_text = page_result.get("markdown", {}).get("text", "")
                if markdown_text:
                    all_markdown.append(markdown_text)

                if include_images:
                    # 只保留 markdown.images（实际被 markdown 文本引用的图）。
                    # outputImages 是整页 layout_det_res 标注图，不是真图，过滤掉。
                    # markdown.images 里 key 是虚拟路径 imgs/xxx.jpg，value 是真实 URL。
                    # 需要全部保留以便 main.py 重写 <img src>。
                    md_images = page_result.get("markdown", {}).get("images", {})
                    for virtual_path, real_url in md_images.items():
                        all_images.append({"url": real_url, "virtual_path": virtual_path})

        download_duration = time.time() - start_time
        self.logger.debug("结果解析完成", 
                         lines_count=len(lines),
                         markdown_count=len(all_markdown),
                         image_count=len(all_images),
                         duration_ms=download_duration * 1000)

        return {
            "markdown": "\n\n".join(all_markdown) if all_markdown else "",
            "images": all_images,
            "raw_json": {"lines": len(lines)},
        }


class PaddleAuthError(Exception):
    pass