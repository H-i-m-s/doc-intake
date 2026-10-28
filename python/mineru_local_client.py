"""MinerU 自建服务客户端：新版 V1 API 与旧版 /file_parse 两套协议。

链上取代的是 MinerUClient 的位置：签名一致，配置来源换成 mineruLocalEndpoint / mineruLocalApiKey / mineruLocalTier。
协议先探测 /v1/health，404 判为旧版 magic-pdf 风格的 /file_parse。
"""
from __future__ import annotations

import base64
import binascii
import io
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Optional

import requests

sys.path.insert(0, str(Path(__file__).parent))

from extractors.base import ExtractionResult
from logger import get_logger
from utils import normalize_images

# 探测结果按 endpoint 缓存：同一进程里连续解析多个文件不该每次都打一遍 /v1/health。
_PROTOCOL_CACHE: dict[str, str] = {}
_PROTOCOL_LOCK = threading.Lock()

_PROBE_TIMEOUT = 10
# /v1/file_parse 的 wait_timeout：服务端同步等这么久还跑不完就转 202 让客户端轮询。
_SYNC_WAIT_SECONDS = 300
_TASK_TIMEOUT_SECONDS = 1800
_POLL_INTERVAL_SECONDS = 3
_SUBMIT_TIMEOUT = (_PROBE_TIMEOUT, _SYNC_WAIT_SECONDS + 120)
_DOWNLOAD_TIMEOUT = (30, 300)

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tif", ".tiff"}

# 新版服务按文件名推断输入类型；调用方给的显示名可能没有后缀。
_MIME_BY_SUFFIX = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
}

# 旧版后端名：magic-pdf 的 pipeline 通道兼容性最好，vlm 需要服务端另配引擎。
_LEGACY_BACKEND = "pipeline"

_LEGACY_LANG_MAP = {"zh": "ch", "zh-cn": "ch", "zh-hans": "ch", "chinese": "ch"}


def _mime_of(name: str) -> str:
    return _MIME_BY_SUFFIX.get(Path(name).suffix.lower(), "application/octet-stream")


def _snippet(response: requests.Response, limit: int = 300) -> str:
    """错误信息只留一小段响应体：本地服务报错时常把整页 HTML 打回来。"""
    try:
        text = response.text
    except Exception:
        return "<无法读取响应体>"
    text = " ".join(str(text or "").split())
    return text[:limit] + ("…" if len(text) > limit else "")


def _source_key(raw: Any) -> str:
    """与 utils.normalize_images 里的 path_map 键保持一致。"""
    if isinstance(raw, dict):
        return str(raw.get("virtual_path") or raw.get("url") or "")
    return str(raw)


def _decode_base64(value: Any) -> Optional[bytes]:
    """接 base64 或 data URL；解不出来返回 None。"""
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.startswith("data:"):
        head, _, payload = text.partition(",")
        if "base64" not in head:
            return None
        text = payload
    text = "".join(text.split())
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        return None


def _crop_pdf_bytes(data: bytes, page_range: str) -> bytes:
    """旧版协议没有页范围参数，只能在本地先裁出目标页。"""
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


def _find_markdown(root: Path) -> Optional[Path]:
    """MinerU 产物 zip 里正文固定叫 full.md，其它构建版本也可能只有单个 .md。"""
    candidates = sorted(root.rglob("*.md"))
    if not candidates:
        return None
    for candidate in candidates:
        if candidate.name.lower() == "full.md":
            return candidate
    # 取层级最浅的那个，避免先撞上 examples/ 之类的附带文件。
    return min(candidates, key=lambda path: (len(path.relative_to(root).parts), str(path)))


def _looks_like_artifacts(payload: dict) -> bool:
    for key in ("markdown", "md_content", "md", "images"):
        if key in payload:
            return True
    return False


def _first_result_entry(payload: Any) -> dict:
    """旧版 /file_parse 把结果按文件名分组：{"results": {"a.pdf": {...}}}。"""
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                return item
        raise RuntimeError("MinerU 旧版协议返回了空结果列表")
    if not isinstance(payload, dict):
        raise RuntimeError(f"MinerU 旧版协议返回了无法识别的类型: {type(payload).__name__}")
    results = payload.get("results")
    if isinstance(results, dict) and results:
        for value in results.values():
            if isinstance(value, dict):
                return value
    if isinstance(results, list) and results:
        for value in results:
            if isinstance(value, dict):
                return value
    return payload


