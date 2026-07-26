"""DOCX 严格 OOXML、MathType 公式与媒体锚点回归测试。"""
from __future__ import annotations

import base64
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

PLUGIN_PYTHON = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(PLUGIN_PYTHON))

from extractors._utils import format_media_ref, markdown_media_path
from extractors.docx_extractor import DocxExtractor
from extractors.mathtype_filter import filter_mathtype_previews
from mathtype_converter import MathTypeConverter


STRICT_W = "http://purl.oclc.org/ooxml/wordprocessingml/main"
STRICT_R = "http://purl.oclc.org/ooxml/officeDocument/relationships"
STRICT_WP = "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing"
STRICT_A = "http://purl.oclc.org/ooxml/drawingml/main"
STRICT_PIC = "http://purl.oclc.org/ooxml/drawingml/picture"
STRICT_O = "urn:schemas-microsoft-com:office:office"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

# 一个极小的合法 PNG，足够验证关系映射和输出引用，不依赖图像解码。
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "YAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _write_strict_docx(path: Path, preview_name: str = "image1.png") -> None:
    document_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="{STRICT_W}" xmlns:r="{STRICT_R}"
    xmlns:wp="{STRICT_WP}" xmlns:a="{STRICT_A}" xmlns:pic="{STRICT_PIC}"
    xmlns:o="{STRICT_O}">
  <w:body>
    <w:p>
      <w:r><w:t>前文</w:t></w:r>
      <w:r><w:object>
        <o:OLEObject Type="Embed" ProgID="Equation.DSMT4" r:id="rIdOle" />
        <w:drawing><wp:inline><a:graphic><a:graphicData>
          <pic:pic><pic:blipFill><a:blip r:embed="rIdPreview" /></pic:blipFill></pic:pic>
        </a:graphicData></a:graphic></wp:inline></w:drawing>
      </w:object></w:r>
      <w:r><w:drawing><wp:inline><a:graphic><a:graphicData>
        <pic:pic><pic:blipFill><a:blip r:embed="rIdImage" /></pic:blipFill></pic:pic>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
      <w:r><w:t>后文</w:t></w:r>
    </w:p>
    <w:sectPr />
  </w:body>
</w:document>'''
    rels_xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="{PACKAGE_REL}">
  <Relationship Id="rIdOle" Type="{STRICT_R}/oleObject" Target="embeddings/oleObject1.bin" />
  <Relationship Id="rIdPreview" Type="{STRICT_R}/image" Target="media/{preview_name}" />
  <Relationship Id="rIdImage" Type="{STRICT_R}/image" Target="media/image2.png" />
</Relationships>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
        archive.writestr("word/_rels/document.xml.rels", rels_xml)
        archive.writestr("word/embeddings/oleObject1.bin", b"placeholder")
        archive.writestr(f"word/media/{preview_name}", PNG_BYTES)
        archive.writestr("word/media/image2.png", PNG_BYTES)


def test_markdown_media_path_encodes_spaces_only() -> None:
    assert markdown_media_path("论文 文件_media/image 001.png") == "论文%20文件_media/image%20001.png"
    assert markdown_media_path("论文%20文件/image.png") == "论文%20文件/image.png"
    assert format_media_ref("论文 文件_media/image 001.png", "image", "图") == (
        "![图](论文%20文件_media/image%20001.png)"
    )
    assert format_media_ref("论文 文件_media/video 001.mp4", "video", "视频") == (
        '<video controls src="论文%20文件_media/video%20001.mp4" title="视频"></video>'
    )


def test_strict_ooxml_formula_and_image_relationships() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / "strict.docx"
        output = Path(temp_dir) / "output"
        _write_strict_docx(source)

        with patch.object(
            MathTypeConverter,
            "extract_mathtype_from_docx",
            return_value=[
                {
                    "index": 1,
                    "latex": "x^2",
                    "position": "word/embeddings/oleObject1.bin",
                }
            ],
        ):
            result = DocxExtractor({}).extract(str(source), output_dir=str(output))

    assert "$x^2$" in result.markdown
    assert "strict_media/image_001.png" not in result.markdown
    assert "strict_media/image_002.png" in result.markdown
    assert "前文$x^2$" in result.markdown
    assert "后文" in result.markdown


def test_emf_math_preview_filter_matches_wmf_behavior() -> None:
    class _Info:
        def __init__(self, size: int):
            self.file_size = size

    class _Zip:
        def getinfo(self, name: str):
            return _Info(100)

    assert filter_mathtype_previews(["word/media/a.emf", "word/media/b.png"], _Zip()) == [
        "word/media/b.png"
    ]


def test_failed_formula_uses_inline_preview_at_formula_position() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / "strict.docx"
        output = Path(temp_dir) / "output"
        _write_strict_docx(source)

        with patch.object(
            MathTypeConverter,
            "extract_mathtype_from_docx",
            return_value=[],
        ):
            result = DocxExtractor({}).extract(str(source), output_dir=str(output))

    assert "![formula](strict_media/image_001.png)" in result.markdown
    assert result.markdown.index("image_001.png") < result.markdown.index("后文")


if __name__ == "__main__":
    tests = [
        value
        for name, value in globals().items()
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"docx-adaptation-tests-ok ({len(tests)} tests)")
