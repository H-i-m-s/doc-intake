"""旧版 Office 文档转换层。

负责把二进制 Office 文档转换为 OOXML 临时文件，不负责正文提取或结果保存。
第一阶段支持 Windows Office COM；LibreOffice 作为显式可选 provider。
"""
from __future__ import annotations

import gc
import importlib.util
import os
import subprocess
import tempfile
import time
import zipfile
from threading import Lock
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


_COM_LOCK = Lock()

_TARGETS = {
    ".doc": ("docx", ".docx", "Word.Application", 12),
    ".xls": ("xlsx", ".xlsx", "Excel.Application", 51),
    ".ppt": ("pptx", ".pptx", "PowerPoint.Application", 24),
}


def restore_original_heading(markdown: str, original_name: str, converted_name: str) -> str:
    """把递归 OOXML 提取器生成的临时格式标题恢复为原始文件名。"""
    if not markdown:
        return markdown
    temporary_heading = f"# {converted_name}"
    if markdown.startswith(temporary_heading):
        return f"# {original_name}" + markdown[len(temporary_heading):]
    return markdown


class LegacyConversionError(RuntimeError):
    """旧格式转换失败，带有稳定的错误码供上层记录。"""

    def __init__(self, message: str, code: str = "CONVERSION_FAILED") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ConvertedDocument:
    original_path: Path
    converted_path: Path
    original_format: str
    converted_format: str
    provider: str
    warnings: list[str] = field(default_factory=list)
    duration_ms: int = 0


def _provider(settings: dict) -> str:
    value = str(settings.get("legacyConversionProvider") or "auto").strip().lower()
    aliases = {
        "com": "office_com",
        "office": "office_com",
        "office-com": "office_com",
        "libre": "libreoffice",
        "lo": "libreoffice",
    }
    return aliases.get(value, value)


def _office_com_available() -> bool:
    return os.name == "nt" and importlib.util.find_spec("win32com.client") is not None


def _select_provider(settings: dict) -> str:
    configured = _provider(settings)
    if configured in {"disabled", "office_com", "libreoffice"}:
        return configured
    if configured != "auto":
        raise LegacyConversionError(
            f"不支持的旧格式转换 provider: {configured}",
            code="CONVERTER_NOT_AVAILABLE",
        )

    # auto 不在不同转换器之间静默切换。Windows + pywin32 优先使用 Office COM；
    # 没有 COM 时，只有显式配置 libreOfficePath 才允许选择 LibreOffice。
    if _office_com_available():
        return "office_com"
    if settings.get("libreOfficePath"):
        return "libreoffice"
    raise LegacyConversionError(
        "旧格式转换需要 Microsoft Office COM（pywin32）或显式配置 libreOfficePath 的 LibreOffice",
        code="CONVERTER_NOT_AVAILABLE",
    )


def _target_for(source: Path) -> tuple[str, str, str, int]:
    target = _TARGETS.get(source.suffix.lower())
    if not target:
        raise LegacyConversionError(
            f"不支持转换的旧格式: {source.suffix or '<无扩展名>'}",
            code="CONVERTER_NOT_AVAILABLE",
        )
    return target


def _validate_output(path: Path, converted_format: str) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise LegacyConversionError(
            f"转换产物不存在或为空: {path.name}",
            code="CONVERSION_OUTPUT_INVALID",
        )

    expected_member = {
        "docx": "word/document.xml",
        "xlsx": "xl/workbook.xml",
        "pptx": "ppt/presentation.xml",
    }[converted_format]
    try:
        with zipfile.ZipFile(path) as archive:
            if expected_member not in archive.namelist():
                raise LegacyConversionError(
                    f"转换产物不是有效的 {converted_format.upper()} 文件: 缺少 {expected_member}",
                    code="CONVERSION_OUTPUT_INVALID",
                )
    except zipfile.BadZipFile as exc:
        raise LegacyConversionError(
            f"转换产物不是有效的 {converted_format.upper()} 压缩包",
            code="CONVERSION_OUTPUT_INVALID",
        ) from exc


def _set_optional(obj, name: str, value) -> None:
    try:
        setattr(obj, name, value)
    except Exception:
        # 不同 Office 版本对部分自动化属性支持不同。核心转换仍继续，
        # 但不把可选属性失败伪装成转换失败。
        pass


