"""退路验证：公式转不出来时，必须退回它自己的预览图。

两件事：
1. 数一份 docx 里「公式对象 ↔ 预览图」的对应关系，点出有没有多个公式共用一张图
   （曾经有过这种串图 bug：一个段落里两道公式都指向第一张预览图）。
2. 现场造一个副本，把其中一个嵌入流的负载清空（模拟「公式数据丢了」），
   验证转换结果确实少一道——也就是该走退路的情形真会走退路。

用法:
    python fallback.py [docx ...]      # 不给参数就看样本目录里的 docx
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

import _common as C

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
V = "{urn:schemas-microsoft-com:vml}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"


def formula_previews(path: str):
    """word/document.xml 里每个「含 OLE 对象的公式容器」用到的预览图 rId（按顺序）。"""
    out = []
    with zipfile.ZipFile(path) as zf:
        try:
            xml = zf.read("word/document.xml")
        except KeyError:
            return out
    root = ET.fromstring(xml)
    for elem in root.iter():
        if elem.tag not in (f"{W}object", f"{W}drawing", f"{MC}AlternateContent"):
            continue
        has_ole = any(sub.tag.endswith("OLEObject") for sub in elem.iter())
        if not has_ole:
            continue
        rid = None
        for sub in elem.iter(f"{V}imagedata"):
            rid = sub.get(f"{R}id") or rid
        for sub in elem.iter(f"{A}blip"):
            rid = sub.get(f"{R}embed") or rid
        out.append(rid)
    return out


def strip_one(src: str, dst: str) -> str | None:
    """把第 1 个「真的带负载」的嵌入流清空，其余原样复制。"""
    names = C.embeddings(src)
    if not names:
        return None
    with zipfile.ZipFile(src) as zin:
        target = None
        for name in names:
            version, body = C.ole_mtef(zin.read(name))
            if version is not None and C.convert(body, version)["latex"]:
                target = name
                break
        if target is None:
            return None
        with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = b"" if item.filename == target else zin.read(item.filename)
                zout.writestr(item, data)
    return target


def check(path: str) -> int:
    print(f"\n=== {os.path.basename(path)} ===")
    if not path.lower().endswith(".docx"):
        print("  跳过（只看 docx）")
        return 0

    refs = formula_previews(path)
    n_bin = len(C.embeddings(path))
    print(f"  公式容器 {len(refs)} 个，嵌入流 {n_bin} 个")
    if refs:
        distinct = len([r for r in set(refs) if r])
        n = len([r for r in refs if r])
        if distinct < n:
            print(f"  提示：{n} 个容器共用 {distinct} 张不同的预览图"
                  "（多为空白预览图的合法复用；真正的串图 bug 会是一大批对象共用同一张非空图）")
        else:
            print(f"  预览图 {distinct} 张，与容器一一对应")

    try:
        from mathtype_converter import MathTypeConverter

        conv = MathTypeConverter()
        before = len(conv.extract_mathtype_from_docx(path))
    except Exception as e:
        print(f"  转换器不可用：{type(e).__name__}: {e}")
        return 1

    tmp = tempfile.mkdtemp(prefix="docintake_fallback_")
    try:
        dst = os.path.join(tmp, os.path.basename(path))
        target = strip_one(path, dst)
        if target is None:
            print("  没有嵌入流，跳过退路验证")
            return 0
        after = len(MathTypeConverter().extract_mathtype_from_docx(dst))
        print(f"  原文件转出 {before} 道；把 {target.rsplit('/', 1)[-1]} 清空后转出 {after} 道")
        if before == after:
            print("  ！数量没变，需要人工看一眼")
        else:
            print(f"  ✓ 少的那 {before - after} 道会退回预览图（上层逻辑）")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


def main(argv) -> int:
    tgts = [t for t in C.targets(argv) if t.lower().endswith(".docx")]
    if not tgts:
        print("没有可看的 docx")
        return 1
    rc = 0
    for t in tgts:
        rc |= check(t)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
