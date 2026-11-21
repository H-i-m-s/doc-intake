"""支持格式的唯一权威来源：仓库根的 formats.json。

为什么要这一层：扩展名清单以前散在四处（目录准入、Python 细类型、JS 粗类型、describe
回给调用方的格式表），改一处漏三处，漏了还不报错——目录里静默丢掉、类型落到 unknown。
现在只有 formats.json 一份，Python 与 JS 都从它派生。

外层键是粗类（pdf / image / office / html），内层是「扩展名 -> 细类型」：
  - 粗类给 JS 用（file-checker 的四值、describe 的格式表）
  - 细类型给 Python 用（挑本地提取器）
pdf 与 image 两个粗类走云端后端，其余粗类走本地提取器。

读不到就抛异常，不留内联兜底：留一份兜底等于清单又变成两份，漂移的那一份永远没人发现。
"""
from __future__ import annotations

import json
from pathlib import Path

FORMATS_PATH = Path(__file__).resolve().parent.parent / "formats.json"


def _load(path: Path) -> dict[str, dict[str, str]]:
    """读并粗校验 formats.json：结构不对就直接报错并带上路径。"""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到格式清单：{path}（它随包发布，缺了整条解析链都不知道支持什么）") from exc
    except OSError as exc:
        raise RuntimeError(f"读不到格式清单：{path}（{exc}）") from exc
    except ValueError as exc:
        raise RuntimeError(f"格式清单不是合法 JSON：{path}（{exc}）") from exc

    if not isinstance(raw, dict) or not raw:
        raise RuntimeError(f"格式清单结构不对：{path} 的外层应当是「粗类 -> {{扩展名: 细类型}}」对象")
    for category, table in raw.items():
        if not isinstance(table, dict):
            raise RuntimeError(f"格式清单结构不对：{path} 里粗类 {category} 的值不是对象")
        for ext, type_name in table.items():
            if not isinstance(ext, str) or not ext.startswith("."):
                raise RuntimeError(f"格式清单里的扩展名不合法：{path} 里粗类 {category} 下的 {ext!r}")
            if not isinstance(type_name, str) or not type_name.strip():
                raise RuntimeError(f"格式清单里的细类型为空：{path} 里 {category} -> {ext}")
    return raw


_TABLE = _load(FORMATS_PATH)

#: 全部扩展名（含点、小写）
SUPPORTED_EXTS: set[str] = {ext for table in _TABLE.values() for ext in table}
#: 扩展名 -> 细类型（Python 侧挑提取器用）
TYPE_BY_EXT: dict[str, str] = {ext: name for table in _TABLE.values() for ext, name in table.items()}
#: 扩展名 -> 粗类
CATEGORY_BY_EXT: dict[str, str] = {
    ext: category for category, table in _TABLE.items() for ext in table
}


def category_of(ext: str) -> str | None:
    """扩展名属于哪个粗类；不认识返回 None。"""
    return CATEGORY_BY_EXT.get(str(ext).lower())
