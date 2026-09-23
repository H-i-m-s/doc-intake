"""test/ 下各脚本共用的部分：定位、找样本、OLE → MTEF 体。

规矩只有一条：这里不许出现任何本机绝对路径。所有位置都从 __file__ 推出来，
所以整个 test/ 目录可以连同 app 一起拷到别的电脑上直接跑。
"""

from __future__ import annotations

import io
import os
import struct
import sys
import zipfile

TEST_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(TEST_DIR)
PY_DIR = os.path.join(APP_DIR, "python")
MT_DIR = os.path.join(PY_DIR, "mathtype")
SAMPLES = os.path.join(MT_DIR, "samples")        # 库自测用的样本
BIN_SAMPLES = os.path.join(TEST_DIR, "samples")  # 本目录自带的小样本

for _p in (PY_DIR, MT_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

OFFICE_EXT = (".docx", ".pptx", ".bin")   # .bin = 从文档里抠出来的单个 OLE 对象


def targets(argv, default_dir=None):
    """给了路径就用给的（文件或目录都行）；没给就看样本目录。"""
    if argv:
        out = []
        for a in argv:
            out.extend(walk(a) if os.path.isdir(a) else [os.path.abspath(a)])
        return out
    return walk(default_dir or SAMPLES)


def walk(d):
    out = []
    for root, _dirs, files in os.walk(d):
        for f in sorted(files):
            if f.lower().endswith(OFFICE_EXT):
                out.append(os.path.join(root, f))
    return sorted(out)


def embeddings(path):
    """列出 zip 里的 MathType 嵌入对象（word/ 与 ppt/ 下的 embeddings/*.bin）。"""
    with zipfile.ZipFile(path) as zf:
        return sorted(n for n in zf.namelist()
                      if n.endswith(".bin") and "/embeddings/" in n)


def ole_mtef(ole_bytes: bytes):
    """OLE 二进制 → (版本号, MTEF 体)。读不到就 (None, None)。

    走 app 自己的 ole_util，跟 mathtype_converter 用的是同一条路。
    Equation Native 头部布局：cbHdr(2) + version(4) + cf(2) + cbSize(4)，
    MTEF 体的首字节就是版本号。
    """
    try:
        from ole_util.ole import Ole

        ole, err = Ole.Open(io.BytesIO(ole_bytes))
        if err or not ole:
            return None, None
        streams, _err = ole.ListDir()
        eq_stream = None
        root_stream = None
        for s in streams or []:
            name = s.Name() if callable(getattr(s, "Name", None)) else getattr(s, "Name", "")
            if "Equation" in str(name):
                eq_stream = s
            if getattr(s, "Type", None) == 5:          # 5 = ROOT
                root_stream = s
        if not eq_stream or not root_stream:
            return None, None
        data = ole.OpenFile(eq_stream, root_stream).read(eq_stream.Size)
        if len(data) < 28:
            return None, None
        cb_hdr = struct.unpack("<H", data[0:2])[0]
        cb_size = struct.unpack("<I", data[8:12])[0]
        body = data[cb_hdr:] if cb_hdr + cb_size > len(data) else data[cb_hdr:cb_hdr + cb_size]
        if not body:
            return None, None
        return body[0], body
    except Exception:
        return None, None


def convert(body: bytes, version: int) -> dict:
    """MTEF 体 → 转换结果。逻辑跟 mathtype_converter 一致：

    解析走满、渲染有结果，才算成功；任何一步不确定就是没有 LaTeX（上层退回预览图）。
    """
    out = {"version": version, "latex": None, "notes": [], "reason": ""}
    try:
        if version == 5:
            import mtef_v5
            import mtef_v5_latex

            eq = mtef_v5.parse(body)
            out["complete"] = eq.complete
            out["consumed"], out["total"] = eq.consumed, eq.total
            out["errors"] = list(eq.errors)
            if not eq.complete or eq.errors:
                out["reason"] = "没走满或有读不懂的记录"
                return out
            latex, notes = mtef_v5_latex.render(eq)
            out["latex"], out["notes"] = latex, list(notes)
            if not latex:
                out["reason"] = "渲染失败"
            return out

        import mtef_v3
        import mtef_v3_latex

        eq = mtef_v3.parse(body)
        out["complete"] = bool(getattr(eq, "complete", True))
        out["errors"] = list(getattr(eq, "errors", []) or [])
        latex, notes = mtef_v3_latex.render(eq)
        out["latex"], out["notes"] = latex, list(notes)
        if not latex:
            out["reason"] = "渲染失败"
        return out
    except Exception as e:                              # 解析器自己抛错也算退回
        out["reason"] = f"{type(e).__name__}: {e}"
        return out


def one_line(res: dict) -> str:
    """一行description：能转就给出 LaTeX 头，不能转就给出原因。"""
    v = res.get("version")
    if res.get("latex"):
        return f"[v{v}] 转出  {res['latex'][:70]}"
    why = res.get("reason") or "读不到 MTEF 体"
    return f"[v{v}] 退回预览图（{why}）"


def progids(path) -> dict:
    """文件里出现过的 ProgID（判断「是不是 MathType」只看这个）。

    Equation.DSMT4 / DSMT6 / DSMT7 → MathType（MTEF v5）
    Equation.3                     → 老 Equation Editor（MTEF v3）
    其他（例如 LaTeXSnipper.*）     → 不在处理范围内
    """
    import re

    found = {}
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if not name.endswith(".xml"):
                continue
            text = zf.read(name).decode("utf-8", "ignore")
            for m in re.finditer(r'ProgID="([^"]+)"', text):
                found.setdefault(m.group(1), []).append(name)
    return found


def classify(progid: str) -> str:
    if progid.startswith("Equation.DSMT"):
        return "MathType（MTEF v5）"
    if progid == "Equation.3":
        return "老 Equation Editor（MTEF v3）"
    return "不在处理范围内"
