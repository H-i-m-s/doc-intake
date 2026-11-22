"""MinerU 本地服务守护脚本（标准库，无第三方依赖）。

职责只有四件：拉起 mineru-kit api-server 子进程、等它 health、盯活跃时间、
超时（或收到信号 / 父进程消失）时树杀子进程并清掉记录。

App 侧只通过两个文件跟它说话：
  <state-dir>/service.json  —— 它写，App 读（判断「这是我们的实例」）
  <state-dir>/activity      —— App 写（每次解析前 touch），它只读 mtime

用法：
    python mineru_service.py --kit <mineru-kit.exe 完整路径> --port <端口>
        --idle-seconds <空闲秒数> --state-dir <目录>

退出码：0 正常收工（空闲 / 父进程消失 / 收到信号）、1 子进程没起来或中途退出、
2 参数里的 mineru-kit 路径无效。
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# 等 health 的上限。懒加载模式下进程几秒就 health，模型要等第一次解析才加载，
# 所以这里不是「模型加载完」的时限，只是「HTTP 能应答」的时限。
HEALTH_TIMEOUT_SECONDS = 120.0
HEALTH_POLL_SECONDS = 1.0

# 空闲检查的间隔。idle 很短时按比例缩短，否则 idle=2 的用例得等满 15 秒才可能退出；
# 生产默认 300 秒时这里就是 15 秒一次。
IDLE_TICK_SECONDS = 15.0

# 判断「这个 pid 是我们的 mineru-kit」时认的关键字。
KIT_MARKER = "mineru-kit"

STATE_FILE = "service.json"
ACTIVITY_FILE = "activity"
LOG_FILE = "service.log"


# ── 小工具 ──────────────────────────────────────────────────────────


def _stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


class _Log:
    """service.log 的唯一写入口：追加、带时间戳、每次都 flush。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._fh = None
        try:
            self._fh = open(path, "a", encoding="utf-8", errors="replace")
        except OSError as exc:  # 日志开不了不该让服务起不来
            print(f"service.log 打不开: {exc}", file=sys.stderr)

    def write(self, message: str) -> None:
        line = f"[{_stamp()}] {message}"
        if self._fh is None:
            print(line, file=sys.stderr)
            return
        with self._lock:
            try:
                self._fh.write(line + "\n")
                self._fh.flush()
            except OSError:
                pass

    def close(self) -> None:
        if self._fh is None:
            return
        with self._lock:
            try:
                self._fh.close()
            except OSError:
                pass
            self._fh = None


def _decode(raw: bytes) -> str:
    """子进程输出的编码在 Windows 上可能是 GBK，先按 UTF-8 试，不成立再按 GBK。"""
    for codec in ("utf-8", "gbk"):
        try:
            return raw.decode(codec)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def pid_alive(pid: int) -> bool:
    """进程还活着吗。Windows 上绝不能用 os.kill(pid, 0)：那是发退出码，会杀人。"""
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, wintypes.DWORD(pid))
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return False
            return code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def process_cmdline(pid: int) -> str:
    """取进程命令行。取不到（进程没了 / 工具不可用）返回空串。"""
    if not pid_alive(pid):
        return ""
    if os.name == "nt":
        script = (
            "$p = Get-CimInstance Win32_Process -Filter \"ProcessId=%d\"; "
            "if ($p) { [Console]::Out.Write($p.CommandLine) }" % pid
        )
        try:
            done = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True,
                timeout=25,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        if done.returncode != 0:
            return ""
        return _decode(done.stdout).strip()
    try:
        with open("/proc/%d/cmdline" % pid, "rb") as fh:
            return fh.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
    except OSError:
        return ""


def is_kit_process(pid: int) -> bool:
    """pid 活着且命令行里含 mineru-kit 才算我们的。

    命令行读不到时退回按映像名判断（tasklist）：宁可多问一次，也不对来路不明的
    pid 动手 —— 用户在 8000 上自己起的实例不能被这里误杀。
    """
    if not pid_alive(pid):
        return False
    cmdline = process_cmdline(pid)
    if cmdline:
        return KIT_MARKER in cmdline.lower()
    if os.name == "nt":
        try:
            done = subprocess.run(
                ["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"],
                capture_output=True,
                timeout=20,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError):
            return False
        name = _decode(done.stdout).strip().strip('"').split('","')[0].lower()
        return KIT_MARKER in name
    return False