def _convert_word(source: Path, target: Path) -> None:
    import pythoncom
    import win32com.client

    app = None
    document = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
        app = win32com.client.DispatchEx("Word.Application")
        _set_optional(app, "Visible", False)
        _set_optional(app, "DisplayAlerts", 0)
        try:
            app.Options.UpdateLinksAtOpen = False
        except Exception:
            pass

        document = app.Documents.Open(
            str(source.resolve()),
            ConfirmConversions=False,
            ReadOnly=True,
            AddToRecentFiles=False,
            Revert=False,
            NoEncodingDialog=True,
        )
        save_as2 = getattr(document, "SaveAs2", None)
        if save_as2 is not None:
            save_as2(
                str(target),
                FileFormat=12,
                AddToRecentFiles=False,
            )
        else:
            document.SaveAs(
                str(target),
                FileFormat=12,
                AddToRecentFiles=False,
            )
    except Exception as exc:
        raise LegacyConversionError(
            f"DOC 转 DOCX 失败: {exc}",
            code="CONVERSION_FAILED",
        ) from exc
    finally:
        if document is not None:
            try:
                document.Close(SaveChanges=False)
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit(SaveChanges=False)
            except Exception:
                pass
        document = None
        app = None
        gc.collect()
        if initialized:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


def _convert_excel(source: Path, target: Path) -> None:
    import pythoncom
    import win32com.client

    app = None
    workbook = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
        app = win32com.client.DispatchEx("Excel.Application")
        _set_optional(app, "Visible", False)
        _set_optional(app, "DisplayAlerts", False)
        _set_optional(app, "AskToUpdateLinks", False)
        _set_optional(app, "EnableEvents", False)
        # msoAutomationSecurityForceDisable = 3
        _set_optional(app, "AutomationSecurity", 3)

        workbook = app.Workbooks.Open(
            str(source.resolve()),
            UpdateLinks=0,
            ReadOnly=True,
            IgnoreReadOnlyRecommended=True,
            AddToMru=False,
            Notify=False,
            CorruptLoad=0,
        )
        workbook.SaveAs(
            str(target),
            FileFormat=51,
            ConflictResolution=2,
            AddToMru=False,
        )
    except Exception as exc:
        raise LegacyConversionError(
            f"XLS 转 XLSX 失败: {exc}",
            code="CONVERSION_FAILED",
        ) from exc
    finally:
        if workbook is not None:
            try:
                workbook.Close(SaveChanges=False)
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        workbook = None
        app = None
        gc.collect()
        if initialized:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


def _convert_powerpoint(source: Path, target: Path) -> None:
    import pythoncom
    import win32com.client

    app = None
    presentation = None
    initialized = False
    try:
        pythoncom.CoInitialize()
        initialized = True
        app = win32com.client.DispatchEx("PowerPoint.Application")
        _set_optional(app, "Visible", False)
        # ppAlertsNone = 1
        _set_optional(app, "DisplayAlerts", 1)
        presentation = app.Presentations.Open(
            str(source.resolve()),
            ReadOnly=True,
            Untitled=False,
            WithWindow=False,
        )
        presentation.SaveAs(str(target), 24)
    except Exception as exc:
        raise LegacyConversionError(
            f"PPT 转 PPTX 失败: {exc}",
            code="CONVERSION_FAILED",
        ) from exc
    finally:
        if presentation is not None:
            try:
                presentation.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        presentation = None
        app = None
        gc.collect()
        if initialized:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


def _libreoffice_executable(settings: dict) -> Path:
    configured = str(settings.get("libreOfficePath") or "").strip()
    if not configured:
        raise LegacyConversionError(
            "未配置 LibreOffice 可执行文件路径（libreOfficePath）",
            code="CONVERTER_NOT_AVAILABLE",
        )
    path = Path(configured)
    if not path.is_file():
        raise LegacyConversionError(
            f"LibreOffice 可执行文件不存在: {path}",
            code="CONVERTER_NOT_AVAILABLE",
        )
    return path


