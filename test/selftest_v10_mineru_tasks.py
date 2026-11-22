"""v10 mineru-local 原生 task 协议自测：标准库起假服务真跑，跑完清理。

用法：python test/selftest_v10_mineru_tasks.py   （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 协议探测三条分支：openapi.json 里有 /v1/tasks → tasks；openapi.json 404 且 /v1/health 404
     → legacy；openapi.json 404 但 /v1/health 200 → v1；同一 endpoint 只探一次。
  2. 建单请求体：files[0].file_name 是纯文件名（带目录也剥成 basename）、tier 为空时不出现、
     给了 page_range 才出现且原样交给服务端（本地不裁 PDF）、ocr_mode / output_formats 固定。
  3. 上传：按回执里的 upload 动作原样 PUT（相对地址补 endpoint、头以回执为准、
     Content-Type 是 application/octet-stream），字节与原文件逐字节相同。
  4. 轮询：先 pending 再 completed，两次查询之间真的等了（间隔不为 0）；
     failed 时把服务端的 code / message 原样带进异常，canceled 与 failed 措辞不同。
  5. 产物：zip 里的 full.md + images/x.png 解包落盘，正文引用对上 imagePathMap；
     result_url 优先，缺失时退回 /v1/files/{file_id}/content。
  6. 401 / 403 仍然报权限错误。
  7. 探测落到 v1 却拿到 404 时，报错能看出三条协议都试过。

不碰真实服务：全部走本机 127.0.0.1 上的临时端口，进程内起停。
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

import mineru_local_client as _MODULE  # noqa: E402
from mineru_local_client import MinerULocalClient  # noqa: E402

# 1×1 的真 PNG：落盘后要能被当图片看，不用占位文本。
PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)

MARKDOWN = "# 标题\n\n正文段落。\n\n![图](images/x.png)\n"

# 生产用的轮询间隔（3 秒）在用例里会被换成 0.05 秒，否则一次自测要等十几秒。
# 这里先把默认值记下来，轮询那一节断言它就不是 0。
DEFAULT_POLL_SECONDS = _MODULE._POLL_INTERVAL_SECONDS
TEST_POLL_SECONDS = 0.05


# ── 断言小工具（与既有自测同款）─────────────────────────────────────


class Checker:
    def __init__(self) -> None:
        self.failed = 0
        self.passed = 0

    def ok(self, condition: bool, label: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print("  ✓ %s" % label)
        else:
            self.failed += 1
            print("  ✗ %s%s" % (label, ("｜" + detail) if detail else ""))
        return condition

    def summary(self) -> int:
        print()
        print("通过 %d 项，失败 %d 项" % (self.passed, self.failed))
        return 0 if self.failed == 0 else 1


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-mineru-tasks-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def expect_error(fn, kinds=(Exception,)) -> str:
    """跑 fn，把它抛出来的消息交回来；没抛或抛了别的类型都返回空串。"""
    try:
        fn()
    except kinds as exc:
        return "%s: %s" % (type(exc).__name__, exc)
    except Exception:
        return ""
    return ""


# ── 假服务 ──────────────────────────────────────────────────────────


class FakeApi:
    """一个可配置的 mineru-kit api-server 替身，只实现本单用到的五条路由。"""

    def __init__(self) -> None:
        self.openapi_status = 200
        self.paths = {"/v1/tasks": {"post": {}}, "/v1/health": {"get": {}}}
        self.health_status = 200
        self.file_parse_status = 404  # 旧 v1 入口：本机 api-server 本来就没有
        self.deny = 0  # 401 / 403：整站拒绝
        self.task_id = "task-1"
        self.file_id = "file-1"
        self.states = ["pending", "completed"]
        self.file_error = None
        self.result_url = "relative"  # relative / absolute / none
        self.zip_bytes = b""
        self.create_body = None
        self.upload_body = None
        self.upload_headers = None
        self.upload_method = ""
        self.upload_path = ""
        self.queries = []  # 每次 GET /v1/tasks/{id} 的时刻
        self.openapi_hits = 0
        self.result_hits = 0
        self.content_hits = 0

    def reset(self) -> None:
        self.__init__()  # noqa: PLC2801 - 重新开一份干净状态最省事

    def current_state(self) -> str:
        index = min(max(len(self.queries) - 1, 0), len(self.states) - 1)
        return self.states[index]

    def make_zip(self) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("result/full.md", MARKDOWN)
            archive.writestr("result/images/x.png", PNG_1X1)
        return buffer.getvalue()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    api: FakeApi = None  # type: ignore[assignment]

    def log_message(self, *args) -> None:  # 自测不要往 stderr 里刷访问日志
        pass

    # -- 发送 --

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json")

    def _denied(self) -> bool:
        if not self.api.deny:
            return False
        self._json(self.api.deny, {"error": {"code": "unauthorized", "message": "denied by test"}})
        return True

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _task_file_payload(self) -> dict:
        api = self.api
        state = api.current_state()
        file_status = state if state in ("completed", "failed", "canceled") else ("running" if state == "running" else "pending")
        item = {
            "file_id": api.file_id,
            "file_name": "sample.pdf",
            "status": file_status,
            "bytes": 12,
        }
        if api.file_error is not None:
            item["error"] = api.file_error
        if state == "completed":
            base = "http://%s:%d" % self.server.server_address[:2]
            if api.result_url == "relative":
                item["result_url"] = "/v1/results/%s.zip" % api.file_id
            elif api.result_url == "absolute":
                item["result_url"] = "%s/v1/results/%s.zip" % (base, api.file_id)
        return item

    # -- 路由 --

    def do_GET(self) -> None:
        if self._denied():
            return
        api = self.api
        path = urlparse(self.path).path
        if path == "/openapi.json":
            api.openapi_hits += 1
            if api.openapi_status != 200:
                self._json(api.openapi_status, {"detail": "not found"})
                return
            self._json(200, {"openapi": "3.1.0", "paths": api.paths})
            return
        if path == "/v1/health":
            self._json(api.health_status, {"status": "ok"} if api.health_status == 200 else {"detail": "no"})
            return
        if path == "/v1/tasks/%s" % api.task_id:
            api.queries.append(time.time())
            state = api.current_state()
            self._json(
                200,
                {
                    "task_id": api.task_id,
                    "status": state,
                    "created_at": "2026-01-01T00:00:00Z",
                    "output_formats": ["default"],
                    "progress": {"completed": int(state == "completed"), "failed": int(state == "failed"), "total": 1},
                    "files": [self._task_file_payload()],
                },
            )
            return
        if path == "/v1/results/%s.zip" % api.file_id:
            api.result_hits += 1
            self._send(200, api.zip_bytes or api.make_zip(), "application/zip")
            return
        if path == "/v1/files/%s/content" % api.file_id:
            api.content_hits += 1
            self._send(200, api.zip_bytes or api.make_zip(), "application/zip")
            return
        self._json(404, {"error": {"code": "not_found", "message": path}})

    def do_POST(self) -> None:
        body = self._body()
        if self._denied():
            return
        api = self.api
        path = urlparse(self.path).path
        if path == "/v1/tasks":
            api.create_body = json.loads(body.decode("utf-8") or "{}")
            self._json(
                202,
                {
                    "task_id": api.task_id,
                    "status": "waiting-file",
                    "files": [
                        {
                            "file_id": api.file_id,
                            "file_name": api.create_body["files"][0]["file_name"],
                            "status": "waiting-file",
                            "upload": {
                                "url": "/v1/tasks/%s/uploads/%s" % (api.task_id, api.file_id),
                                "headers": {"Content-Type": "application/octet-stream"},
                                "expires_at": int(time.time()) + 600,
                            },
                        }
                    ],
                },
            )
            return
        if path == "/v1/file_parse":
            self._json(api.file_parse_status, {"error": {"code": "not_found", "message": "no such route"}})
            return
        self._json(404, {"error": {"code": "not_found", "message": path}})

    def do_PUT(self) -> None:
        body = self._body()
        if self._denied():
            return
        api = self.api
        api.upload_method = "PUT"
        api.upload_path = urlparse(self.path).path
        api.upload_body = body
        api.upload_headers = {k.lower(): v for k, v in self.headers.items()}
        self._json(
            200,
            {"task_id": api.task_id, "file_id": api.file_id, "status": "pending"},
        )


class FakeServer:
    """127.0.0.1 上随机端口起一个假服务，出区块就关。"""

    def __init__(self, api: FakeApi) -> None:
        handler = type("BoundHandler", (_Handler,), {"api": api})
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> str:
        self.thread.start()
        host, port = self.httpd.server_address[:2]
        return "http://%s:%d" % (host, port)

    def __exit__(self, *exc_info) -> bool:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        return False


# ── 调用辅助 ────────────────────────────────────────────────────────


def write_source(root: str, data: bytes = b"%PDF-1.4 fake bytes") -> str:
    path = os.path.join(root, "sample.pdf")
    with open(path, "wb") as handle:
        handle.write(data)
    return path


def make_client(endpoint: str, **settings) -> MinerULocalClient:
    payload = {"mineruLocalEndpoint": endpoint}
    payload.update(settings)
    return MinerULocalClient(payload)


def extract(root: str, endpoint: str, page_range=None, **settings):
    source = write_source(root)
    output = os.path.join(root, "out")
    os.makedirs(output, exist_ok=True)
    client = make_client(endpoint, **settings)
    return client.extract(source, output_dir=output, page_range=page_range)


def fresh(endpoint: str) -> None:
    """同一进程里换端口就换缓存键，清一遍只为让每个用例从零开始算。"""
    _MODULE._PROTOCOL_CACHE.pop(endpoint, None)
    _MODULE._PROBE_NOTES.pop(endpoint, None)


# ── 场景 ────────────────────────────────────────────────────────────


def case_probe(root: str) -> Checker:
    """三条探测分支 + 只探一次。"""
    check = Checker()
    print()
    print("── 1. 协议探测 ──")

    api = FakeApi()
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        check.ok(make_client(endpoint)._detect_protocol() == "tasks",
                 "openapi.json 有 /v1/tasks → tasks")
        check.ok(make_client(endpoint)._detect_protocol() == "tasks", "再取一次仍然是 tasks")
        check.ok(api.openapi_hits == 1, "同一 endpoint 只取一次 openapi.json",
                 str(api.openapi_hits))

    api = FakeApi()
    api.openapi_status = 404
    api.health_status = 404
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        check.ok(make_client(endpoint)._detect_protocol() == "legacy",
                 "openapi.json 404 且 /v1/health 404 → legacy")

    api = FakeApi()
    api.openapi_status = 404
    api.health_status = 200
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        check.ok(make_client(endpoint)._detect_protocol() == "v1",
                 "openapi.json 404 但 /v1/health 200 → v1")

    api = FakeApi()
    api.openapi_status = 500
    api.health_status = 200
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        check.ok(make_client(endpoint)._detect_protocol() == "v1",
                 "openapi.json 500（非 JSON）不炸，退回旧规则 → v1")

    api = FakeApi()
    api.paths = {"/v1/file_parse": {"post": {}}}
    api.health_status = 200
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        check.ok(make_client(endpoint)._detect_protocol() == "v1",
                 "openapi.json 没有 /v1/tasks（老 v1 服务）→ v1")
    return check


def case_submit(root: str) -> Checker:
    """建单请求体的字段。”"""
    check = Checker()
    print()
    print("── 2. 建单请求体 ──")

    api = FakeApi()
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        extract(root, endpoint)
        body = api.create_body or {}
        files = body.get("files") or [{}]
        check.ok(files[0].get("file_name") == "sample.pdf", "file_name 是纯文件名",
                 repr(files[0].get("file_name")))
        check.ok("tier" not in body, "tier 为空时请求体里没有这个键", repr(sorted(body)))
        check.ok("page_range" not in body, "没给 page_range 时不出现", repr(sorted(body)))
        check.ok(body.get("ocr_mode") == "auto", "ocr_mode == auto", repr(body.get("ocr_mode")))
        check.ok(body.get("output_formats") == ["default"], "output_formats == [default]",
                 repr(body.get("output_formats")))
        check.ok(files[0].get("bytes") == os.path.getsize(os.path.join(root, "sample.pdf")),
                 "files[0].bytes 与源文件大小一致（协议要求声明大小）", repr(files[0].get("bytes")))

    api = FakeApi()
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        extract(root, endpoint, mineruLocalTier="basic", page_range="1-2")
        body = api.create_body or {}
        check.ok(body.get("tier") == "basic", "tier 有值时原样带上", repr(body.get("tier")))
        check.ok(body.get("page_range") == "1-2", "page_range 交给服务端自己裁",
                 repr(body.get("page_range")))
        # 源文件根本不是真 PDF：若客户端偷偷本地裁页，这里会先炸。
        uploaded = api.upload_body or b""
        with open(os.path.join(root, "sample.pdf"), "rb") as handle:
            check.ok(uploaded == handle.read(), "page_range 没有触发本地裁 PDF（上传字节未变）")
    return check


def case_upload(root: str) -> Checker:
    """上传动作照回执执行。"""
    check = Checker()
    print()
    print("── 3. 上传 ──")

    api = FakeApi()
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        extract(root, endpoint)
        check.ok(api.upload_method == "PUT", "按回执用 PUT", api.upload_method or "（没发）")
        check.ok(api.upload_path == "/v1/tasks/task-1/uploads/file-1",
                 "上传地址就是回执给的 upload.url（相对路径补了 endpoint）", api.upload_path)
        headers = api.upload_headers or {}
        check.ok(headers.get("content-type") == "application/octet-stream",
                 "Content-Type: application/octet-stream", headers.get("content-type"))
        with open(os.path.join(root, "sample.pdf"), "rb") as handle:
            check.ok(api.upload_body == handle.read(), "上传字节与原文件逐字节相同")
        check.ok(headers.get("content-length") == str(len(api.upload_body or b"")),
                 "Content-Length 与字节数一致", headers.get("content-length"))
    return check


def case_polling(root: str) -> Checker:
    """轮询节奏与失败信息。"""
    check = Checker()
    print()
    print("── 4. 轮询 ──")

    check.ok(DEFAULT_POLL_SECONDS >= 1, "默认轮询间隔不是 0（生产用 3 秒）",
             repr(DEFAULT_POLL_SECONDS))
    check.ok(_MODULE._POLL_INTERVAL_SECONDS == TEST_POLL_SECONDS,
             "本用例把间隔换成了 0.05 秒（下面的数字都是它）",
             repr(_MODULE._POLL_INTERVAL_SECONDS))

    api = FakeApi()
    api.states = ["pending", "running", "completed"]
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        result = extract(root, endpoint)
        check.ok(result.metadata.get("protocol") == "tasks", "metadata.protocol == tasks",
                 repr(result.metadata.get("protocol")))
        check.ok(len(api.queries) == 3, "先 pending 再 running 再 completed（查询 3 次）",
                 str(len(api.queries)))
        gaps = [b - a for a, b in zip(api.queries, api.queries[1:])]
        check.ok(bool(gaps) and min(gaps) > 0, "两次查询之间真的等了（间隔不为 0）",
                 repr([round(g, 3) for g in gaps]))
        check.ok(all(g >= 0.04 for g in gaps), "间隔不小于配置值（取 0.04 容差）",
                 repr([round(g, 3) for g in gaps]))

    api = FakeApi()
    api.states = ["running", "failed"]
    api.file_error = {"code": "parse_failed", "message": "模型那一步炸了"}
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        message = expect_error(lambda: extract(root, endpoint))
        check.ok("failed" in message, "failed：异常里点明 failed", message)
        check.ok("parse_failed" in message, "failed：服务端的 code 原样带出", message)
        check.ok("模型那一步炸了" in message, "failed：服务端的 message 原样带出", message)

    api = FakeApi()
    api.states = ["canceled"]
    api.file_error = {"code": "canceled", "message": "调用方撤了"}
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        message = expect_error(lambda: extract(root, endpoint))
        check.ok("canceled" in message, "canceled：异常里点明已取消", message)
        check.ok("failed" not in message, "canceled 与 failed 分开措辞", message)
        check.ok("调用方撤了" in message, "canceled：原因也带出来", message)
    return check


def case_artifacts(root: str) -> Checker:
    """产物解包与取回路径。"""
    check = Checker()
    print()
    print("── 5. 产物 ──")

    api = FakeApi()
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        result = extract(root, endpoint)
        check.ok(api.result_hits == 1, "优先走回执里的 result_url", str(api.result_hits))
        check.ok(api.content_hits == 0, "有 result_url 时不打 /v1/files/{id}/content",
                 str(api.content_hits))
        check.ok("正文段落。" in result.markdown, "正文来自 zip 里的 full.md",
                 repr(result.markdown[:40]))
        image_map = result.metadata.get("imagePathMap") or {}
        key = "images/x.png"
        check.ok(key in image_map, "imagePathMap 里有 images/x.png", repr(sorted(image_map)))
        saved = image_map.get(key, "")
        check.ok(bool(saved) and os.path.isfile(saved), "图片落盘了", saved)
        check.ok(saved and os.path.basename(saved).startswith("image_001"),
                 "落盘文件名按媒体规则统一编号", os.path.basename(saved) if saved else "")
        check.ok(saved and os.path.basename(os.path.dirname(saved)) == "sample_media",
                 "落在 {stem}_media/ 目录里", saved)
        if saved and os.path.isfile(saved):
            with open(saved, "rb") as handle:
                check.ok(handle.read() == PNG_1X1, "落盘图片字节与 zip 里的一致")
        check.ok("![图](images/x.png)" in result.markdown,
                 "正文引用仍指向映射键（后续由 main.py 改写成本地路径）", repr(result.markdown))

    api = FakeApi()
    api.result_url = "none"
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        result = extract(root, endpoint)
        check.ok(api.content_hits == 1, "没有 result_url 时退回 /v1/files/{id}/content",
                 str(api.content_hits))
        check.ok("正文段落。" in result.markdown, "退回路径也解析出正文")

    api = FakeApi()
    api.result_url = "absolute"
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        extract(root, endpoint)
        check.ok(api.result_hits == 1, "绝对 result_url 原样使用", str(api.result_hits))
    return check


def case_auth(root: str) -> Checker:
    """401 / 403 仍是权限错误。"""
    check = Checker()
    print()
    print("── 6. 权限 ──")

    for code in (401, 403):
        api = FakeApi()
        api.deny = code
        with FakeServer(api) as endpoint:
            fresh(endpoint)
            message = expect_error(lambda: extract(root, endpoint), kinds=(PermissionError,))
            check.ok(message.startswith("PermissionError"), "%d：抛 PermissionError" % code, message)
            check.ok("%d" % code in message, "%d：消息里有状态码" % code, message)
    return check


def case_not_found_hint(root: str) -> Checker:
    """探测落在 v1 却拿 404：报错要说清三条协议都试过。"""
    check = Checker()
    print()
    print("── 7. 三条协议都试过时的 404 ──")

    api = FakeApi()
    api.openapi_status = 404
    api.health_status = 200
    api.file_parse_status = 404
    with FakeServer(api) as endpoint:
        fresh(endpoint)
        message = expect_error(lambda: extract(root, endpoint))
        check.ok("404" in message, "报 404", message)
        check.ok("三条协议均已尝试" in message or "三条协议都已试过" in message,
                 "提示三条协议都已尝试", message)
        check.ok("openapi.json HTTP 404" in message, "探测留痕里有 openapi.json 的结论", message)
        check.ok("/v1/health HTTP 200" in message, "探测留痕里有 /v1/health 的结论", message)
    return check


def case_tier_enum(root: str) -> Checker:
    """档位枚举三处同步（读文件，不起服务）。"""
    check = Checker()
    print()
    print("── 8. tier 枚举 ──")

    want = {"", "flash", "basic", "standard", "advanced"}

    settings_route = os.path.join(_APP_DIR, "routes", "settings.js")
    with open(settings_route, encoding="utf-8") as handle:
        src = handle.read()
    match = re.search(r"mineruLocalTier:\s*\{[^}]*enum:\s*\[([^\]]*)\]", src)
    got = {token.strip().strip('"').strip("'") for token in match.group(1).split(",")} if match else set()
    check.ok(got == want, "routes/settings.js 的 enum 五个档位", str(sorted(got)))

    ui_settings = os.path.join(_APP_DIR, "ui", "assets", "settings.js")
    with open(ui_settings, encoding="utf-8") as handle:
        src = handle.read()
    block = re.search(r"mineruLocalTier:\s*\{[\s\S]*?labels:\s*\{([^}]*)\}", src)
    labels = set(re.findall(r"([A-Za-z]*)\s*:", block.group(1))) if block else set()
    check.ok({"flash", "basic", "standard", "advanced"} <= labels,
             "ui/assets/settings.js 的 labels 有四个档", str(sorted(labels)))

    with open(os.path.join(_APP_DIR, "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    field = manifest["contributes"]["settings"]["schema"]["properties"]["mineruLocalTier"]
    check.ok(set(field["enum"]) == want, "manifest.json 的 enum 五个档位", str(field["enum"]))
    return check


def self_test() -> int:
    print("mineru-local 原生 task 协议自测（假服务真跑，不碰 8000/8003）")

    def run(root: str) -> int:
        total = Checker()
        saved = _MODULE._POLL_INTERVAL_SECONDS
        _MODULE._POLL_INTERVAL_SECONDS = TEST_POLL_SECONDS
        try:
            for case in (case_probe, case_submit, case_upload, case_polling, case_artifacts,
                         case_auth, case_not_found_hint, case_tier_enum):
                check = case(root)
                total.passed += check.passed
                total.failed += check.failed
        finally:
            _MODULE._POLL_INTERVAL_SECONDS = saved
        return total.summary()

    return with_temp(run)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")

    if "--selftest" in sys.argv:
        sys.exit(self_test())

    print(__doc__)
    print("用法：python test/selftest_v10_mineru_tasks.py")
