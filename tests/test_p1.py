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
        for key in ("标题", "标题列表", "链接列表", "媒体列表", "代码块", "统计")
    )


def test_html_metadata_switch_with_save_json() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        html_path = Path(temp_dir) / "metadata-off.html"
        html_path.write_text(
            "<html><head><title>T</title></head><body><h1>Heading</h1></body></html>",
            encoding="utf-8",
        )
        result = HtmlExtractor({"htmlExtractMetadata": False}).extract(
            str(html_path), output_dir=temp_dir, save_json=True
        )

    assert "标题" not in result.metadata
    assert "标题列表" not in result.metadata
    assert "统计" not in result.metadata


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
