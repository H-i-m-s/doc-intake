"""鉴权失败账本 —— Python 侧把「某把 Token 被云端拒绝」结构化上报给 Node 侧。

设计：
- 模块级全局账本，进程内共享（并发提取是常态，读写由 threading.Lock 守护）。
- 同一个 (provider, index) 只保留第一条：第一次失败的原因信息量最大。
- 只记脱敏后的 label，绝不落完整 Token；掩码由调用方算好再传进来。
- 不 import key_pool（否则循环导入）。
"""
from __future__ import annotations

import threading

_LOCK = threading.Lock()
_ENTRIES: "dict[tuple[str, int], dict]" = {}


def record(provider: str, index: int, label: str, reason: str) -> None:
    """记录一次鉴权拒绝。同一个 (provider, index) 只保留第一次。

    Args:
        provider: "mineru" 或 "paddleocr"。
        index: 这把 Token 在用户配置列表里的序号（从 1 开始）。
        label: 已脱敏的 Token（掩码由调用方算好），绝不能含完整 Token。
        reason: 一句简短人话（已脱敏），如 "Token 已过期"。
    """
    if not provider:
        return
    try:
        idx = int(index)
    except (TypeError, ValueError):
        return
    if idx < 1:
        return
    key = (str(provider), idx)
    with _LOCK:
        if key in _ENTRIES:
            return
        _ENTRIES[key] = {
            "provider": str(provider),
            "index": idx,
            "label": str(label or ""),
            "reason": str(reason or ""),
        }


def drain() -> "list[dict]":
    """返回并清空账本。"""
    with _LOCK:
        entries = list(_ENTRIES.values())
        _ENTRIES.clear()
    entries.sort(key=lambda entry: (entry["provider"], entry["index"]))
    return entries
