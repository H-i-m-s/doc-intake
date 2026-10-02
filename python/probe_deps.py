"""依赖探测脚本（供 App 设置页的「环境依赖管理」卡片调用）。

从 stdin 读入一份模块清单（JSON），逐个判断该模块在做完环境里能不能导入、
拿到什么版本，再把结果以 JSON 写到 stdout。只做只读探测，不安装任何东西。

输入（stdin）：
  [
    {"id": "pillow", "module": "PIL", "dists": ["Pillow"]},
    {"id": "pymupdf", "module": "fitz", "dists": ["PyMuPDF", "fitz"]},
    ...
  ]

输出（stdout）：
  {"ok": true, "python": "3.11.9", "executable": "...", "results": [
      {"id": "pillow", "installed": true, "version": "10.2.0", "error": null},
      {"id": "mineru", "installed": false, "version": null, "error": "ModuleNotFoundError: ..."}
  ]}

探测策略：优先用 importlib.util.find_spec（快、不执行模块代码），失败再退回真实
导入兜底；版本优先取 importlib.metadata（发行名），取不到时再读模块的 __version__。
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import sys


def _module_version(module_name: str):
    """真实导入模块，尝试读 __version__ / VERSION。取不到返回 None。"""
    try:
        mod = importlib.import_module(module_name)
    except Exception:
        return None
    for attr in ("__version__", "VERSION", "version"):
        value = getattr(mod, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _dist_version(dists):
    """按发行名从 importlib.metadata 取版本，任一命中即返回。"""
    try:
        from importlib import metadata
    except Exception:
        return None
    for dist in dists or []:
        try:
            return metadata.version(dist)
        except Exception:
            continue
    return None


def _find_spec(module_name: str):
    """返回 (found, error)。found 为 None 表示判定不了（交给真实导入兜底）。"""
    try:
        spec = importlib.util.find_spec(module_name)
    except Exception as exc:  # 包结构损坏时 find_spec 会直接抛
        return None, f"{type(exc).__name__}: {exc}"
    return (spec is not None), None


def probe_one(item: dict) -> dict:
    item_id = str(item.get("id") or item.get("module") or "")
    module_name = str(item.get("module") or "")
    dists = item.get("dists") or []
    if not module_name:
        return {"id": item_id, "installed": False, "version": None, "error": "缺少 module 名"}

    found, spec_error = _find_spec(module_name)
    error = None

    if found is None:
        # 判定不了，退回真实导入
        try:
            importlib.import_module(module_name)
            found = True
        except Exception as exc:
            found = False
            error = f"{type(exc).__name__}: {exc}"
        if spec_error and not found and not error:
            error = spec_error

    if found:
        version = _dist_version(dists)
        if not version:
            version = _module_version(module_name)
        return {"id": item_id, "installed": True, "version": version, "error": None}

    if not error:
        error = f"未安装（找不到模块 {module_name}）"
    return {"id": item_id, "installed": False, "version": None, "error": error}


def main() -> None:
    raw = ""
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
    except (OSError, ValueError):
        raw = ""

    try:
        items = json.loads(raw) if raw and raw.strip() else []
    except (ValueError, TypeError) as exc:
        print(json.dumps({"ok": False, "error": f"输入清单解析失败: {exc}"}, ensure_ascii=False))
        sys.exit(1)

    if not isinstance(items, list):
        print(json.dumps({"ok": False, "error": "输入清单必须是数组"}, ensure_ascii=False))
        sys.exit(1)

    results = [probe_one(item if isinstance(item, dict) else {}) for item in items]
    payload = {
        "ok": True,
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "executable": sys.executable,
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
