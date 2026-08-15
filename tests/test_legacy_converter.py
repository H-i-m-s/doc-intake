"""旧版 Office 转换层的无 Office 单元测试。

运行：conda run -n Agent python tests/test_legacy_converter.py
"""
from __future__ import annotations

import sys
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

PLUGIN_PYTHON = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(PLUGIN_PYTHON))

import legacy_converter
import main
from extractors.base import ExtractionResult
from extractors.docx_extractor import DocxExtractor
from extractors.xlsx_extractor import XlsxExtractor


def test_target_mapping_and_provider_policy() -> None:
    assert legacy_converter._target_for(Path("a.doc"))[:2] == ("docx", ".docx")
    assert legacy_converter._target_for(Path("a.xls"))[:2] == ("xlsx", ".xlsx")
    assert legacy_converter._target_for(Path("a.ppt"))[:2] == ("pptx", ".pptx")

    with patch.object(legacy_converter, "_office_com_available", return_value=False):
        try:
            legacy_converter._select_provider({"legacyConversionProvider": "auto"})
        except legacy_converter.LegacyConversionError as exc:
            assert exc.code == "CONVERTER_NOT_AVAILABLE"
        else:
            raise AssertionError("auto provider unexpectedly selected without converter")


def test_validate_output_requires_expected_ooxml_member() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "sample.docx"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("wrong.xml", "x")
        try:
            legacy_converter._validate_output(path, "docx")
        except legacy_converter.LegacyConversionError as exc:
            assert exc.code == "CONVERSION_OUTPUT_INVALID"
        else:
            raise AssertionError("invalid OOXML output was accepted")


def test_legacy_extractors_use_conversion_context_and_restore_heading() -> None:
    converted = legacy_converter.ConvertedDocument(
        original_path=Path("source.doc"),
        converted_path=Path("temporary.docx"),
        original_format="doc",
        converted_format="docx",
        provider="office_com",
        warnings=["compatibility warning"],
        duration_ms=12,
    )
    with patch(
        "extractors.docx_extractor.convert_legacy_document",
        return_value=_fake_conversion_context(converted),
    ), patch.object(
        DocxExtractor,
        "extract",
        autospec=True,
        side_effect=[
            ExtractionResult(markdown="# temporary.docx\n\ntext", metadata={"format": "docx"}),
        ],
    ):
        result = DocxExtractor({})._handle_legacy_doc(Path("source.doc"), None, True)

    assert result.markdown.startswith("# source.doc")
    assert result.metadata["originalFormat"] == "doc"
    assert result.metadata["conversionStatus"] == "success"
    assert result.warnings == ["compatibility warning"]


def test_conversion_failure_is_terminal_for_backend_chain() -> None:
    result = ExtractionResult(
        markdown="# 错误\n\n转换失败",
        metadata={
            "conversionStatus": "failed",
            "conversionErrorCode": "CONVERTER_NOT_AVAILABLE",
        },
        warnings=["需要转换器"],
    )
    with patch.object(main, "_extract_with_backend", return_value=result):
        final = main.extract_with_chain(
            source="source.doc",
            file_type="doc",
            output_dir=None,
            backend_chain=["local"],
            settings={},
            page_range=None,
            language="zh",
            include_images=True,
            available_credentials={},
        )
    assert final.metadata["conversionStatus"] == "failed"
    assert final.metadata["conversionErrorCode"] == "CONVERTER_NOT_AVAILABLE"
    assert "所有后端都失败" not in final.markdown


def _fake_conversion_context(converted):
    class Context:
        def __enter__(self):
            return converted

        def __exit__(self, *args):
            return None

    return Context()


if __name__ == "__main__":
    tests = [
        value
        for name, value in globals().items()
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"legacy-converter-tests-ok ({len(tests)} tests)")
