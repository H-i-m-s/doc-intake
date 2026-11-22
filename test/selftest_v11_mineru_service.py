"""v11 本地 MinerU supervisor 自测：真起子进程真等 health，跑完清理。

用法：conda run -n Agent python test/selftest_v11_mineru_service.py
      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. --kit 指向不存在的文件 → 退出码 2、stderr 说人话、不产生 service.json。
  2. 假 kit（把本机 python.exe 复制成 mineru-kit.exe，cwd 里放一个叫 api-server 的脚本
     充当 api-server）→ supervisor 拉起、health 通过、service.json 字段齐全、
     子进程输出被写进 service.log 且带时间戳。
  3. idle=2 时持续 touch 不退出；停手后按时收工，子进程被树杀干净。
  4. 子进程被外面杀掉 → supervisor 不重启、写日志、退出。
  5. service.json 里的 child_pid 指到别人身上 → 收工只清记录，不误杀。

不碰真实 MinerU：全部走临时目录与临时端口，不读任何绝对路径。
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_SUPERVISOR = os.path.join(_APP_DIR, "python", "mineru_service.py")

# 假 kit 就是本机 python.exe 的副本：名字换成 mineru-kit.exe，这样 supervisor 的
# 「命令行含 mineru-kit」判定能命中，而它 fork 出来的子进程也是真进程、能被树杀。
KIT_NAME = "mineru-kit.exe"

# 充当 api-server 的脚本。supervisor 固定传 [kit, "api-server", "--host", ..., "--port", n]，
# 而 python 会把没有后缀的 "api-server" 当源码文件跑（cwd 就是 state-dir），正好对上。
FAKE_API = '''import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[sys.argv.index("--port") + 1])
print("fake api-server up on %d" % port, flush=True)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/v1/health":
            body = b'{"status":"ok"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
'''


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


# ── 进程小工具 ──────────────────────────────────────────────────────


def pid_alive(pid: int) -> bool:
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(0x1000, False, wintypes.DWORD(pid))
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == 259
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def tree_kill(pid: int) -> None:
    if not pid_alive(pid):
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=30)
        return
    try:
        os.killpg(os.getpgid(pid), 9)
    except OSError:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def health_ok(port: int) -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/v1/health" % port, timeout=1.5) as response:
            return 200 <= int(getattr(response, "status", 0)) < 300
    except Exception:
        return False


def wait_for(predicate, timeout: float, step: float = 0.1) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(step)
    return predicate()


def read_state(state_dir: Path) -> dict:
    try:
        with open(state_dir / "service.json", "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def read_log(state_dir: Path) -> str:
    try:
        return (state_dir / "service.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


# ── 用例 ────────────────────────────────────────────────────────────


def make_kit(root: Path, state_dir: Path) -> Path:
    """复制本机 python.exe 当 kit，并在 state-dir 里放好 api-server 脚本。"""
    kit = root / KIT_NAME
    shutil.copy2(sys.executable, kit)
    (state_dir / "api-server").write_text(FAKE_API, encoding="utf-8")
    return kit


def child_env() -> dict:
    """让复制出来的 python.exe 还能找到标准库与 pythonXY.dll。"""
    env = dict(os.environ)
    env["PYTHONHOME"] = sys.base_prefix
    env["PYTHONUTF8"] = "1"
    env["PATH"] = os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", "")
    return env


def start_supervisor(kit: Path, port: int, idle: float, state_dir: Path):
    return subprocess.Popen(
        [
            sys.executable, _SUPERVISOR,
            "--kit", str(kit),
            "--port", str(port),
            "--idle-seconds", str(idle),
            "--state-dir", str(state_dir),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=child_env(),
        cwd=str(Path(_APP_DIR)),
    )


def case_bad_kit(root: Path, check: Checker) -> None:
    print("\n[1] --kit 指向不存在的文件")
    state_dir = root / "bad-kit-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    missing = root / "no-such-mineru-kit.exe"
    done = subprocess.run(
        [
            sys.executable, _SUPERVISOR,
            "--kit", str(missing),
            "--port", str(free_port()),
            "--idle-seconds", "30",
            "--state-dir", str(state_dir),
        ],
        capture_output=True,
        env=child_env(),
        timeout=60,
    )
    stderr = done.stderr.decode("utf-8", "replace").strip()
    check.ok(done.returncode == 2, "退出码是 2", "实际 %s" % done.returncode)
    check.ok("mineru-kit 路径无效" in stderr, "stderr 说清是路径无效", stderr[:200])
    check.ok(str(missing) in stderr or missing.name in stderr, "stderr 带上了那个路径", stderr[:200])
    check.ok(not (state_dir / "service.json").exists(), "没有留下 service.json")


def case_happy_path(root: Path, check: Checker) -> None:
    print("\n[2] 假 kit 拉起 + health + service.json")
    state_dir = root / "happy-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    kit = make_kit(root, state_dir)
    port = free_port()
    # idle=5：这节不 touch，用例跑完就该到点自己收工，正好把「收工即干净」一并验了。
    sup = start_supervisor(kit, port, 5, state_dir)
    child_pid = 0
    try:
        check.ok(
            wait_for(lambda: (state_dir / "service.json").exists(), 30),
            "service.json 出现了",
            read_log(state_dir)[-300:],
        )
        record = read_state(state_dir)
        check.ok(record.get("pid") == sup.pid, "pid 就是 supervisor 自己", str(record.get("pid")))
        child_pid = int(record.get("child_pid") or 0)
        check.ok(bool(child_pid) and child_pid != sup.pid, "child_pid 是另一个进程", str(child_pid))
        check.ok(record.get("port") == port, "port 记对了", str(record.get("port")))
        check.ok(str(record.get("kit", "")).lower().endswith(KIT_NAME), "kit 记的是完整路径", str(record.get("kit")))
        check.ok(bool(record.get("started_at")), "started_at 非空", str(record.get("started_at")))
        check.ok(wait_for(lambda: health_ok(port), 60), "/v1/health 通了")

        log_text = read_log(state_dir)
        check.ok("fake api-server up on %d" % port in log_text, "子进程输出进了 service.log")
        check.ok("kit | " in log_text, "子进程输出带来源前缀")
        check.ok(
            bool(log_text) and log_text.splitlines()[0].startswith("[") and "] [" not in log_text.splitlines()[0],
            "日志行带时间戳",
            log_text.splitlines()[0] if log_text else "",
        )

        check.ok(wait_for(lambda: sup.poll() is not None, 40), "空闲到点后自己收工", read_log(state_dir)[-300:])
        check.ok(sup.returncode == 0, "收工退出码是 0", str(sup.returncode))
        check.ok(not (state_dir / "service.json").exists(), "收工时删掉了 service.json")
        check.ok(wait_for(lambda: not pid_alive(child_pid), 30), "子进程被树杀干净", str(child_pid))
    finally:
        if sup.poll() is None:
            sup.kill()
        tree_kill(child_pid)


def case_idle_and_touch(root: Path, check: Checker) -> None:
    print("\n[3] idle=2：持续 touch 不退出，停手后按时收工")
    state_dir = root / "idle-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    kit = make_kit(root, state_dir)
    port = free_port()
    sup = start_supervisor(kit, port, 2, state_dir)
    activity = state_dir / "activity"
    child_pid = 0
    try:
        check.ok(wait_for(lambda: (state_dir / "service.json").exists(), 30), "service.json 出现了")
        check.ok(wait_for(lambda: health_ok(port), 60), "/v1/health 通了")
        record = read_state(state_dir)
        child_pid = int(record.get("child_pid") or 0)

        # 6 秒里每 0.5 秒 touch 一次：远超 idle=2，但不该退出。
        deadline = time.time() + 6.0
        while time.time() < deadline:
            activity.write_text("tick", encoding="utf-8")
            time.sleep(0.5)
        check.ok(sup.poll() is None, "持续 touch 期间 supervisor 还活着", "退出码 %s" % sup.poll())
        check.ok(health_ok(port), "期间服务一直可用")

        # 停手之后最多 idle + 一个 tick + 树杀耗时。
        check.ok(wait_for(lambda: sup.poll() is not None, 25), "停手后按时收工", read_log(state_dir)[-300:])
        check.ok(not (state_dir / "service.json").exists(), "service.json 已删除")
        check.ok(wait_for(lambda: not pid_alive(child_pid), 30), "子进程被树杀干净", str(child_pid))
        check.ok(not health_ok(port), "端口不再应答")
    finally:
        if sup.poll() is None:
            sup.kill()
        tree_kill(child_pid)


def case_child_killed(root: Path, check: Checker) -> None:
    print("\n[4] 子进程被外面杀掉：不重启、写日志、退出")
    state_dir = root / "child-died-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    kit = make_kit(root, state_dir)
    port = free_port()
    sup = start_supervisor(kit, port, 60, state_dir)
    try:
        check.ok(wait_for(lambda: (state_dir / "service.json").exists(), 30), "service.json 出现了")
        check.ok(wait_for(lambda: health_ok(port), 60), "/v1/health 通了")
        child_pid = int(read_state(state_dir).get("child_pid") or 0)
        tree_kill(child_pid)

        check.ok(wait_for(lambda: sup.poll() is not None, 30), "supervisor 自己退了", "退出码 %s" % sup.poll())
        check.ok(sup.returncode == 1, "退出码是 1", str(sup.returncode))
        log_text = read_log(state_dir)
        check.ok("不重启" in log_text, "日志说明了不重启", log_text[-300:])
        check.ok(not (state_dir / "service.json").exists(), "service.json 已删除")
        time.sleep(1.0)
        check.ok(not (state_dir / "service.json").exists(), "没有偷偷重新拉起")
    finally:
        if sup.poll() is None:
            sup.kill()
        tree_kill(read_state(state_dir).get("child_pid") or 0)


def case_foreign_pid(root: Path, check: Checker) -> None:
    print("\n[5] service.json 的 child_pid 指到别人身上：只清记录，不误杀")
    state_dir = root / "foreign-state"
    state_dir.mkdir(parents=True, exist_ok=True)
    kit = make_kit(root, state_dir)
    port = free_port()
    sup = start_supervisor(kit, port, 3, state_dir)
    decoy = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        check.ok(wait_for(lambda: (state_dir / "service.json").exists(), 30), "service.json 出现了")
        check.ok(wait_for(lambda: health_ok(port), 60), "/v1/health 通了")
        record = read_state(state_dir)
        real_child = int(record.get("child_pid") or 0)
        check.ok(pid_alive(real_child), "真子进程在跑", str(real_child))

        # 把记录里的 child_pid 换成那个无关进程：pid 是活的，但命令行不含 mineru-kit。
        record["child_pid"] = decoy.pid
        (state_dir / "service.json").write_text(json.dumps(record), encoding="utf-8")

        check.ok(wait_for(lambda: sup.poll() is not None, 30), "空闲到点后 supervisor 退出了", read_log(state_dir)[-300:])
        check.ok(pid_alive(decoy.pid), "被冒名的进程还活着（没误杀）")
        check.ok(wait_for(lambda: not pid_alive(real_child), 30), "真子进程照样被收掉", str(real_child))
        check.ok(not (state_dir / "service.json").exists(), "service.json 已删除")
        check.ok("命令行不含 mineru-kit" in read_log(state_dir), "日志里写明了为什么不动它")
    finally:
        if sup.poll() is None:
            sup.kill()
        tree_kill(read_state(state_dir).get("child_pid") or 0)
        if decoy.poll() is None:
            decoy.kill()
        decoy.wait(timeout=10)


def main() -> int:
    check = Checker()
    root = Path(tempfile.mkdtemp(prefix="docintake-mineru-service-"))
    try:
        case_bad_kit(root, check)
        case_happy_path(root, check)
        case_idle_and_touch(root, check)
        case_child_killed(root, check)
        case_foreign_pid(root, check)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return check.summary()


if __name__ == "__main__":
    sys.exit(main())
