"""doc-intake P1 回归测试。

运行：conda run -n Agent python tests/test_p1.py
"""
from __future__ import annotations

import logging
import sys
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PLUGIN_PYTHON = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(PLUGIN_PYTHON))

import fitz

import main
from extractors.base import ExtractionResult
from extractors.html_extractor import HtmlExtractor
from extractors.xlsx_extractor import XlsxExtractor
from logger import configure_logging
from mineru_client import MinerUClient
from pdf_splitter import PdfMemoryChunk


def test_html_configuration_switches() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        html_path = Path(temp_dir) / "sample.html"
        html_path.write_text(
            '<html><head><title>T</title><meta name="author" content="A"></head>'
            '<body><h1>Heading</h1><a href="https://example.com">link</a>'
            '<pre><code>print(1)</code></pre>'
            '<img src="data:image/png;base64,iVBORw0KGgo="></body></html>',
            encoding="utf-8",
        )
        result = HtmlExtractor({
            "htmlExtractMetadata": False,
            "htmlExtractLinks": False,
            "htmlExtractImages": False,
            "htmlExtractCodeBlocks": False,
            "htmlHeadingStyle": "SETEXT",
        }).extract(str(html_path), output_dir=temp_dir, save_json=True)

    assert not result.images
    assert all(
        key not in result.metadata
        for key in ("标题", "链接列表", "媒体列表", "代码块")
    )


def test_xlsx_truncation_warning_and_limits() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "sample.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1"><v>1</v></c>'
            '<c r="C1"><v>3</v></c></row><row r="3">'
            '<c r="A3"><v>3</v></c></row></sheetData></worksheet>'
        )
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
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({
            "xlsxMaxRows": 2,
            "xlsxMaxCols": 2,
        }).extract(str(xlsx_path))

    assert any("超过 2 行" in warning for warning in result.warnings)
    assert any("超过 2 列" in warning for warning in result.warnings)


def test_xlsx_zero_limits_keep_all_content_without_truncation() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "unlimited.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1"><v>1</v></c>'
            '<c r="C1"><v>3</v></c></row><row r="3">'
            '<c r="A3"><v>303</v></c></row></sheetData></worksheet>'
        )
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
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({
            "xlsxMaxRows": 0,
            "xlsxMaxCols": 0,
        }).extract(str(xlsx_path))

    assert "303" in result.markdown
    assert any(line.startswith("| 303 |") for line in result.markdown.splitlines())
    assert not result.warnings


def test_xls_numeric_filter_uses_shortest_round_trip_text() -> None:
    from extractors.xlsx_extractor import _load_legacy_numeric_overrides

    fake_cell = SimpleNamespace(ctype=2, value=68460.100000000006)
    fake_sheet = SimpleNamespace(
        name="Sheet1",
        nrows=1,
        ncols=1,
        cell=lambda row, col: fake_cell,
    )
    fake_xlrd = SimpleNamespace(
        XL_CELL_NUMBER=2,
        XL_CELL_DATE=3,
        open_workbook=lambda path, formatting_info=False: SimpleNamespace(
            sheets=lambda: [fake_sheet]
        ),
    )
    with patch.dict(sys.modules, {"xlrd": fake_xlrd}):
        overrides, warning = _load_legacy_numeric_overrides(Path("sample.xls"))

    assert warning is None
    assert overrides[("Sheet1", "A1")] == "68460.1"

    fake_cell.value = 100000.0
    with patch.dict(sys.modules, {"xlrd": fake_xlrd}):
        overrides, warning = _load_legacy_numeric_overrides(Path("sample.xls"))
    assert warning is None
    assert overrides[("Sheet1", "A1")] == "100000"

    fake_cell.ctype = 3
    with patch.dict(sys.modules, {"xlrd": fake_xlrd}):
        overrides, warning = _load_legacy_numeric_overrides(Path("sample.xls"))
    assert warning is None
    assert overrides == {}


