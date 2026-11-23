"""v14 公式兜底链自测：预览图 → 小模型 → LaTeX，以及「认不出来就照旧留图」。

用法：python -m test.selftest_v14_formula_chain

覆盖（全部用注入桩，不碰真权重）：
  1. 认出来：md 里出现 $latex$，对应的 ![](…) 消失；result.images 里没有这张图，
     输出目录里也没有这张 PNG。
  2. 记账：warnings 有一条「由 … 还原」，metadata.formulaFallbacks 有一条。
  3. 空白预览仍被拦、不进链（预览被删、正文什么都不留、recognizer 一次没调）。
  4. 链上后端未安装时被静默剔除：不报错、图照旧保留、没有记账。
  5. recognizer 抛异常 / 返回空串时，图照常保留，提取不炸。
  6. recognize 本身对不存在的图片返回 None 而不抛（兜底链的铁律）。

样本是现场造的 DOCX（假 OLE 对象 + 真 PNG / WMF 预览），不依赖仓库外的文件；
WMF 那条要 GDI+/Pillow 能转换，转不出来就跳过第 3 条而不是误报通过。
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import zipfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

import formula_fallback  # noqa: E402
from extractors import emf_converter  # noqa: E402
from extractors.docx_extractor import DocxExtractor  # noqa: E402

FIXTURE_WMF = os.path.join(_TEST_DIR, "fixtures", "formula_preview.wmf")
FAKE_LATEX = "\\frac{a}{b}"

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_O_NS = "urn:schemas-microsoft-com:office:office"
_V_NS = "urn:schemas-microsoft-com:vml"

# 公式对象 + 它自己的预览图。结构照真实 MathType 的写法：w:object 里一张 VML 预览
# 加一个 OLEObject。OLE 的 .bin 是垃圾字节，MathType 那条路必然转不出来。
_DOCUMENT_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{_W_NS}" xmlns:r="{_R_NS}" xmlns:o="{_O_NS}" xmlns:v="{_V_NS}">
  <w:body>
    <w:p>
      <w:r><w:t>公式：</w:t></w:r>
      <w:r>
        <w:object>
          <v:shape id="shape1" style="width:60pt;height:30pt">
            <v:imagedata r:id="rIdPreview" o:title="formula"/>
          </v:shape>
          <o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="shape1" r:id="rIdEquation"/>
        </w:object>
      </w:r>
    </w:p>
    <w:p><w:r><w:t>结束</w:t></w:r></w:p>
  </w:body>
</w:document>
"""

_RELS_XML = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdPreview" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{{preview}}"/>
  <Relationship Id="rIdEquation" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject1.bin"/>
</Relationships>
"""


# ── 断言小工具（与 v12 / v13 同款） ─────────────────────────────

class Checker:
    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def ok(self, condition: bool, label: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print("  ✓ %s%s" % (label, ("｜" + detail) if detail else ""))
        else:
            self.failed += 1
            print("  ✗ %s%s" % (label, ("｜" + detail) if detail else ""))
        return condition

    def summary(self) -> int:
        print()
        print("通过 %d 项，失败 %d 项" % (self.passed, self.failed))
        return 0 if self.failed == 0 else 1


# ── 造样本 ──────────────────────────────────────────────────────

def make_png(path: str) -> None:
    """一张真的小 PNG（不是空白图：普通媒体不走空白判据，这里只要能被 Pillow 打开）。"""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (80, 40), "white")
    draw = ImageDraw.Draw(image)
    draw.line((5, 30, 70, 8), fill="black", width=2)
    image.save(path, format="PNG")


def build_docx(path: str, preview_name: str, preview_src: str = "") -> None:
    """造一份最小 DOCX：一个公式对象 + 一张预览图。"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Default Extension="png" ContentType="image/png"/>'
            '<Default Extension="wmf" ContentType="image/x-wmf"/>'
            "</Types>"
        ))
        zf.writestr("word/document.xml", _DOCUMENT_XML)
        zf.writestr("word/_rels/document.xml.rels", _RELS_XML.format(preview=preview_name))
        if preview_src:
            with open(preview_src, "rb") as handle:
                zf.writestr(f"word/media/{preview_name}", handle.read())
        else:
            buffer = os.path.join(os.path.dirname(path), "_preview.png")
            make_png(buffer)
            with open(buffer, "rb") as handle:
                zf.writestr(f"word/media/{preview_name}", handle.read())
        # 垃圾 OLE：MathType 解析必然失败 → 公式退回预览图
        zf.writestr("word/embeddings/oleObject1.bin", b"\x00" * 64)


