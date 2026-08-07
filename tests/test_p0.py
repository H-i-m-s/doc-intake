"""doc-intake P0 回归测试。

运行：conda run -n Agent python tests/test_p0.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

PLUGIN_PYTHON = Path(__file__).resolve().parents[1] / "python"
sys.path.insert(0, str(PLUGIN_PYTHON))

import fitz

import main
from extractors.base import ExtractionResult
from extractors.html_extractor import HtmlExtractor
from extractors.pdf_extractor import PdfExtractor
from pdf_splitter import crop_pdf_to_page_range, parse_page_range
from utils import normalize_images


def test_page_range_crops_pdf_before_upload_boundary() -> None:
    assert parse_page_range("1-3, 5, 2-2", 5) == [1, 2, 3, 5]
    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / "sample.pdf"
        document = fitz.open()
        for index in range(5):
            page = document.new_page()
            page.insert_text((72, 72), f"PAGE-{index + 1}")
        document.save(source)
        document.close()

        cropped = fitz.open(
            stream=crop_pdf_to_page_range(source, "2-3"),
            filetype="pdf",
        )
        try:
            assert len(cropped) == 2
            assert "PAGE-2" in cropped[0].get_text()
            assert "PAGE-3" in cropped[1].get_text()
        finally:
            cropped.close()


def test_backend_fallback_success_does_not_raise_name_error() -> None:
    def fake_backend(*args, **kwargs):
        if kwargs["backend"] == "first":
            raise RuntimeError("first failed")
        return ExtractionResult(markdown="ok")

    with patch.object(main, "_extract_with_backend", side_effect=fake_backend):
        result = main.extract_with_chain(
            source="x.pdf",
            file_type="pdf",
            output_dir=None,
            backend_chain=["first", "second"],
            settings={},
            page_range=None,
            language="zh",
            include_images=True,
            available_credentials={"first": [], "second": []},
        )

    assert result.markdown == "ok"
    assert result.metadata["usedBackendInChain"] is True
    assert any("first:" in warning for warning in result.warnings)


def test_all_backend_failure_is_explicit_and_not_marked_used() -> None:
    def always_fail(*args, **kwargs):
        raise RuntimeError("token-secret should not leak")

    settings = {
        "paddleTokens": ["token-secret"],
        "mineruCredentials": ["mineru-secret"],
    }
    with patch.object(main, "_extract_with_backend", side_effect=always_fail):
        result = main.extract_with_chain(
            source="x.pdf",
            file_type="pdf",
            output_dir=None,
            backend_chain=["mineru", "paddleocr"],
            settings=settings,
            page_range=None,
            language="zh",
            include_images=True,
            available_credentials={"mineru": [], "paddleocr": []},
        )

    assert result.metadata["usedBackendInChain"] is False
    assert any("所有后端都失败" in warning for warning in result.warnings)
    assert all(
        "token-secret" not in warning and "mineru-secret" not in warning
        for warning in result.warnings
    )


def test_pdf_image_extraction_calls_extract_image_once_per_xref() -> None:
    class FakePage:
        def get_image_info(self, xrefs=True):
            assert xrefs is True
            return [
                {"xref": 7, "bbox": (10, 20, 30, 40)},
                {"xref": 7, "bbox": (10, 20, 30, 40)},
            ]

    class FakeDocument:
        def __init__(self):
            self.calls = []

        def extract_image(self, xref):
            self.calls.append(xref)
            return {"image": b"image-bytes", "ext": "png"}

    with tempfile.TemporaryDirectory() as temp_dir:
        document = FakeDocument()
        images, paths = PdfExtractor._extract_page_images(
            FakePage(),
            page_num=1,
            media_dir=Path(temp_dir),
            doc=document,
            stem="sample",
        )
        assert len(images) == 1
        assert len(paths) == 1
        assert document.calls == [7]


def test_cloud_media_names_are_short_and_type_based() -> None:
    class FakeResponse:
        content = b"image-bytes"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def raise_for_status(self):
            return None

    class FakeMinerImage:
        name = "a_very_long_mineru_generated_name_with_many_tokens.jpeg"
        path = "images/original.jpeg"
        data = b"image-bytes"

        def save(self, path):
            Path(path).write_bytes(self.data)

    with (
        tempfile.TemporaryDirectory() as temp_dir,
        patch("utils.requests.get", return_value=FakeResponse()),
    ):
        paths = normalize_images(
            [
                {
                    "url": "https://example.com/remote-name-that-should-not-be-used.jpeg",
                    "virtual_path": "imgs/another_extremely_long_remote_name.jpeg",
                },
                FakeMinerImage(),
            ],
            temp_dir,
            "cloud-document",
        )

    assert [Path(path).name for path in paths] == [
        "image_001.jpeg",
        "image_002.jpeg",
    ]
    assert all(len(Path(path).name) < 32 for path in paths)


def test_runtime_paths_use_media_dir_without_changing_saved_json_schema() -> None:
    result = ExtractionResult(
        markdown="content",
        images=[r"C:\\tmp\\image.png"],
        metadata={"format": "pdf"},
    )
    formatted = main.format_result(result)
    assert formatted["metadata"]["mediaPaths"] == [r"C:\\tmp\\image.png"]
    assert "mediaDir" not in formatted["metadata"]
    assert "imagesDir" not in formatted["metadata"]

    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / "input.pdf"
        saved = ExtractionResult(
            markdown="content",
            images=[str(Path(temp_dir) / "input_media" / "image.png")],
            metadata={"format": "pdf"},
        )
        main.save_result(saved, str(source), temp_dir, save_json=True)
        json_data = __import__("json").loads(Path(saved.metadata["jsonPath"]).read_text(encoding="utf-8"))
        assert set(json_data) == {"content", "metadata"}
        assert set(json_data["metadata"]) == {
            "mediaPaths", "format", "reader", "backendChain", "usedBackend",
            "usedBackends", "warnings", "usedBackendInChain",
        }
        assert "mdPath" not in json_data["metadata"]
        assert "mediaDir" not in json_data["metadata"]
        assert "jsonPath" not in json_data["metadata"]
        assert json_data["metadata"]["mediaPaths"] == ["input_media/image.png"]


def test_save_result_atomic_temp_stays_in_target_directory() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        captured_dirs = []
        original_mkstemp = main.tempfile.mkstemp

        def capture_mkstemp(*args, **kwargs):
            captured_dirs.append(kwargs.get("dir"))
            return original_mkstemp(*args, **kwargs)

        result = ExtractionResult(markdown="content", metadata={})
        with patch.object(main.tempfile, "mkstemp", side_effect=capture_mkstemp):
            main.save_result(result, "input.pdf", temp_dir, save_json=True)

        assert [Path(directory).resolve() for directory in captured_dirs] == [
            Path(temp_dir).resolve(),
            Path(temp_dir).resolve(),
        ]
        assert Path(result.md_path).read_text(encoding="utf-8") == "content"
        json_path = Path(result.metadata["jsonPath"])
        assert json_path.exists()
        json_data = __import__("json").loads(json_path.read_text(encoding="utf-8"))
        assert json_data["metadata"]["mediaPaths"] == []


def test_save_result_is_atomic_and_rejects_existing_output() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        source = Path(temp_dir) / "input.pdf"
        result = ExtractionResult(markdown="content", metadata={})
        main.save_result(result, str(source), temp_dir)
        assert Path(result.md_path).read_text(encoding="utf-8") == "content"
        assert result.metadata["saveStatus"] == "saved"

        duplicate = ExtractionResult(markdown="new", metadata={})
        try:
            main.save_result(duplicate, str(source), temp_dir)
        except FileExistsError:
            pass
        else:
            raise AssertionError("existing output was overwritten")
        assert duplicate.metadata["saveStatus"] == "failed"


def test_save_result_cleans_partial_output_on_json_failure() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        result = ExtractionResult(markdown="content", metadata={})
        with patch.object(main, "json") as fake_json:
            fake_json.dumps.side_effect = OSError("json serialization failed")
            try:
                main.save_result(result, "input.pdf", temp_dir, save_json=True)
            except OSError:
                pass
            else:
                raise AssertionError("partial save did not fail")

        assert result.metadata["saveStatus"] == "failed"
        assert result.output_dir is None
        assert not list(Path(temp_dir).glob("*.md"))


def test_html_ssrf_and_size_limits_leave_no_media_file() -> None:
    assert HtmlExtractor._is_public_remote_url("http://localhost/a.png") is False
    assert HtmlExtractor._is_public_remote_url("http://127.0.0.1/a.png") is False
    assert HtmlExtractor._is_public_remote_url("http://10.0.0.1/a.png") is False
    assert HtmlExtractor._is_public_remote_url("ftp://example.com/a.png") is False

    class FakeHeaders:
        def get(self, key):
            return None

    class FakeResponse:
        headers = FakeHeaders()
        remaining = 51 * 1024 * 1024

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self, size=-1):
            if self.remaining <= 0:
                return b""
            amount = min(size, self.remaining)
            self.remaining -= amount
            return b"x" * amount

    with (
        tempfile.TemporaryDirectory() as temp_dir,
        patch.object(HtmlExtractor, "_is_public_remote_url", return_value=True),
        patch("urllib.request.urlopen", return_value=FakeResponse()),
    ):
        extractor = HtmlExtractor({"maxRemoteImagesPerHtml": 1})
        downloaded = extractor._download_remote_media(
            '<img src="https://example.com/a.png">', temp_dir, "page"
        )
        assert downloaded == []
        assert not [path for path in Path(temp_dir).rglob("*") if path.is_file()]


if __name__ == "__main__":
    tests = [
        value
        for name, value in globals().items()
        if name.startswith("test_") and callable(value)
    ]
    for test in tests:
        test()
    print(f"p0-tests-ok ({len(tests)} tests)")
