"""MinerU 云端 API 客户端封装（支持归一化和 JSON 保存）"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

# 添加当前目录到 path
sys.path.insert(0, str(Path(__file__).parent))

from extractors.base import ExtractionResult
from utils import normalize_images
from logger import get_logger
from key_pool import KeyPool


class MinerUClient:
    """MinerU API 客户端（支持多 credential KeyPool，失败后自动切换）"""

    def __init__(self, settings: dict):
        self.settings = settings
        self.credentials = settings.get("mineruCredentials", []) or []
        self.logger = get_logger("mineru")
        self._pool = KeyPool(
            self.credentials,
            logger_name="mineru",
            on_failure=self._log_key_failure if self.settings.get("notifyKeyFailure", True) else None,
        )

    def _log_key_failure(self, masked_key: str, available: int, total: int) -> None:
        self.logger.warning(
            "MinerU Key 失效已自动跳过",
            key=masked_key,
            available=f"{available}/{total}",
        )

    # ===== KeyPool 复用 =====

    def get_pool_stats(self) -> dict:
        return self._pool.stats()

    def mark_credential_failed(self, cred_or_token) -> bool:
        """标记某凭证为失败，后续跳过。"""
        return self._pool.mark_failed(cred_or_token)

    def _get_credential(self, credentials: Optional[list] = None) -> tuple[Optional[str], Optional[str]]:
        """获取下一个可用凭证（跳过已失败的）。返回 (access_key, secret_key）。

        若传 credentials，重置池为传入列表；不传则使用上次状态（持续遵循 mark_failed）。
        """
        if credentials is not None:
            self._pool.set_credentials(credentials)
        cred = self._pool.get_next()
        if cred is None:
            return None, None
        if isinstance(cred, dict):
            return cred.get("accessKey", ""), cred.get("secretKey", "")
        if isinstance(cred, str):
            return cred, None
        return None, None

    # ===== 提取（带多 cred 重试） =====

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        credentials: list | None = None,
        **kwargs,
    ) -> ExtractionResult:
        """使用 MinerU 提取 PDF 内容。多 credential 时，按 KeyPool 切换。"""
        start_time = time.time()

        try:
            from mineru import MinerU as _MinerU  # 收口到模块级 cache
        except ImportError:
            raise ImportError("请安装 mineru-open-sdk: pip install mineru-open-sdk")

        # 使用设置中的默认值
        model_version = self.settings.get("mineruModelVersion", "vlm")
        enable_ocr = self.settings.get("mineruEnableOCR", True)
        enable_formula = self.settings.get("mineruEnableFormula", True)
        enable_table = self.settings.get("mineruEnableTable", True)

        # MinerU API 语言代码映射（默认中文 -> ch，英文保持 en）
        _lang_map = {"zh": "ch", "zh-cn": "ch", "zh-hans": "ch", "chinese": "ch"}
        mineru_language = _lang_map.get((language or "").lower(), language or "ch")

        # KeyPool 重试循环
        creds = credentials if credentials is not None else self.credentials
        max_attempts = max(1, len(creds))
        last_error: Optional[Exception] = None

        for attempt in range(max_attempts):
            access_key, secret_key = self._get_credential(
                creds if attempt == 0 else None,
            )
            token = access_key if access_key else None

            # 没有凭证可以试了（被 mark 完）
            if not token and attempt > 0:
                break

            self.logger.info(
                "开始 MinerU 提取",
                source=source,
                output_dir=output_dir,
                mode="precision" if token else "flash",
                model=model_version,
                attempt=attempt + 1,
                max_attempts=max_attempts,
            )

            attempt_failed = False
            try:
                result = self._extract_once(
                    source=source,
                    token=token,
                    output_dir=output_dir,
                    model_version=model_version,
                    mineru_language=mineru_language,
                    enable_ocr=enable_ocr,
                    enable_formula=enable_formula,
                    enable_table=enable_table,
                    include_images=include_images,
                )
                duration = time.time() - start_time
                self.logger.log_api_call(
                    api_name="mineru", success=True, duration=duration,
                )
                return result

            except Exception as e:
                last_error = e
                error_msg = str(e).lower()

                # auth/quota 错误才切换 token；其它错误直接 throw（上层 chain 降级）
                if any(k in error_msg for k in ["auth", "token", "401", "403", "quota", "limit"]):
                    self.mark_credential_failed(token or "")
                    self.logger.warning(
                        f"MinerU Token 报错，准备切换",
                        key=self._pool._cred_key(token or "")[:8] + "..." if token else "",
                        error=str(e),
                    )
                    attempt_failed = True
                    continue
                else:
                    duration = time.time() - start_time
                    self.logger.log_api_call(
                        api_name="mineru", success=False, duration=duration, error=str(e),
                    )
                    raise

        # 跑完 max_attempts 都失败
        duration = time.time() - start_time
        err_msg = f"MinerU 所有 {max_attempts} 个 credential 失败: {last_error}"
        self.logger.log_api_call(
            api_name="mineru", success=False, duration=duration, error=err_msg,
        )
        raise MinerUAuthError(err_msg)

    def _extract_once(
        self,
        *,
        source: str,
        token: Optional[str],
        output_dir: Optional[str],
        model_version: str,
        mineru_language: str,
        enable_ocr: bool,
        enable_formula: bool,
        enable_table: bool,
        include_images: bool,
    ) -> ExtractionResult:
        """单次 MinerU SDK 调用（出错由上层 extract 捕获）"""
        from mineru import MinerU as _MinerU
        client = _MinerU(token) if token else _MinerU()

        try:
            if token:
                self.logger.debug("使用精准解析模式")
                extract_result = client.extract(
                    source,
                    model=model_version,
                    language=mineru_language,
                    ocr=enable_ocr,
                    formula=enable_formula,
                    table=enable_table,
                )
            else:
                self.logger.debug("使用轻量解析模式")
                extract_result = client.flash_extract(
                    source,
                    language=mineru_language,
                )

            result = ExtractionResult()
            result.markdown = extract_result.markdown or ""
            self.logger.debug("内容提取完成", markdown_length=len(result.markdown))

            raw_images = []
            if include_images and hasattr(extract_result, "images") and extract_result.images:
                raw_images = list(extract_result.images)
                self.logger.debug("收集图片", count=len(raw_images))

            stem = self.settings.get("outputStem") or Path(source).stem
            media_prefix = self.settings.get("mediaPrefix", "")
            normalized_images = normalize_images(
                raw_images, output_dir, stem, media_prefix=media_prefix
            )
            result.images = normalized_images

            # 构建虚拟路径 → 本地路径 映射，供 main.py 重写 markdown <img src>
            # MinerU SDK 返回的 Image.path 是 zip 内路径（如 "images/img_0.png"），
            # markdown 文本里 <img src="images/..."> 就是这种路径。重写为本地相对路径。
            image_path_map: dict[str, str] = {}
            for img, local_path in zip(raw_images, normalized_images):
                if hasattr(img, "path") and img.path:
                    vp = img.path
                    # 标准化成 'images/xxx.ext' （如果 path 没有 images/ 前缀）
                    if not vp.startswith("images/"):
                        vp = "images/" + Path(vp).name
                    image_path_map[vp] = local_path

            raw_json = {
                "markdown": result.markdown,
                "metadata": {
                    "format": "pdf",
                    "reader": "mineru",
                    "mode": "precision" if token else "flash",
                    "imagePathMap": image_path_map,
                },
            }
            result.metadata = raw_json["metadata"]
            # raw_json 不再单独写文件 ——
            #   main.py 的 save_result 会写完整 metadata JSON，这个内部统计无价值。

            return result

        finally:
            try:
                client.close()
            except Exception:
                # SDK close 失败不阻断主流程
                pass


class MinerUAuthError(Exception):
    """MinerU 认证 / 所有 credential 失效"""
    pass