def _convert_libreoffice(source: Path, target: Path, converted_format: str, settings: dict, temp_dir: Path) -> None:
    executable = _libreoffice_executable(settings)
    profile_dir = temp_dir / "libreoffice-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    output_dir = target.parent
    command = [
        str(executable),
        f"-env:UserInstallation={profile_dir.as_uri()}",
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        converted_format,
        "--outdir",
        str(output_dir),
        str(source.resolve()),
    ]
    timeout_ms = int(settings.get("legacyConversionTimeoutMs") or 180000)
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max(1, timeout_ms) / 1000,
            check=False,
            creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as exc:
        raise LegacyConversionError(
            f"LibreOffice 转换超时（>{timeout_ms}ms）",
            code="CONVERSION_TIMEOUT",
        ) from exc
    except OSError as exc:
        raise LegacyConversionError(
            f"启动 LibreOffice 失败: {exc}",
            code="CONVERTER_NOT_AVAILABLE",
        ) from exc

    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "").strip()
        raise LegacyConversionError(
            f"LibreOffice 转换失败: {details or f'退出码 {completed.returncode}'}",
            code="CONVERSION_FAILED",
        )
    if not target.exists():
        details = (completed.stderr or completed.stdout or "").strip()
        raise LegacyConversionError(
            f"LibreOffice 未生成预期的 {target.name}: {details}".rstrip(),
            code="CONVERSION_OUTPUT_INVALID",
        )


def _convert(source: Path, target: Path, converted_format: str, provider: str, settings: dict, temp_dir: Path) -> None:
    if provider == "office_com":
        if os.name != "nt":
            raise LegacyConversionError(
                "Office COM 旧格式转换仅支持 Windows",
                code="CONVERTER_NOT_AVAILABLE",
            )
        suffix = source.suffix.lower()
        if suffix == ".doc":
            _convert_word(source, target)
        elif suffix == ".xls":
            _convert_excel(source, target)
        elif suffix == ".ppt":
            _convert_powerpoint(source, target)
        else:
            raise LegacyConversionError(
                f"Office COM 不支持的旧格式: {suffix}",
                code="CONVERTER_NOT_AVAILABLE",
            )
        return
    if provider == "libreoffice":
        _convert_libreoffice(source, target, converted_format, settings, temp_dir)
        return
    if provider == "disabled":
        raise LegacyConversionError(
            "旧格式转换已在配置中禁用",
            code="CONVERTER_NOT_AVAILABLE",
        )
    raise LegacyConversionError(
        f"不支持的旧格式转换 provider: {provider}",
        code="CONVERTER_NOT_AVAILABLE",
    )


@contextmanager
def convert_legacy_document(source: str | Path, settings: dict) -> Iterator[ConvertedDocument]:
    """将 `.doc` / `.xls` / `.ppt` 转换为临时 OOXML 文件。

    转换产物只在上下文中有效。调用方必须在上下文内完成下游提取，
    离开上下文后临时目录会被删除。
    """
    original = Path(source)
    if not original.is_file():
        raise LegacyConversionError(
            f"源文件不存在: {original}",
            code="INVALID_SOURCE",
        )
    converted_format, suffix, _app, _file_format = _target_for(original)
    provider = _select_provider(settings)
    original_format = original.suffix.lower().lstrip(".")
    warnings = [
        f"旧版 {original_format.upper()} 经 {provider} 转换为 {converted_format.upper()} 后提取；复杂版式、公式、OLE 或图表可能存在兼容性差异。"
    ]
    if original_format == "xls":
        warnings.append(
            "如果源文件包含 VBA 宏，转换为 XLSX 后不会保留宏。"
        )

    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="doc_intake_legacy_") as temp_name:
        temp_dir = Path(temp_name)
        target = temp_dir / f"{original.stem}{suffix}"
        if provider == "office_com":
            with _COM_LOCK:
                _convert(original, target, converted_format, provider, settings, temp_dir)
        else:
            _convert(original, target, converted_format, provider, settings, temp_dir)
        _validate_output(target, converted_format)
        duration_ms = int((time.perf_counter() - started) * 1000)
        yield ConvertedDocument(
            original_path=original,
            converted_path=target,
            original_format=original_format,
            converted_format=converted_format,
            provider=provider,
            warnings=warnings,
            duration_ms=duration_ms,
        )
