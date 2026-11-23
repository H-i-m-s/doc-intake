"""把文件与目录放进系统回收站（可撤销）。

为什么不用宿主的 resources.trash：那条路在 Windows 上是把文件 rename 进
~/.hanako/trash，保存目录在别的盘（D:）时会直接 EXDEV 失败——回收站按卷存在，
跨卷 rename 本来就不允许。这里直接调 shell32 的 SHFileOperationW + FOF_ALLOWUNDO，
交给系统自己的回收站处理，跨卷由系统按目标卷的 $RECYCLE.BIN 处理。

stdin: {"paths": ["D:\\a\\b.md", ...]}
stdout: {"ok": [...], "failed": [{"path": "...", "error": "..."}]}
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


def trash(paths: list[str]) -> dict:
    result: dict = {"ok": [], "failed": []}
    if sys.platform != "win32":
        return {
            "ok": [],
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
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": [], "failed": [{"path": "", "error": f"输入解析失败: {exc}"}]}, ensure_ascii=False))
        return 0
    paths = payload.get("paths") if isinstance(payload, dict) else None
    if not isinstance(paths, list) or not paths:
        print(json.dumps({"ok": [], "failed": []}, ensure_ascii=False))
        return 0
    print(json.dumps(trash([str(p) for p in paths]), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