def kill_tree(pid: int) -> bool:
    """树杀：PyInstaller 的 exe 会转手给 python.exe，还会开 multiprocessing 子进程。"""
    if not pid_alive(pid):
        return False
    if os.name == "nt":
        try:
            done = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=30,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return done.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        return True
    except OSError:
        return False


def health_ok(port: int, timeout: float = 2.0) -> bool:
    url = "http://127.0.0.1:%d/v1/health" % port
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= int(getattr(response, "status", 0)) < 300
    except Exception:  # 连不上 / 非 2xx / 超时都算「还没好」
        return False


def _write_state(path: Path, payload: dict) -> None:
    """先写临时文件再替换：App 那边随时可能在读，不能让它读到半个 JSON。"""
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _read_state(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _remove_state(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


# ── 守护主体 ────────────────────────────────────────────────────────


class Supervisor:
    def __init__(self, kit: Path, port: int, idle_seconds: float, state_dir: Path) -> None:
        self.kit = kit
        self.port = port
        self.idle_seconds = idle_seconds
        self.state_dir = state_dir
        self.state_path = state_dir / STATE_FILE
        self.activity_path = state_dir / ACTIVITY_FILE
        self.log = _Log(state_dir / LOG_FILE)
        self.child: subprocess.Popen | None = None
        self.started_at = time.time()
        self.stop_reason: str | None = None
        self._pump_threads: list[threading.Thread] = []

    # ---- 信号与父进程 ----

    def install_signals(self) -> None:
        def handler(signum, _frame):
            self.stop_reason = "收到信号 %s" % signum

        for name in ("SIGTERM", "SIGINT", "SIGBREAK"):
            sig = getattr(signal, name, None)
            if sig is None:
                continue
            try:
                signal.signal(sig, handler)
            except (OSError, ValueError):
                continue

    # ---- 起子进程 ----

    def spawn_child(self) -> None:
        argv = [str(self.kit), "api-server", "--host", "127.0.0.1", "--port", str(self.port)]
        kwargs: dict = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            # 工作目录钉在 state-dir：子进程要是往相对路径扔临时文件，也落在我们自己的
            # 目录里，而不是 App 进程的 cwd。
            "cwd": str(self.state_dir),
        }
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        else:
            kwargs["start_new_session"] = True
        self.log.write("启动 mineru-kit: %s" % " ".join(argv))
        self.child = subprocess.Popen(argv, **kwargs)
        self.log.write("mineru-kit 已拉起，pid=%d" % self.child.pid)

    def pump_output(self) -> None:
        """把子进程输出逐行写进 service.log（带时间戳）。"""
        stream = self.child.stdout if self.child else None
        if stream is None:
            return

        def run() -> None:
            for raw in iter(stream.readline, b""):
                text = _decode(raw).rstrip("\r\n")
                if text:
                    self.log.write("kit | %s" % text)
            try:
                stream.close()
            except OSError:
                pass

        thread = threading.Thread(target=run, name="kit-output", daemon=True)
        thread.start()
        self._pump_threads.append(thread)

    def write_state(self) -> None:
        payload = {
            "pid": os.getpid(),
            "child_pid": self.child.pid if self.child else None,
            "port": self.port,
            "kit": str(self.kit),
            "started_at": datetime.fromtimestamp(self.started_at).astimezone().isoformat(timespec="seconds"),
        }
        _write_state(self.state_path, payload)

    # ---- 等 health ----

    def wait_health(self, parent_pid: int) -> str | None:
        """返回 None 表示健康；否则返回失败原因。"""
        deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self.stop_reason:
                return self.stop_reason
            if not pid_alive(parent_pid):
                return "父进程已退出"
            code = self.child.poll() if self.child else -1
            if code is not None:
                return "mineru-kit 启动后退出，退出码 %s" % code
            if health_ok(self.port):
                elapsed = time.time() - self.started_at
                self.log.write("health 通过，端口 %d，用时 %.1fs" % (self.port, elapsed))
                return None
            time.sleep(HEALTH_POLL_SECONDS)
        return "等 health 超时（%ds）" % int(HEALTH_TIMEOUT_SECONDS)

    # ---- 空闲循环 ----

    def idle_tick_seconds(self) -> float:
        if self.idle_seconds <= 0:
            return IDLE_TICK_SECONDS
        return max(0.2, min(IDLE_TICK_SECONDS, self.idle_seconds / 4.0))

    def last_activity(self) -> float:
        """activity 的 mtime；文件不在或比启动时刻还早，就按启动时刻算。

        supervisor 只读 activity，不写，所以「App 还没 touch 过」这件事得靠自己兜。
        """
        try:
            mtime = self.activity_path.stat().st_mtime
        except OSError:
            return self.started_at
        return max(mtime, self.started_at)

    def loop(self, parent_pid: int) -> int:
        tick = self.idle_tick_seconds()
        while True:
            if self.stop_reason:
                return self.finish(self.stop_reason, 0)
            if not pid_alive(parent_pid):
                return self.finish("父进程已退出", 0)
            code = self.child.poll() if self.child else -1
            if code is not None:
                return self.finish("mineru-kit 已退出，退出码 %s（不重启）" % code, 1)
            if self.idle_seconds > 0:
                idle = time.time() - self.last_activity()
                if idle > self.idle_seconds:
                    return self.finish("空闲 %.0fs 超过阈值 %.0fs" % (idle, self.idle_seconds), 0)
            time.sleep(tick)

    # ---- 收工 ----

    def finish(self, reason: str, code: int) -> int:
        self.log.write("收工：%s" % reason)
        record = _read_state(self.state_path)
        # service.json 只有在自己还是记录的主人时才可信：换了主人说明有另一个
        # supervisor 接管了同一个 state-dir，那份记录里的 pid 跟我们没关系。
        owned = bool(record) and record.get("pid") == os.getpid()
        candidates: list[int] = []
        if self.child is not None:
            candidates.append(int(self.child.pid))
        if owned:
            recorded = record.get("child_pid")
            if recorded and int(recorded) not in candidates:
                candidates.append(int(recorded))

        for pid in candidates:
            # 逐个过一遍身份：命令行含 mineru-kit 才动手。用户在 8000 上自己起的
            # 实例、以及 pid 被系统回收后指到的无关进程，都在这里被挡下来。
            if is_kit_process(pid):
                self.log.write("树杀 mineru-kit（pid=%s）" % pid)
                if not kill_tree(pid):
                    self.log.write("树杀失败（pid=%s），请手工检查" % pid)
            else:
                self.log.write("pid=%s 已不在或命令行不含 mineru-kit，不动它" % pid)

        if self.child is not None:
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        if owned or not record:
            _remove_state(self.state_path)
            self.log.write("service.json 已删除")
        else:
            self.log.write("service.json 属于另一个 supervisor（pid=%s），不删" % record.get("pid"))
        self.log.write("supervisor 退出（退出码 %d）" % code)
        self.log.close()
        return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MinerU 本地服务守护脚本")
    parser.add_argument("--kit", required=True, help="mineru-kit 可执行文件完整路径")
    parser.add_argument("--port", type=int, required=True, help="监听端口")
    parser.add_argument("--idle-seconds", type=float, default=300.0,
                        help="空闲多少秒后卸载；<=0 表示只等 App 显式喊停")
    parser.add_argument("--state-dir", required=True, help="service.json / service.log 所在目录")
    args = parser.parse_args(argv)

    kit = Path(args.kit)
    if not kit.is_file():
        # 不给 argparse 报参数错误：这条是「路径写了但不对」，话术要说人话。
        print("mineru-kit 路径无效: %s" % args.kit, file=sys.stderr)
        return 2

    state_dir = Path(args.state_dir)
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print("state-dir 不可用: %s（%s）" % (args.state_dir, exc), file=sys.stderr)
        return 2

    parent_pid = os.getppid()
    supervisor = Supervisor(kit, args.port, args.idle_seconds, state_dir)
    supervisor.install_signals()
    supervisor.log.write(
        "supervisor 启动 pid=%d port=%d idle=%.0fs parent=%d"
        % (os.getpid(), args.port, args.idle_seconds, parent_pid)
    )

    try:
        supervisor.spawn_child()
    except OSError as exc:
        supervisor.log.write("拉起 mineru-kit 失败: %s" % exc)
        _remove_state(supervisor.state_path)
        supervisor.log.close()
        return 1

    supervisor.write_state()
    supervisor.pump_output()

    failure = supervisor.wait_health(parent_pid)
    if failure:
        supervisor.log.write("health 未通过：%s" % failure)
        return supervisor.finish(failure, 1)

    return supervisor.loop(parent_pid)


if __name__ == "__main__":
    sys.exit(main())
