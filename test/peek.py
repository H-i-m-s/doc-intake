"""文件诊断：一个 Office 文件里到底有哪些公式、什么格式、能不能转出来。

用法:
    python inspect.py 文件.docx              # 概况 + 逐个对象
    python inspect.py 文件.docx --tree 0     # 另外打印第 0 个对象的 MTEF 记录树

看点:
- 判断「是不是 MathType」只看 document.xml / slideN.xml 里的 ProgID：
  Equation.DSMT4/6/7 → MathType（MTEF v5）；Equation.3 → 老 Equation Editor（v3）；
  别的 ProgID（例如 LaTeXSnipper.*）不在处理范围内，里面的流不是 Equation Native。
- 每个嵌入流的大小、Equation Native 头、MTEF 版本号，以及转出来的 LaTeX。
"""

from __future__ import annotations

import os
import sys
import zipfile

import _common as C


def inspect(path: str, tree_index=None) -> int:
    print(f"\n=== {os.path.basename(path)} ===")
    try:
        ids = C.progids(path)
    except (zipfile.BadZipFile, FileNotFoundError) as e:
        print(f"  打不开：{type(e).__name__}")
        return 1

    if not ids:
        print("  没有任何 OLE 对象（可能是 Word 自带公式 OMML 文档）")
        return 0
    print("  公式程序（ProgID）：")
    for progid, where in ids.items():
        print(f"    {progid}  → {C.classify(progid)}  [{len(where)} 处]")

    names = C.embeddings(path)
    if not names:
        print("  没有 embeddings/*.bin")
        return 0

    with zipfile.ZipFile(path) as zf:
        for i, name in enumerate(names):
            data = zf.read(name)
            version, body = C.ole_mtef(data)
            head = f"  [{i}] {name.rsplit('/', 1)[-1]:<18} {len(data):>7} 字节"
            if version is None:
                print(head + "  → 读不到 Equation Native / MTEF 体")
                continue
            res = C.convert(body, version)
            print(head + f"  → MTEF v{version}  " +
                  ("转出 " + res["latex"][:60] if res["latex"]
                   else "退回预览图（" + (res.get("reason") or "") + "）"))
            if tree_index == i:
                print_tree(body, version)

    return 0


def print_tree(body: bytes, version: int) -> None:
    if version != 5:
        print("    （记录树打印只支持 v5）")
        return
    import mtef_v5

    eq = mtef_v5.parse(body)
    print(f"    MTEF v5 记录树：consumed={eq.consumed} total={eq.total} "
          f"complete={eq.complete} errors={eq.errors[:3]}")
    mtef_v5._print_tree(getattr(eq, "records", []), depth=2, limit=400)


def main(argv) -> int:
    tree_index = None
    if "--tree" in argv:
        i = argv.index("--tree")
        try:
            tree_index = int(argv[i + 1])
            del argv[i:i + 2]
        except (IndexError, ValueError):
            print("--tree 后面要跟一个对象序号")
            return 1
    tgts = C.targets(argv)
    if not tgts:
        print("没有可看的文件")
        return 1
    rc = 0
    for t in tgts:
        rc |= inspect(t, tree_index)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