class MinerULocalClient:
    """自建 MinerU 服务客户端。"""

    def __init__(self, settings: dict):
        self.settings = settings
        self.endpoint = str(settings.get("mineruLocalEndpoint") or "").strip().rstrip("/")
        self.api_key = str(settings.get("mineruLocalApiKey") or "").strip()
        self.tier = str(settings.get("mineruLocalTier") or "").strip()
        self.logger = get_logger("mineru-local")
        if not self.endpoint:
            raise ValueError(
                "mineru-local 后端需要先填写「MinerU 本地服务地址」(mineruLocalEndpoint)"
            )

    # ===== 协议探测 =====

    def _headers(self) -> dict:
        headers = {"Accept": "application/json, application/zip, */*"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _detect_protocol(self) -> str:
        """返回 "v1" 或 "legacy"，同一 endpoint 只探一次。"""
        cached = _PROTOCOL_CACHE.get(self.endpoint)
        if cached:
            return cached

        with _PROTOCOL_LOCK:
            cached = _PROTOCOL_CACHE.get(self.endpoint)
            if cached:
                return cached

            url = f"{self.endpoint}/v1/health"
            try:
                response = requests.get(url, headers=self._headers(), timeout=_PROBE_TIMEOUT)
            except requests.RequestException as e:
                raise ConnectionError(
                    f"MinerU 本地服务不可达: {self.endpoint} ({e})"
                ) from e

            if response.status_code == 200:
                protocol = "v1"
            elif response.status_code == 404:
                protocol = "legacy"
            elif response.status_code in (401, 403):
                raise PermissionError(
                    f"MinerU 本地服务拒绝访问: HTTP {response.status_code}，检查 mineruLocalApiKey 是否与服务端 --api-key 一致"
                )
            else:
                raise RuntimeError(
                    f"MinerU 本地服务健康探测失败: HTTP {response.status_code} {_snippet(response)}"
                )

            _PROTOCOL_CACHE[self.endpoint] = protocol
            self.logger.info("MinerU 本地协议已确定", endpoint=self.endpoint, protocol=protocol)
            return protocol

    # ===== 入口 =====

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        credentials: list | None = None,
        pdf_bytes: bytes | None = None,
        display_name: str | None = None,
        **kwargs,
    ) -> ExtractionResult:
        # credentials 只为保持与 MinerUClient 同签名，本地服务不校验云端 Token。
        start_time = time.time()
        protocol = self._detect_protocol()
        data = self._read_source_bytes(source, pdf_bytes)
        name = display_name or Path(source).name or "document.pdf"

        self.logger.info(
            "开始 MinerU 本地提取",
            source=Path(source).name,
            protocol=protocol,
            endpoint=self.endpoint,
            tier=self.tier or None,
        )

        work_dir = Path(tempfile.mkdtemp(prefix="doc-intake-mineru-local-"))
        try:
            if protocol == "v1":
                markdown, media_entries = self._run_v1(data, name, page_range, work_dir)
            else:
                markdown, media_entries = self._run_legacy(data, name, language, page_range, work_dir)

            result = ExtractionResult()
            result.markdown = markdown
            result.images, image_path_map = self._save_media(
                media_entries, output_dir, include_images, display_name or source
            )
            result.metadata = {
                "format": "pdf",
                "reader": "mineru-local",
                "usedBackend": "mineru-local",
                "protocol": protocol,
                "endpoint": self.endpoint,
                "tier": self.tier or None,
                "imagePathMap": image_path_map,
            }
        except Exception as e:
            self.logger.log_api_call(
                api_name="mineru-local",
                success=False,
                duration=time.time() - start_time,
                error=str(e),
            )
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

        self.logger.log_api_call(
            api_name="mineru-local", success=True, duration=time.time() - start_time
        )
        return result

    def _save_media(
        self,
        media_entries: list[tuple[Any, str]],
        output_dir: Optional[str],
        include_images: bool,
        source: str,
    ) -> tuple[list[str], dict[str, str]]:
        """把协议层拿到的图片交给 normalize_images 落盘，并生成 markdown 用的虚拟路径映射。"""
        if not include_images or not media_entries:
            if media_entries and not include_images:
                self.logger.debug("已关闭媒体提取，跳过图片落盘", count=len(media_entries))
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

        # markdown 里的引用是 zip 内相对路径（images/xxx.jpg），映射键要保留这个形态。
        image_path_map: dict[str, str] = {}
        for raw, virtual_key in media_entries:
            local_path = path_map.get(_source_key(raw))
            if not local_path:
                continue
            key = virtual_key if virtual_key.startswith("images/") else f"images/{Path(virtual_key).name}"
            image_path_map[key] = local_path
        return saved, image_path_map

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

    # ===== 协议一：V1 API =====

    def _run_v1(
        self,
        data: bytes,
        name: str,
        page_range: Optional[str],
        work_dir: Path,
    ) -> tuple[str, list[tuple[Any, str]]]:
        params: dict[str, str] = {
            "response_format": "zip",
            "wait_timeout": str(_SYNC_WAIT_SECONDS),
        }
        if self.tier:
            params["tier"] = self.tier
        if page_range:
            params["page_range"] = page_range

        url = f"{self.endpoint}/v1/file_parse"
        self.logger.debug("提交 MinerU 本地解析(V1)", url=url, params=params)
        response = requests.post(
            url,
            params=params,
            files={"files": (name, data, _mime_of(name))},
            headers=self._headers(),
            timeout=_SUBMIT_TIMEOUT,
        )

        if response.status_code == 202:
            task = self._as_json(response, "提交任务")
            payload = self._fetch_task_artifacts(self._await_task(task))
        elif response.status_code == 200:
            payload = self._payload_from_response(response)
            if isinstance(payload, dict) and not _looks_like_artifacts(payload):
                # 部分构建在 wait_timeout 内没跑完也回 200 + 任务对象。
                payload = self._fetch_task_artifacts(self._await_task(payload))
        else:
            raise RuntimeError(
                f"MinerU 本地解析失败: HTTP {response.status_code} {_snippet(response)}"
            )

        return self._payload_to_artifacts(payload, work_dir)

    def _payload_from_response(self, response: requests.Response) -> Any:
        content_type = str(response.headers.get("Content-Type") or "").lower()
        if "json" in content_type:
            try:
                return response.json()
            except ValueError as e:
                raise RuntimeError("MinerU 本地服务返回的 JSON 无法解析") from e
        return response.content

    def _as_json(self, response: requests.Response, action: str) -> dict:
        try:
            payload = response.json()
        except ValueError as e:
            raise RuntimeError(
                f"MinerU 本地{action}响应不是 JSON: {_snippet(response)}"
            ) from e
        if not isinstance(payload, dict):
            raise RuntimeError(f"MinerU 本地{action}响应结构异常: {type(payload).__name__}")
        return payload

    def _await_task(self, task: dict) -> dict:
        task_id = ""
        for key in ("task_id", "taskId", "id"):
            value = task.get(key)
            if isinstance(value, str) and value:
                task_id = value
                break
        if not task_id:
            raise RuntimeError(f"MinerU 本地服务未返回 task_id: keys={sorted(task)[:8]}")

        self.logger.debug("轮询 MinerU 本地任务", task_id=task_id)
        started = time.time()
        last_status = ""
        while time.time() - started < _TASK_TIMEOUT_SECONDS:
            response = requests.get(
                f"{self.endpoint}/v1/tasks/{task_id}",
                headers=self._headers(),
                timeout=(_PROBE_TIMEOUT, 60),
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"MinerU 本地任务查询失败: HTTP {response.status_code} {_snippet(response)}"
                )
            info = self._as_json(response, "任务查询")
            last_status = self._status_of(info)

            if last_status in ("completed", "partial"):
                if last_status == "partial":
                    self.logger.warning("MinerU 本地任务部分完成", task_id=task_id)
                return info
            if last_status in ("failed", "canceled", "cancelled"):
                detail = ""
                for key in ("error", "error_msg", "message", "detail"):
                    value = info.get(key)
                    if isinstance(value, str) and value:
                        detail = value
                        break
                raise RuntimeError(
                    f"MinerU 本地任务 {last_status}: {detail or '服务端未给出原因'}"
                )
            time.sleep(_POLL_INTERVAL_SECONDS)

        raise TimeoutError(
            f"MinerU 本地任务超时（{_TASK_TIMEOUT_SECONDS}秒），最后状态: {last_status or '未知'}"
        )

    def _fetch_task_artifacts(self, info: dict) -> Any:
        url = self._find_result_url(info)
        if url:
            response = requests.get(
                url, headers=self._headers(), timeout=_DOWNLOAD_TIMEOUT, allow_redirects=True
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"MinerU 本地结果下载失败: HTTP {response.status_code} {_snippet(response)}"
                )
            return self._payload_from_response(response)

        file_id = self._find_file_id(info)
        if not file_id:
            raise RuntimeError(
                f"MinerU 本地任务里既没有 result_url 也没有 file_id: keys={sorted(info)[:8]}"
            )
        response = requests.get(
            f"{self.endpoint}/v1/files/{file_id}/content",
            headers=self._headers(),
            timeout=_DOWNLOAD_TIMEOUT,
            allow_redirects=True,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"MinerU 本地产物下载失败: HTTP {response.status_code} {_snippet(response)}"
            )
        return self._payload_from_response(response)

    def _status_of(self, info: dict, depth: int = 0) -> str:
        """任务状态；不同构建把 status 放在顶层或 data/result 里。"""
        for key in ("status", "state", "task_status"):
            value = info.get(key)
            if isinstance(value, str) and value:
                return value.lower()
        if depth >= 3:
            return ""
        for value in info.values():
            if isinstance(value, dict):
                found = self._status_of(value, depth + 1)
                if found:
                    return found
        return ""

    def _find_result_url(self, info: dict, depth: int = 0) -> str:
        if depth > 3:
            return ""
        for key in ("result_url", "resultUrl"):
            value = info.get(key)
            if isinstance(value, str) and value:
                return value if value.startswith(("http://", "https://")) else f"{self.endpoint}{value}"
        for value in info.values():
            if isinstance(value, dict):
                found = self._find_result_url(value, depth + 1)
                if found:
                    return found
        return ""

    def _find_file_id(self, info: dict, depth: int = 0) -> str:
        if depth > 3:
            return ""
        for key in ("file_id", "fileId", "output_file_id"):
            value = info.get(key)
            if isinstance(value, str) and value:
                return value
        for key in ("files", "artifacts", "outputs"):
            items = info.get(key)
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        for id_key in ("id", "file_id", "fileId", "name", "file_name"):
                            value = item.get(id_key)
                            if isinstance(value, str) and value:
                                return value
                    elif isinstance(item, str) and item:
                        return item
        for value in info.values():
            if isinstance(value, dict):
                found = self._find_file_id(value, depth + 1)
                if found:
                    return found
        return ""

    # ===== 协议二：旧版 /file_parse =====

    def _run_legacy(
        self,
        data: bytes,
        name: str,
        language: str,
        page_range: Optional[str],
        work_dir: Path,
    ) -> tuple[str, list[tuple[Any, str]]]:
        if page_range:
            self.logger.debug("按 pageRange 在本地裁剪 PDF", page_range=page_range)
            data = _crop_pdf_bytes(data, page_range)

        form = [
            ("backend", _LEGACY_BACKEND),
            ("lang_list", _LEGACY_LANG_MAP.get((language or "").lower(), language or "ch")),
            ("return_md", "true"),
            ("return_images", "true"),
            ("return_content_list", "true"),
        ]
        url = f"{self.endpoint}/file_parse"
        self.logger.debug("提交 MinerU 本地解析(旧版协议)", url=url)
        response = requests.post(
            url,
            data=form,
            files={"files": (name, data, _mime_of(name))},
            headers=self._headers(),
            timeout=_SUBMIT_TIMEOUT,
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"MinerU 本地解析失败(旧版协议): HTTP {response.status_code} {_snippet(response)}"
            )
        payload = self._as_json(response, "解析")
        return self._dict_to_artifacts(_first_result_entry(payload), work_dir)

    # ===== 产物收敛 =====

    def _payload_to_artifacts(
        self, payload: Any, work_dir: Path
    ) -> tuple[str, list[tuple[Any, str]]]:
        if isinstance(payload, (bytes, bytearray)):
            return self._bytes_to_artifacts(bytes(payload), work_dir)
        if isinstance(payload, dict):
            return self._dict_to_artifacts(payload, work_dir)
        raise RuntimeError(
            f"MinerU 本地返回了无法识别的产物类型: {type(payload).__name__}"
        )

    def _bytes_to_artifacts(
        self, payload: bytes, work_dir: Path
    ) -> tuple[str, list[tuple[Any, str]]]:
        if zipfile.is_zipfile(io.BytesIO(payload)):
            return self._unzip_to_artifacts(payload, work_dir)
        # 服务端直接回了 markdown 文本（response_format 被服务端改写过）。
        return payload.decode("utf-8", "replace"), []

    def _unzip_to_artifacts(
        self, payload: bytes, work_dir: Path
    ) -> tuple[str, list[tuple[Any, str]]]:
        extract_dir = (work_dir / "zip").resolve()
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            for member in archive.infolist():
                target = (extract_dir / member.filename).resolve()
                # 防 zip 路径穿越：成员落点必须仍在解压目录下。
                # 用 is_relative_to 而不是字符串前缀，避免 /tmp/zip 被 /tmp/zip-evil 骗过。
                if not target.is_relative_to(extract_dir):
                    self.logger.warning("跳过越界的 zip 成员", member=member.filename)
                    continue
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)

        markdown_path = _find_markdown(extract_dir)
        if markdown_path is None:
            raise RuntimeError("MinerU 本地返回的 zip 里没有 markdown 文件")

        markdown = markdown_path.read_text(encoding="utf-8", errors="replace")
        base = markdown_path.parent
        media_entries: list[tuple[Any, str]] = []
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path == markdown_path:
                continue
            if path.suffix.lower() not in _IMAGE_SUFFIXES:
                continue
            media_entries.append((str(path), path.relative_to(base).as_posix()))
        self.logger.debug("MinerU 本地产物已解包", markdown_length=len(markdown), image_count=len(media_entries))
        return markdown, media_entries

    def _dict_to_artifacts(
        self, payload: dict, work_dir: Path
    ) -> tuple[str, list[tuple[Any, str]]]:
        markdown = ""
        for key in ("markdown", "md_content", "md", "content"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                markdown = value
                break
            if isinstance(value, dict):
                text = value.get("text")
                if isinstance(text, str) and text.strip():
                    markdown = text
                    break

        media_entries: list[tuple[Any, str]] = []
        images = payload.get("images")
        if isinstance(images, dict):
            for image_name, value in images.items():
                entry = self._image_entry(work_dir, str(image_name), value)
                if entry:
                    media_entries.append(entry)
        elif isinstance(images, list):
            for index, item in enumerate(images, 1):
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or item.get("path") or f"image_{index}.png")
                value = item.get("data") or item.get("base64") or item.get("content")
                entry = self._image_entry(work_dir, name, value)
                if entry:
                    media_entries.append(entry)

        if not markdown.strip() and not media_entries:
            raise RuntimeError(
                f"MinerU 本地返回里没有可用的 markdown: keys={sorted(payload)[:8]}"
            )
        return markdown, media_entries

    def _image_entry(
        self, work_dir: Path, name: str, value: Any
    ) -> Optional[tuple[Any, str]]:
        virtual_key = f"images/{Path(name).name}"
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return ({"url": value, "virtual_path": virtual_key}, virtual_key)

        data = _decode_base64(value)
        if data is None:
            self.logger.warning("MinerU 本地返回的图片无法解码，已跳过", image=name)
            return None
        target = work_dir / virtual_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return (str(target), virtual_key)
