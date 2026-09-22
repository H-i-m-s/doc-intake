"""展开 doc-intake 的 source 列表。

v2 App 的 JS 进程跑在 Node Permission Model 下，裸 fs 读许可根以外的路径会被拒。
文件系统相关的工作统一交给被 spawn 出来的 Python 子进程（它不受该限制）。

输入：stdin 上的一个 JSON 数组（原始 source 路径，可含目录）。
输出：stdout 上的 JSON 对象 {"sources": [...]}，目录展开为受支持的文件，
     不支持的后缀与无效路径按 v1 语义静默跳过。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SUPPORTED_EXTS = {
    ".pdf", ".doc", ".docx", ".pptx", ".ppt", ".xls", ".xlsx", ".xlsm",
    ".html", ".htm",
    ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif",
}


def expand(paths: object) -> list[str]:
    if not isinstance(paths, list):
        return []
    result: list[str] = []
    for raw in paths:
        if not isinstance(raw, str) or not raw.strip():
            continue
        target = Path(raw)
        try:
            if target.is_dir():
                for child in sorted(target.iterdir()):
                    if child.is_file() and child.suffix.lower() in SUPPORTED_EXTS:
                        result.append(str(child))
            elif target.is_file() and target.suffix.lower() in SUPPORTED_EXTS:
                result.append(str(target))
        except OSError:
            continue
    return result


def main() -> None:
    try:
        raw = sys.stdin.read().lstrip("\ufeff")
        payload = json.loads(raw or "[]")
    except (ValueError, UnicodeDecodeError):
        payload = []
    sys.stdout.write(json.dumps({"sources": expand(payload)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
