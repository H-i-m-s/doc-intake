"""v15 回收站判卷自测：删之前先看这个卷有没有回收站。

用法：python -m test.selftest_v15_recycle

覆盖：
  1. 网络位置（UNC）判为跳过，理由是「网络位置没有回收站」。
  2. 本机固定盘（系统盘与保存目录所在盘）判为可删，理由为空。
  3. 不存在的文件进 failed 而不是 skipped，并且不抛异常。
  4. 传入空列表返回空结果，不炸。
  5. CLI 的 check 模式只判不删（返回 path → reason 的映射）。
  6. 非 Windows 上判卷一律给理由（不会静默地永久删除）。

不真的删东西：这一套只验判据。要验「真能删进回收站」得靠人手，
因为那会往用户回收站里丢文件。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

import recycle  # noqa: E402


class Checker:
    def __init__(self) -> None:
        self.ok = 0
        self.bad = 0

    def check(self, name: str, passed: bool, detail: str = "") -> None:
        if passed:
            self.ok += 1
            print("  ok   %s%s" % (name, ("  " + detail) if detail else ""))
        else:
            self.bad += 1
            print("  FAIL %s%s" % (name, ("  " + detail) if detail else ""))

    def summary(self) -> int:
        print()
        print("通过 %d · 失败 %d" % (self.ok, self.bad))
        return 0 if self.bad == 0 else 1


def case_unc(c: Checker) -> None:
    print("网络位置：")
    for path in (r"\\NAS\share\a.md", r"\\192.168.1.10\docs\b.png"):
        why = recycle.volume_skip_reason(path)
        c.check("UNC 判为跳过：" + path, "网络" in why or "Windows" in why, why or "（空）")


def case_fixed(c: Checker) -> None:
    print("本机固定盘：")
    roots = {os.path.splitdrive(tempfile.gettempdir())[0] + "\\"}
    save_dir = os.environ.get("DOCINTAKE_SAVE_DIR")
    if save_dir:
        roots.add(os.path.splitdrive(os.path.abspath(save_dir))[0] + "\\")
    for root in sorted(roots):
        if not root or root == "\\":
            continue
        why = recycle.volume_skip_reason(os.path.join(root, "no-such-dir", "x.md"))
        c.check("固定盘可删：" + root, why == "", why or "无理由")


def case_missing(c: Checker) -> None:
    print("不存在的文件：")
    nonexistent = os.path.join(tempfile.gettempdir(), "docintake-not-here-9f3a.md")
    out = recycle.trash([nonexistent])
    c.check("进 failed", len(out.get("failed") or []) == 1, json.dumps(out, ensure_ascii=False)[:120])
    c.check("没进 ok", not out.get("ok"))
    c.check("没进 skipped", not out.get("skipped"))


def case_empty(c: Checker) -> None:
    print("空输入：")
    out = recycle.trash([])
    c.check("三个桶都是空的", out == {"ok": [], "skipped": [], "failed": []}, json.dumps(out, ensure_ascii=False))


def case_cli_check(c: Checker) -> None:
    print("CLI check 模式：")
    payload = json.dumps({"check": True, "paths": [r"\\NAS\share\a.md"]})
    proc = subprocess.run(
        [sys.executable, os.path.join(_PY_DIR, "recycle.py")],
        input=payload,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    c.check("退出码 0", proc.returncode == 0, proc.stderr.strip()[:120])
    try:
        parsed = json.loads(proc.stdout)
    except json.JSONDecodeError:
        parsed = None
    c.check("返回映射", isinstance(parsed, dict) and r"\\NAS\share\a.md" in parsed, str(proc.stdout)[:120])
    if isinstance(parsed, dict):
        value = parsed.get(r"\\NAS\share\a.md", "")
        c.check("映射值是理由而不是空", bool(value), value or "（空）")


def case_phantom(c: Checker) -> None:
    print("不存在的盘符：")
    # Z: 在本机几乎肯定没挂，用来验「认不出的卷一律拒」。
    why = recycle.volume_skip_reason(r"Z:\docintake\x.md")
    if os.path.exists("Z:\\"):
        print("  Z: 存在，跳过这条")
        return
    c.check("不存在的卷判为跳过", bool(why), why or "（空）")


def case_platform(c: Checker) -> None:
    print("平台：")
    if sys.platform != "win32":
        why = recycle.volume_skip_reason(os.path.join(tempfile.gettempdir(), "a.md"))
        c.check("非 Windows 一律给理由", bool(why), why or "（空）")
    else:
        c.check("Windows 上 SHFileOperation 可用", hasattr(recycle, "trash"))


def self_test() -> int:
    print("回收站判卷自测（python/recycle.py）")
    c = Checker()
    case_unc(c)
    case_fixed(c)
    case_missing(c)
    case_phantom(c)
    case_empty(c)
    case_cli_check(c)
    case_platform(c)
    return c.summary()


if __name__ == "__main__":
    sys.exit(self_test())