# ── 桩 ───────────────────────────────────────────────────────────

class Stub:
    """把 chain_from_settings / recognize 换成受控实现，退出时还原。"""

    def __init__(self, chain, recognize):
        self.chain = chain
        self.recognize = recognize
        self._saved = {}

    def __enter__(self):
        self._saved["chain"] = formula_fallback.chain_from_settings
        self._saved["recognize"] = formula_fallback.recognize
        formula_fallback.chain_from_settings = self.chain
        formula_fallback.recognize = self.recognize
        return self

    def __exit__(self, *exc_info):
        formula_fallback.chain_from_settings = self._saved["chain"]
        formula_fallback.recognize = self._saved["recognize"]
        return False


def run_extract(docx_path: str, out_dir: str, settings: dict):
    extractor = DocxExtractor(settings)
    return extractor.extract(source=docx_path, output_dir=out_dir, include_images=True)


def media_files(out_dir: str, stem: str) -> list[str]:
    folder = os.path.join(out_dir, f"{stem}_media")
    if not os.path.isdir(folder):
        return []
    return sorted(os.listdir(folder))


# ── 各条用例 ─────────────────────────────────────────────────────

def case_recovered(check: Checker) -> None:
    print("\n[1] 认出 LaTeX：正文换成 $latex$，图片不落盘")
    with tempfile.TemporaryDirectory(prefix="docintake-v14-a-") as tmp:
        docx_path = os.path.join(tmp, "recover.docx")
        out_dir = os.path.join(tmp, "out")
        os.makedirs(out_dir, exist_ok=True)
        build_docx(docx_path, "image1.png")

        calls = []

        def fake_recognize(image_path, backend):
            calls.append((os.path.basename(image_path), backend))
            return FAKE_LATEX

        with Stub(lambda settings: ["texo"], fake_recognize):
            result = run_extract(docx_path, out_dir, {"formulaChain": ["local", "texo"]})

        markdown = result.markdown or ""
        check.ok(f"${FAKE_LATEX}$" in markdown, "md 里出现 $latex$", markdown.strip().splitlines()[-1][:60])
        check.ok("![" not in markdown, "对应的 ![](…) 不再出现")
        check.ok(result.images == [], "result.images 里没有这张图", str(result.images))
        check.ok(media_files(out_dir, "recover") == [], "输出目录里也没有这张 PNG", str(media_files(out_dir, "recover")))
        check.ok(len(calls) == 1 and calls[0][1] == "texo", "识别被调了一次，走的是 texo", str(calls))
        warnings = result.warnings or []
        check.ok(any("由 texo 还原" in line for line in warnings), "warnings 里有一条「由 … 还原」", str(warnings))
        fallbacks = (result.metadata or {}).get("formulaFallbacks")
        check.ok(
            isinstance(fallbacks, list) and fallbacks == [{"index": 1, "backend": "texo"}],
            "metadata.formulaFallbacks 记为第 1 条 / texo",
            str(fallbacks),
        )


def case_blank_preview(check: Checker) -> None:
    print("\n[2] 空白预览仍被拦下，不送链")
    if not os.path.isfile(FIXTURE_WMF):
        print("  - 缺少 test/fixtures/formula_preview.wmf，跳过")
        return

    saved = emf_converter.preview_is_blank
    emf_converter.preview_is_blank = lambda path: True  # 假装这张 WMF 渲出来是空白

    try:
        with tempfile.TemporaryDirectory(prefix="docintake-v14-b-") as tmp:
            docx_path = os.path.join(tmp, "blank.docx")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            build_docx(docx_path, "image1.wmf", FIXTURE_WMF)

            calls = []

            def fake_recognize(image_path, backend):  # pragma: no cover - 不该被调到
                calls.append(backend)
                return FAKE_LATEX

            with Stub(lambda settings: ["texo"], fake_recognize):
                result = run_extract(docx_path, out_dir, {"formulaChain": ["local", "texo"]})

            markdown = result.markdown or ""
            check.ok("$" not in markdown, "正文里没有 LaTeX（空白公式什么都不留）", markdown.strip()[:60])
            check.ok("![" not in markdown, "也没有图片引用")
            check.ok(result.images == [], "result.images 为空", str(result.images))
            check.ok(media_files(out_dir, "blank") == [], "输出目录里没有这张图")
            check.ok(calls == [], "recognizer 一次都没被调", str(calls))
            check.ok(
                any("空白图" in line for line in (result.warnings or [])),
                "原有那条「空白图」warning 还在",
                str(result.warnings),
            )
            check.ok(not (result.metadata or {}).get("formulaFallbacks"), "没有 formulaFallbacks 记账")
    finally:
        emf_converter.preview_is_blank = saved


