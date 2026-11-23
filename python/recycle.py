"""把文件与目录放进系统回收站（可撤销）。

为什么不用宿主的 resources.trash：那条路在 Windows 上是把文件 rename 进
~/.hanako/trash，保存目录在别的盘（D:）时会直接 EXDEV 失败——回收站按卷存在，
跨卷 rename 本来就不允许。这里直接调 shell32 的 SHFileOperationW + FOF_ALLOWUNDO，
交给系统自己的回收站处理，跨卷由系统按目标卷的 $RECYCLE.BIN 处理。

还有一层：不是每个卷都有可用的回收站。网络位置根本没有，移动盘常常没有，
被策略设成「删除时直接丢弃」的盘有目录但不会往里放。这些情况下
SHFileOperation 会静默地永久删除，那就不是「移到回收站」了。所以删之前
先判卷，判不过就跳过，一个字也不删。

stdin: {"paths": ["D:\\a\\b.md", ...]}
stdout: {"ok": [...], "skipped": [{"path","reason"}], "failed": [{"path","error"}]}
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
from ctypes import wintypes

FO_DELETE = 0x0003
FOF_SILENT = 0x0004
FOF_NOCONFIRMATION = 0x0010
FOF_ALLOWUNDO = 0x0040
FOF_NOCONFIRMMKDIR = 0x0200
FOF_NOERRORUI = 0x0400

DRIVE_FIXED = 3
RECYCLE_DIR = "$RECYCLE.BIN"


class _SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("wFunc", wintypes.UINT),
        ("pFrom", wintypes.LPCWSTR),
        ("pTo", wintypes.LPCWSTR),
        ("fFlags", wintypes.WORD),
        ("fAnyOperationsAborted", wintypes.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wintypes.LPCWSTR),
    ]


def _volume_root(path: str) -> str:
    drive = os.path.splitdrive(os.path.abspath(path))[0]
    return (drive + "\\") if drive else ""


def _volume_guid(root: str) -> str:
    """``D:\\`` → ``{e5f2...}``。拿不到就返回空串。"""
    if not root:
        return ""
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        buf = ctypes.create_unicode_buffer(64)
        ok = kernel32.GetVolumeNameForVolumeMountPointW(ctypes.c_wchar_p(root), buf, 64)
    except OSError:
        return ""
    if not ok:
        return ""
    name = buf.value  # \\?\Volume{e5f2...}\
    if name.startswith("\\\\?\\Volume"):
        name = name[len("\\\\?\\Volume") :]
    return name.strip("\\")


def _nuke_on_delete(guid: str) -> bool:
    """这个卷是不是被设成「删除时直接丢弃」。"""
    if not guid:
        return False
    try:
        import winreg
    except ImportError:
        return False
    key = rf"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\{guid}"
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as handle:
            value, _ = winreg.QueryValueEx(handle, "NukeOnDelete")
        return bool(int(value))
    except (OSError, ValueError):
        return False


def volume_skip_reason(path: str) -> str:
    """这个路径能不能安全地「移入回收站」。能就返回空串，不能返回一句人话。"""
    if sys.platform != "win32":
        return "SHFileOperation 只在 Windows 上可用"
    if str(path).startswith("\\\\"):
        return "网络位置没有回收站"
    root = _volume_root(path)
    if not root:
        return "认不出这个路径在哪个盘"
    try:
        drive_type = ctypes.WinDLL("kernel32", use_last_error=True).GetDriveTypeW(ctypes.c_wchar_p(root))
    except OSError:
        drive_type = 0
    if drive_type != DRIVE_FIXED:
        return "该盘不是固定磁盘，可能没有回收站"
    bin_dir = os.path.join(root, RECYCLE_DIR)
    if not os.path.isdir(bin_dir):
        return "该盘根目录下没有回收站"
    if not os.access(bin_dir, os.W_OK):
        return "该盘的回收站不可写"
    if _nuke_on_delete(_volume_guid(root)):
        return "该盘被设成删除时直接丢弃"
    return ""


def trash(paths: list[str]) -> dict:
    result: dict = {"ok": [], "skipped": [], "failed": []}
    if sys.platform != "win32":
        return {
            "ok": [],
            "skipped": [],
            "failed": [{"path": str(p), "error": "SHFileOperation 只在 Windows 上可用"} for p in paths],
        }

    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.SHFileOperationW.argtypes = [ctypes.POINTER(_SHFILEOPSTRUCTW)]
    shell32.SHFileOperationW.restype = ctypes.c_int

    for raw in paths:
        path = os.path.abspath(str(raw))
        if not os.path.exists(path):
            result["failed"].append({"path": path, "error": "文件已经不在了"})
            continue
        skip = volume_skip_reason(path)
        if skip:
            result["skipped"].append({"path": path, "reason": skip})
            continue
        # 多重字符串以空串收尾：path + "\0" 之后那个 \0 由 create_unicode_buffer 补。
        buffer = ctypes.create_unicode_buffer(path + "\0", len(path) + 2)
        op = _SHFILEOPSTRUCTW()
        op.hwnd = None
        op.wFunc = FO_DELETE
        op.pFrom = ctypes.cast(buffer, wintypes.LPCWSTR)
        op.pTo = None
        op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_NOCONFIRMMKDIR
        code = shell32.SHFileOperationW(ctypes.byref(op))
        if code == 0 and not op.fAnyOperationsAborted and not os.path.exists(path):
            result["ok"].append(path)
        else:
            result["failed"].append(
                {"path": path, "error": f"SHFileOperation 返回 {code}，aborted={bool(op.fAnyOperationsAborted)}"}
            )
    return result


def main() -> int:
    try:
        # 用 utf-8-sig 解：PowerShell 的管道会偷偷加 BOM，普通的 utf-8 会直接报错。
        raw = sys.stdin.buffer.read().decode("utf-8-sig", "replace")
        payload = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": [], "skipped": [], "failed": [{"path": "", "error": f"输入解析失败: {exc}"}]}, ensure_ascii=False))
        return 0
    if isinstance(payload, dict) and payload.get("check"):
        # 只判不删：给自测和排查用。
        out = {str(p): volume_skip_reason(str(p)) for p in payload.get("paths") or []}
        print(json.dumps(out, ensure_ascii=False))
        return 0
    paths = payload.get("paths") if isinstance(payload, dict) else None
    if not isinstance(paths, list) or not paths:
        print(json.dumps({"ok": [], "skipped": [], "failed": []}, ensure_ascii=False))
        return 0
    print(json.dumps(trash([str(p) for p in paths]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