def test_xlsx_formula_cache_is_not_overridden() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "formula.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1"><f>SUM(B1:B2)</f>'
            '<v>68460.100000000006</v></c></row></sheetData></worksheet>'
        )
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
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({
            "xlsxMaxRows": 0,
            "xlsxMaxCols": 0,
        }).extract(
            str(xlsx_path),
            numeric_overrides={("Sheet1", "A1"): "68460.1"},
        )

    formula_row = next(
        line for line in result.markdown.splitlines() if line.startswith("| 68460.100000000006 |")
    )
    assert formula_row == "| 68460.100000000006 |"


def test_xlsx_zero_row_limit_keeps_rows_but_applies_column_limit() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "zero-row-limit.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>'
            '<row r="3"><c r="A3"><v>303</v></c><c r="C3"><v>305</v></c></row>'
            '</sheetData></worksheet>'
        )
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
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({
            "xlsxMaxRows": 0,
            "xlsxMaxCols": 2,
        }).extract(str(xlsx_path))

    assert "| 303 |" in result.markdown
    assert "305" not in result.markdown
    assert any("超过 2 列" in warning for warning in result.warnings)
    assert not any("超过" in warning and "行" in warning for warning in result.warnings)


def test_xlsx_negative_limits_are_rejected() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "negative-limit.xlsx"
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr(
                "xl/workbook.xml",
                '<?xml version="1.0"?><workbook '
                'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
            )
            archive.writestr(
                "xl/_rels/workbook.xml.rels",
                '<?xml version="1.0"?><Relationships '
                'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                'Target="worksheets/sheet1.xml"/></Relationships>',
            )
            archive.writestr(
                "xl/worksheets/sheet1.xml",
                '<?xml version="1.0"?><worksheet '
                'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
            )

        try:
            XlsxExtractor({"xlsxMaxRows": -1, "xlsxMaxCols": 0}).extract(
                str(xlsx_path)
            )
        except ValueError as exc:
            assert "不能小于 0" in str(exc)
        else:
            raise AssertionError("negative Excel limit should be rejected")


def test_xlsx_uses_only_content_width_and_skips_empty_sheets() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "content-boundary.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>编号</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>x</t></is></c>'
            '<c r="C1" t="inlineStr"><is><t>y</t></is></c>'
            '<c r="Z1"/></row><row r="2">'
            '<c r="A2"><v>1</v></c><c r="B2"><v>0.123456789012345</v></c>'
            '<c r="C2"><v>59652.3433795158</v></c><c r="Z2"/></row></sheetData>'
            '</worksheet>'
        )
        empty_sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData/></worksheet>'
        )
        workbook_xml = (
            '<?xml version="1.0"?><workbook '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/>'
            '<sheet name="Sheet2" sheetId="2" r:id="rId2"/></sheets></workbook>'
        )
        rels_xml = (
            '<?xml version="1.0"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet2.xml"/></Relationships>'
        )
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
            archive.writestr("xl/worksheets/sheet2.xml", empty_sheet_xml)

        result = XlsxExtractor({"xlsxMaxRows": 100, "xlsxMaxCols": 50}).extract(
            str(xlsx_path)
        )

    assert "## Sheet: Sheet1" in result.markdown
    assert "## Sheet: Sheet2" not in result.markdown
    assert "59652.3433795158" in result.markdown
    assert "0.123456789012345" in result.markdown
    first_data_line = next(
        line for line in result.markdown.splitlines() if line.startswith("| 1 |")
    )
    assert first_data_line.count("|") == 4


def test_xlsx_preserves_raw_numeric_text_character_for_character() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "numeric-text.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="1">'
            '<c r="A1"><v>12345678901234567</v></c>'
            '<c r="B1"><v>0.123456789012345678</v></c>'
            '<c r="C1"><v>23602.880000000001</v></c>'
            '</row></sheetData></worksheet>'
        )
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
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({"xlsxMaxRows": 100, "xlsxMaxCols": 50}).extract(
            str(xlsx_path)
        )

    assert "12345678901234567" in result.markdown
    assert "0.123456789012345678" in result.markdown
    row = next(line for line in result.markdown.splitlines() if line.startswith("| 12345678901234567 |"))
    assert row == "| 12345678901234567 | 0.123456789012345678 | 23602.880000000001 |"


