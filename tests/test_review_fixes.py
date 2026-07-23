"""审查报告 H2/C2 回归测试。

运行：conda run -n Agent python tests/test_review_fixes.py
"""
from __future__ import annotations

import sys
import tempfile
import zipfile
from pathlib import Path

PLUGIN_PYTHON = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(PLUGIN_PYTHON))

from extractors.html_extractor import HtmlExtractor
from extractors.xlsx_extractor import XlsxExtractor


def _write_minimal_xlsx(path: Path, sheet_xml: str) -> None:
    workbook_xml = (
        '<?xml version="1.0"?><workbook '
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    rels_xml = (
        '<?xml version="1.0"?><Relationships '
        'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def test_xlsx_inline_string_is_preserved() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "inline.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1" t="inlineStr">'
            '<is><t>inline-text</t></is></c></row></sheetData></worksheet>'
        )
        _write_minimal_xlsx(xlsx_path, sheet_xml)
        result = XlsxExtractor({}).extract(str(xlsx_path))

    assert "inline-text" in result.markdown


def test_html_include_media_false_does_not_save_base64_media() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        html_path = Path(temp_dir) / "base64.html"
        html_path.write_text(
            '<html><body><img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>',
            encoding="utf-8",
        )
        result = HtmlExtractor({"htmlExtractImages": True}).extract(
            str(html_path), output_dir=temp_dir, include_images=False
        )
        media_files = [path for path in Path(temp_dir).rglob("*") if path.is_file()]

    assert result.images == []
    assert media_files == [html_path]


if __name__ == "__main__":
    tests = [
        value
        for name, value in globals().items()
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"review-python-tests-ok ({len(tests)} tests)")