def case_uninstalled(check: Checker) -> None:
    print("\n[3] 链上后端未安装：静默剔除，图照旧保留")
    with tempfile.TemporaryDirectory(prefix="docintake-v14-c-") as tmp:
        docx_path = os.path.join(tmp, "missing.docx")
        out_dir = os.path.join(tmp, "out")
        model_dir = os.path.join(tmp, "models")
        os.makedirs(out_dir, exist_ok=True)
        os.makedirs(model_dir, exist_ok=True)
        build_docx(docx_path, "image1.png")

        # 真实现（不注入桩）：plus-m 目录是空的，链应当为空
        settings = {
            "formulaChain": ["local", "plus-m"],
            "formulaModelDir": model_dir,
        }
        chain = formula_fallback.chain_from_settings(settings)
        check.ok(chain == [], "未安装的后端被静默剔除", str(chain))

        try:
            result = run_extract(docx_path, out_dir, settings)
            failed = False
        except Exception as exc:  # noqa: BLE001
            failed = True
            result = None
            print("    抛出：", repr(exc))
        check.ok(not failed, "提取没有因为链为空而报错")

        if result is not None:
            markdown = result.markdown or ""
            check.ok("![" in markdown, "图片仍在正文里")
            check.ok(len(result.images) == 1, "result.images 保留了这张图", str(result.images))
            check.ok(not (result.metadata or {}).get("formulaFallbacks"), "没有 formulaFallbacks 记账")
            check.ok(
                not any("还原" in line for line in (result.warnings or [])),
                "没有凭空造一条「还原」warning",
                str(result.warnings),
            )


def case_recognizer_failure(check: Checker) -> None:
    print("\n[4] recognizer 抛异常 / 返回空串：图照常保留")
    for label, behavior in (
        ("抛异常", lambda path, backend: (_ for _ in ()).throw(RuntimeError("boom"))),
        ("返回空串", lambda path, backend: ""),
    ):
        with tempfile.TemporaryDirectory(prefix="docintake-v14-d-") as tmp:
            docx_path = os.path.join(tmp, "keep.docx")
            out_dir = os.path.join(tmp, "out")
            os.makedirs(out_dir, exist_ok=True)
            build_docx(docx_path, "image1.png")

            try:
                with Stub(lambda settings: ["texo"], behavior):
                    result = run_extract(docx_path, out_dir, {"formulaChain": ["local", "texo"]})
                crashed = False
            except Exception as exc:  # noqa: BLE001
                crashed = True
                result = None
                print("    抛出：", repr(exc))

            check.ok(not crashed, f"{label}时提取不炸")
            if result is None:
                continue
            markdown = result.markdown or ""
            check.ok("![" in markdown, f"{label}时图片仍在正文里")
            check.ok(len(result.images) == 1, f"{label}时 result.images 保留了这张图", str(result.images))
            check.ok(media_files(out_dir, "keep") != [], f"{label}时 PNG 仍在输出目录里")
            check.ok(not (result.metadata or {}).get("formulaFallbacks"), f"{label}时没有记账")


def case_recognize_contract(check: Checker) -> None:
    print("\n[5] recognize 的兜底契约：不存在的图 / 未知后端都返回 None")
    result = None
    raised = None
    try:
        result = formula_fallback.recognize(os.path.join(_APP_DIR, "___not_here___.png"), "texo")
        formula_fallback.recognize(os.path.join(_APP_DIR, "___not_here___.png"), "no-such-backend")
    except Exception as exc:  # noqa: BLE001
        raised = exc
    check.ok(raised is None, "没有抛任何异常", repr(raised or ""))
    check.ok(result is None, "不存在的图片返回 None", repr(result))

    # 设置里的链也接受字符串写法（老配置 / 手工改），并且 local 不占返回位
    normalized = formula_fallback.chain_from_settings(
        {"formulaChain": "local>texo>plus-m", "formulaModelDir": ""}
    )
    check.ok(normalized == [], "字符串写法能解析，未装的两个都被剔除", str(normalized))


def main() -> int:
    check = Checker()
    case_recovered(check)
    case_blank_preview(check)
    case_uninstalled(check)
    case_recognizer_failure(check)
    case_recognize_contract(check)
    return check.summary()


if __name__ == "__main__":
    sys.exit(main())