def test_xlsx_explicit_xls_limits_and_truncated_sheet_signal() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xlsx_path = Path(temp_dir) / "truncated.xlsx"
        sheet_xml = (
            '<?xml version="1.0"?><worksheet '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData><row r="101"><c r="A101"><v>42</v></c></row>'
            '<row r="102"><c r="BA102"><v>99</v></c></row></sheetData></worksheet>'
        )
        workbook_xml = (
            '<?xml version="1.0"?><workbook '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'
        )
        rels_xml = (
            '<?xml version="1.0"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            'Target="worksheets/sheet1.xml"/></Relationships>'
        )
        with zipfile.ZipFile(xlsx_path, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook_xml)
            archive.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)

        result = XlsxExtractor({
            "xlsxMaxRows": 100,
            "xlsxMaxCols": 50,
        }).extract(str(xlsx_path), max_rows=100, max_cols=50)

    assert "## Sheet: Data" in result.markdown
    assert "[内容因行数或列数限制未保留]" in result.markdown
    assert "[Empty sheet]" not in result.markdown
    assert any("超过 100 行" in warning for warning in result.warnings)
    assert any("超过 50 列" in warning for warning in result.warnings)


def test_mineru_pdf_limits() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / "sample.pdf"
        document = fitz.open()
        for _ in range(3):
            document.new_page()
        document.save(pdf_path)
        document.close()

        client = MinerUClient({
            "mineruFlashMaxMB": 100,
            "mineruFlashMaxPages": 2,
            "autoSplitLargePDF": False,
        })
        try:
            client._validate_pdf_limits(str(pdf_path), None, None)
        except ValueError as error:
            assert "页数超过限制" in str(error)
        else:
            raise AssertionError("MinerU page limit was not enforced")


def test_chunk_backend_aggregation() -> None:
    args = SimpleNamespace(source="x.pdf")
    chunks = [
        PdfMemoryChunk(1, 1, 1, "a.pdf", b"a"),
        PdfMemoryChunk(2, 2, 2, "b.pdf", b"b"),
    ]

    def fake_chunk(chunk, *args, **kwargs):
        backend = "local" if chunk.index == 1 else "mineru"
        return ExtractionResult(markdown="ok", metadata={"usedBackend": backend})

    with patch.object(main, "_extract_one_memory_chunk", side_effect=fake_chunk):
        merged = main._extract_memory_pdf_chunks(
            args=args,
            settings={},
            output_dir=None,
            backend_chain=["mineru", "local"],
            include_images=True,
            available_credentials={},
            first_chunk=chunks[0],
            remaining_chunks=iter([chunks[1]]),
        )

    assert merged.metadata["usedBackendInChain"] is True
    assert merged.metadata["usedBackends"] == ["local", "mineru"]


def test_logging_configuration_releases_file_handler() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        log_path = Path(temp_dir) / "doc-intake.log"
        configure_logging({"logLevel": "ERROR", "logFile": str(log_path)})
        logging.getLogger("doc-intake-test").error("p1-log-test")
        assert "p1-log-test" in log_path.read_text(encoding="utf-8")

        root_logger = logging.getLogger()
        for handler in list(root_logger.handlers):
            if isinstance(handler, logging.FileHandler):
                root_logger.removeHandler(handler)
                handler.close()


def test_mineru_client_has_no_private_sdk_calls() -> None:
    source = (PLUGIN_PYTHON / "mineru_client.py").read_text(encoding="utf-8")
    for private_api in ("_require_auth", "_wait_batch", "_flash_api", "_flash_wait"):
        assert private_api not in source


if __name__ == "__main__":
    tests = [
        value
        for name, value in globals().items()
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"p1-tests-ok ({len(tests)} tests)")
