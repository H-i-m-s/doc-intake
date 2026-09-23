"""公式体检：把一个 docx/pptx 里每个 MathType 公式对象走一遍，报明细。

用法:
    python audit.py                  # 看样本目录（app 自带）
    python audit.py 文件或目录 ...    # 看指定文件/整目录，可以传多个

每个对象一行：MTEF 版本、能不能转出 LaTeX、退回时给出原因。
末尾汇总，并单独点出「空壳对象」——嵌入流读不到 MTEF 体的那些
（实测过：MathType 有时会留下 0 字节的 Equation Native 流）。
"""

from __future__ import annotations

import os
import sys
import zipfile

import _common as C


def audit_blob(path: str):
    """不是 OOXML 的输入：当成一个裸 OLE 对象看（例如从文档里抠出来的 .bin）。"""
    with open(path, "rb") as f:
        data = f.read()
    version, body = C.ole_mtef(data)
    if version is None:
        print(f"  空壳/不是 MathType（{len(data)} 字节）")
        return 0, 0, 1
    res = C.convert(body, version)
    print(f"  {os.path.basename(path):<18} {C.one_line(res)}")
    ok = 1 if res["latex"] else 0
    return ok, 1 - ok, 0


def audit(path: str):
    print(f"\n=== {os.path.basename(path)} ===")
    try:
        names = C.embeddings(path)
    except zipfile.BadZipFile:
        return audit_blob(path)
    except FileNotFoundError:
        print("  文件不存在，跳过")
        return 0, 0, 0

    if not names:
        print("  没有 MathType 嵌入对象")
        return 0, 0, 0

    ok = fall = empty = 0
    with zipfile.ZipFile(path) as zf:
        for name in names:
            data = zf.read(name)
            version, body = C.ole_mtef(data)
            short = name.rsplit("/", 1)[-1]
            if version is None:
                empty += 1
                print(f"  {short:<18} 空壳/不是 MathType（嵌入流 {len(data)} 字节）")
                continue
            res = C.convert(body, version)
            if res["latex"]:
                ok += 1
            else:
                fall += 1
            print(f"  {short:<18} {C.one_line(res)}")

    print(f"  —— 共 {len(names)} 个对象：转出 {ok}、退回 {fall}、空壳 {empty}")
    return ok, fall, empty


def main(argv) -> int:
    tgts = C.targets(argv)
    if not tgts:
        print("没有可看的文件（样本目录是空的？）")
        return 1
    total = [0, 0, 0]
    for t in tgts:
        a, b, c = audit(t)
        total = [total[0] + a, total[1] + b, total[2] + c]
    if len(tgts) > 1:
        print(f"\n合计 {len(tgts)} 个文件：转出 {total[0]}、退回 {total[1]}、空壳 {total[2]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
