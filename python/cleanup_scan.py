"""扫描保存目录，找出超过保留时长的提取产出。

和 list_sources.py 同样的理由：v2 App 的 JS 进程跑在 Node Permission Model 下，
裸 fs 读许可根以外的路径会被拒，而保存目录是用户自己填的，基本都在许可根外。
所以目录枚举与时间判断放在被 spawn 的 Python 子进程里做。

这里只负责「找出来」，不负责删。删除由 JS 侧调用宿主的回收站接口完成，
那条路径走的是 Electron 主进程，能把文件放进系统回收站，而不是直接抹掉。

输入：stdin 上的 JSON 对象
      {"dir": "...", "keepMs": 259200000, "minAgeMs": 60000, "now": 1699999999999}

输出：stdout 上的 JSON 对象
      {"scanned": 12, "skippedFresh": 2, "groups": [{"key": "...", "members": [...]}]}
      每个 member 带 path / size / mtime，JS 侧照单删除并统计。

退出码：目录不存在或不是目录时退 0 并在结果里写 reason，
       不抛异常 —— 清理是附加动作，不该让调用方处理失败分支。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

MD_SUFFIX = ".md"
JSON_SUFFIX = ".json"
MEDIA_SUFFIX = "_media"

# 默认保存目录的名字。它专供本插件写，可以按宽松规则认定里面的 .md 都是产出。
OWN_DIR_NAME = "doc-intake"


def default_save_path() -> Path:
    """savePath 留空时的默认位置，和 main.py 的算法保持一致。

    这段判断要放在 Python 里：JS 侧探测 Documents 目录存在性会被权限拒掉，
    算出来的路径会和真正的保存目录对不上，等于去清一个不存在的目录。
    """
    home = Path.home()
    docs = home / "Documents"
    return (docs if docs.is_dir() else home) / OWN_DIR_NAME


def media_dir_name(md_base: str) -> str:
    """<主体>.md 对应的媒体目录名：砍掉源文件扩展名后接 _media。

    例：06第五章.pptx.md -> 06第五章_media
        v1.2 报告.pdf.md  -> v1.2 报告_media
        报告.md           -> 报告_media
    """
    dot = md_base.rfind(".")
    stem = md_base[:dot] if dot > 0 else md_base
    return stem + MEDIA_SUFFIX


def entry_size(target: Path) -> int:
    """文件取自身大小，目录递归累加。读不了的部分按 0 计，只影响展示的数字。"""
    try:
        if target.is_file():
            return target.stat().st_size
        total = 0
        for child in target.iterdir():
            total += entry_size(child)
        return total
    except OSError:
        return 0


def collect(dir_path: Path, keep_ms: int, min_age_ms: int, now: int) -> dict:
    loose = dir_path.name == OWN_DIR_NAME
    try:
        names = [child.name for child in dir_path.iterdir()]
    except OSError as error:
        return {"scanned": 0, "skippedFresh": 0, "groups": [], "reason": f"读不了目录：{error}"}

    present = set(names)
    groups: list[dict] = []
    skipped_fresh = 0

    for name in sorted(names):
        if not name.endswith(MD_SUFFIX):
            continue
        base = name[: -len(MD_SUFFIX)]
        members = [dir_path / name]

        json_name = base + JSON_SUFFIX
        if json_name in present:
            members.append(dir_path / json_name)

        media_name = media_dir_name(base)
        media_path = dir_path / media_name
        if media_name in present and media_path.is_dir():
            members.append(media_path)

        # 非本插件专用目录时，至少要两样对得上才认这是产出：
        # 单看一个 .md 无法和用户自己写的 Markdown 区分开。
        if not loose and len(members) < 2:
            continue

        mtimes = []
        for member in members:
            try:
                mtimes.append(int(member.stat().st_mtime * 1000))
            except OSError:
                continue
        if not mtimes:
            continue
        newest = max(mtimes)

        # 刚写出来的放过：保留时长设得很短时，同一批任务里先完成的文件
        # 到收尾那一刻已经「过期」了，不该被自己的清理顺手带走。
        if now - newest < min_age_ms:
            skipped_fresh += 1
            continue
        if now - newest < keep_ms:
            continue

        groups.append({
            "key": base,
            "newest": newest,
            "members": [
                {"path": str(member), "size": entry_size(member)}
                for member in members
            ],
        })

    return {"scanned": len(groups), "skippedFresh": skipped_fresh, "groups": groups, "reason": ""}


def main() -> None:
    try:
        raw = sys.stdin.read().lstrip("\ufeff")
        payload = json.loads(raw or "{}")
    except (ValueError, UnicodeDecodeError):
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    dir_value = payload.get("dir")
    keep_ms = payload.get("keepMs")
    min_age_ms = payload.get("minAgeMs")
    now = payload.get("now")

    if not isinstance(keep_ms, (int, float)) or keep_ms <= 0:
        sys.stdout.write(json.dumps({"scanned": 0, "skippedFresh": 0, "groups": [], "reason": "保留时长不是正数"}, ensure_ascii=False))
        return
    if not isinstance(now, (int, float)):
        import time
        now = int(time.time() * 1000)
    if not isinstance(min_age_ms, (int, float)) or min_age_ms < 0:
        min_age_ms = 0

    # 留空就用默认目录。实际用的是哪个目录会一并回传，JS 侧靠它做安全判断。
    if isinstance(dir_value, str) and dir_value.strip():
        dir_path = Path(dir_value.strip())
    else:
        dir_path = default_save_path()

    if not dir_path.is_dir():
        sys.stdout.write(json.dumps({
            "scanned": 0, "skippedFresh": 0, "groups": [],
            "dir": str(dir_path), "reason": "保存路径不存在",
        }, ensure_ascii=False))
        return

    result = collect(dir_path, int(keep_ms), int(min_age_ms), int(now))
    result["dir"] = str(dir_path)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
