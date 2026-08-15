"""XLSX 文档提取器"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from legacy_converter import (
    LegacyConversionError,
    convert_legacy_document,
    restore_original_heading,
)
from .emf_converter import extract_and_convert_media
from ._utils import (
    ExtractedMedia,
    format_media_ref,
    local_name as _local_name,
    element_text as _element_text,
    markdown_table as _markdown_table,
)


def _cell_ref_to_col_index(ref: str) -> int:
    """将单元格引用（如 B2）转换为列索引（从1开始）"""
    match = re.match(r"([A-Z]+)(\d+)", ref)
    if not match:
        return 0
    col_str = match.group(1)
    result = 0
    for ch in col_str:
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result


def _cell_ref_to_row_col(ref: str) -> tuple[int, int]:
    """将单元格引用（如 B2）转换为 (行号, 列索引)"""
    match = re.match(r"([A-Z]+)(\d+)", ref)
    if not match:
        return 0, 0
    col_str = match.group(1)
    row_num = int(match.group(2))
    col_index = 0
    for ch in col_str:
        col_index = col_index * 26 + (ord(ch) - ord("A") + 1)
    return row_num, col_index


class XlsxExtractor(BaseExtractor):
    """XLSX/XLSM 提取器"""

    name = "xlsx"

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        max_rows: int | None = None,
        max_cols: int | None = None,
        **kwargs,
    ) -> ExtractionResult:
        path = self._check_file_exists(source)
        if path.suffix.lower() == ".xls":
            return self._handle_legacy_xls(
                path, output_dir, include_images, max_rows, max_cols
            )

        result = ExtractionResult()
        max_rows = int(
            max_rows if max_rows is not None else self.settings.get("xlsxMaxRows", 100)
        )
        max_cols = int(
            max_cols if max_cols is not None else self.settings.get("xlsxMaxCols", 50)
        )
        if max_rows <= 0 or max_cols <= 0:
            raise ValueError("xlsxMaxRows 和 xlsxMaxCols 必须大于 0")

        truncation_warnings: list[str] = []
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())

            # 检查是否是有效的 XLSX
            if "xl/workbook.xml" not in names:
                result.warnings.append("无效的 XLSX 文件: 缺少 xl/workbook.xml")
                return result

            # 获取共享字符串
            strings = self._shared_strings(zf)

            # 获取工作表列表
            sheets = self._workbook_sheets(zf, names)

            # 抽取所有媒体(图片/视频/音频),按 drawings 中引用顺序排序
            media_list: list[ExtractedMedia] = []
            if include_images:
                media_files = sorted(name for name in names if name.startswith("xl/media/"))
                # 优先按 drawings 引用顺序排,保证编号顺序 = 用户视觉顺序
                media_files = self._sort_media_by_drawings(zf, names, media_files)
                media_list = extract_and_convert_media(media_files, zf, output_dir or "", path.stem)
                result.images = [m.local_path for m in media_list]

            # 解析媒体锚定位置(按 1-based 编号,按 sheet 分组)
            media_anchors: dict[str, dict[str, int]] = {}
            if include_images:
                media_anchors = self._parse_media_anchors(zf, names, sheets, len(media_list))

            # 构建媒体映射: media_index (1-based) -> ExtractedMedia
            media_map: dict[int, ExtractedMedia] = (
                {i + 1: m for i, m in enumerate(media_list)} if include_images else {}
            )

            # 提取文本（包含媒体引用）
            result.markdown = self._extract_text(
                zf, sheets, strings, path.name, names, max_rows, max_cols,
                include_images, media_map, media_anchors, path.stem,
                truncation_warnings,
            )

        result.warnings.extend(truncation_warnings)
        result.metadata = {
            "format": "xlsx",
            "reader": "xlsx_extractor",
            "sheets": len(sheets),
        }
        return result

    def _handle_legacy_xls(
        self,
        path: Path,
        output_dir: str | None,
        include_images: bool,
        max_rows: int | None,
        max_cols: int | None,
    ) -> ExtractionResult:
        """将旧版 .xls 转为临时 .xlsx 后复用当前提取器。"""
        result = ExtractionResult()
        try:
            with convert_legacy_document(path, self.settings) as converted:
                result = self.extract(
                    source=str(converted.converted_path),
                    output_dir=output_dir,
                    include_images=include_images,
                    max_rows=max_rows,
                    max_cols=max_cols,
                )
                result.markdown = restore_original_heading(
                    result.markdown,
                    path.name,
                    converted.converted_path.name,
                )
                result.metadata.update({
                    "format": "xls",
                    "reader": "xlsx_extractor",
                    "originalFormat": converted.original_format,
                    "convertedFormat": converted.converted_format,
                    "conversionProvider": converted.provider,
                    "conversionStatus": "success",
                    "conversionWarnings": converted.warnings,
                    "conversionDurationMs": converted.duration_ms,
                })
                result.warnings = converted.warnings + result.warnings
        except LegacyConversionError as exc:
            result.metadata.update({
                "format": "xls",
                "reader": "xlsx_extractor",
                "originalFormat": "xls",
                "convertedFormat": "xlsx",
                "conversionStatus": "failed",
                "conversionErrorCode": exc.code,
            })
            result.warnings.append(str(exc))
            result.markdown = f"# 错误\n\n{exc}"
        except ImportError:
            result.metadata.update({
                "format": "xls",
                "reader": "xlsx_extractor",
                "originalFormat": "xls",
                "convertedFormat": "xlsx",
                "conversionStatus": "failed",
                "conversionErrorCode": "CONVERTER_NOT_AVAILABLE",
            })
            result.warnings.append("需要安装 pywin32: pip install pywin32")
            result.markdown = "# 错误\n\n需要安装 pywin32 才能转换 .xls 文件"
        except Exception as exc:
            result.metadata.update({
                "format": "xls",
                "reader": "xlsx_extractor",
                "originalFormat": "xls",
                "convertedFormat": "xlsx",
                "conversionStatus": "failed",
                "conversionErrorCode": "CONVERSION_FAILED",
            })
            result.warnings.append(f"XLS 转换失败: {exc}")
            result.markdown = f"# 错误\n\nXLS 转换失败: {exc}"
        return result

    def _sort_media_by_drawings(self, zf, names: set, media_files: list[str]) -> list[str]:
        """按 drawings 中的 anchor 出现顺序排 media_files。

        编号顺序 = 用户视觉顺序(同一张图被多 sheet 引用时,取首次出现)。
        接受 rels Target 两种格式: 'media/xxx' 或 '../media/xxx'。
        anchor 内含多种媒体引用类型(blip / videoFile / audioFile / p14:media / imgLayer),
        全部按出现顺序计入。
        """
        if not media_files:
            return media_files
        try:
            drawing_files = sorted(
                name for name in names
                if name.startswith("xl/drawings/") and name.endswith(".xml")
            )
            order: list[str] = []
            seen: set[str] = set()
            for df in drawing_files:
                drawing_xml = zf.read(df)
                drawing_root = ET.fromstring(drawing_xml)
                # 通过 blip/imgLayer 的 r:embed 找 rels -> media
                rels_path = f"xl/drawings/_rels/{Path(df).name}.rels"
                rid_to_path: dict[str, str] = {}
                if rels_path in zf.namelist():
                    rrels = ET.fromstring(zf.read(rels_path))
                    for rel in rrels:
                        if _local_name(rel.tag) == "Relationship":
                            rid = rel.get("Id", "")
                            target = rel.get("Target", "")
                            target_normalized = re.sub(r'^\.\./', '', target)
                            if target_normalized.startswith("media/"):
                                rid_to_path[rid] = f"xl/{target_normalized}"
                # 按出现顺序遍历: 收集所有媒体引用 rId(blip/imgLayer 用 r:embed,
                # videoFile/audioFile/p14:media 用 r:embed 或 r:link)。去重保留首次。
                for elem in drawing_root.iter():
                    tag = _local_name(elem.tag)
                    rid = ""
                    if tag in ("blip", "imgLayer", "media"):
                        rid = elem.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                    elif tag in ("videoFile", "audioFile"):
                        rid = elem.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}link", ""
                        )
                    if rid and rid in rid_to_path:
                        mp = rid_to_path[rid]
                        if mp in media_files and mp not in seen:
                            order.append(mp)
                            seen.add(mp)
            # 未在 drawings 引用的追加到末尾
            for mp in media_files:
                if mp not in seen:
                    order.append(mp)
            return order
        except Exception:
            return media_files

    def _parse_media_anchors(
        self,
        zf: zipfile.ZipFile,
        names: set,
        sheets: list[dict],
        media_count: int,
    ) -> dict[str, dict[str, int]]:
        """解析媒体锚定位置，返回 {sheet_name: {R{row}C{col}: media_index (1-based)}}。

        修过 bug:原来返回扁平 dict {R{row}C{col}: media_index},多 sheet 场景下
        sheet2 的 R1C1 会覆盖 sheet1 的 R1C1,索引计数也从每个 drawing 都重 1 开始。

        现在:
        - 从 sheet 的 rels 查出它引用的 drawing.xml,drawing 与 sheet 严格一一对应
        - media_index 是全局递增(跨 drawing,跨 sheet),保证与 _sort_media_by_drawings
          给出的 media_files 顺序一致
        - 返回嵌套 dict,_extract_text 按 sheet 名取值,不再误用其他 sheet 的 anchor
        """
        # sheet_name -> drawing_xml path(从 sheet rels 查)
        sheet_to_drawing: dict[str, str] = {}
        for sheet_info in sheets:
            sheet_file = sheet_info.get("file", "")
            if not sheet_file:
                continue
            rels_path = sheet_file.replace(
                "xl/worksheets/", "xl/worksheets/_rels/"
            ) + ".rels"
            if rels_path in zf.namelist():
                try:
                    rroot = ET.fromstring(zf.read(rels_path))
                    for rel in rroot:
                        if _local_name(rel.tag) == "Relationship":
                            target = rel.get("Target", "")
                            target_norm = re.sub(r'^\.\./', '', target)
                            if target_norm.startswith("drawings/"):
                                sheet_to_drawing[sheet_info["name"]] = (
                                    f"xl/{target_norm}"
                                )
                                break
                except Exception:
                    continue

        anchors_by_sheet: dict[str, dict[str, int]] = {}

        global_media_index = 0
        for sheet_name, drawing_file in sheet_to_drawing.items():
            if drawing_file not in zf.namelist():
                continue
            try:
                drawing_root = ET.fromstring(zf.read(drawing_file))
                sheet_anchors: dict[str, int] = {}
                for anchor in drawing_root.iter():
                    anchor_tag = _local_name(anchor.tag)
                    if anchor_tag in ("twoCellAnchor", "oneCellAnchor"):
                        first_ref_rid = ""
                        for c in anchor.iter():
                            t = _local_name(c.tag)
                            if t in ("blip", "imgLayer", "media"):
                                first_ref_rid = c.get(
                                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                                )
                                if first_ref_rid:
                                    break
                            elif t in ("videoFile", "audioFile"):
                                first_ref_rid = c.get(
                                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}link", ""
                                )
                                if first_ref_rid:
                                    break
                        if first_ref_rid:
                            global_media_index += 1
                            if global_media_index > media_count:
                                break
                            col = 0
                            row = 0
                            for child in anchor:
                                if _local_name(child.tag) == "from":
                                    for pos in child:
                                        pos_tag = _local_name(pos.tag)
                                        if pos_tag == "col":
                                            col = int(pos.text or "0") + 1
                                        elif pos_tag == "row":
                                            row = int(pos.text or "0") + 1
                            if row > 0 and col > 0:
                                sheet_anchors[f"R{row}C{col}"] = global_media_index
                anchors_by_sheet[sheet_name] = sheet_anchors
            except Exception:
                continue

        return anchors_by_sheet

    def _shared_strings(self, zf: zipfile.ZipFile) -> list[str]:
        """获取共享字符串表"""
        try:
            ss_xml = zf.read("xl/sharedStrings.xml")
            root = ET.fromstring(ss_xml)
            strings = []
            for si in root.iter():
                if _local_name(si.tag) == "si":
                    text = _element_text(si)
                    strings.append(text)
            return strings
        except Exception:
            return []

    def _workbook_sheets(self, zf: zipfile.ZipFile, names: set) -> list[dict]:
        """获取工作表列表。

        每个 sheet dict 含:
        - name: sheet 名
        - id:   workbook.xml.rels 里的 rId
        - file: xl/worksheets/sheetN.xml 的完整路径(从 rels 解析,不靠遍历猜)

        修过 bug:原来 sheet "file" 字段是从 names 里硬搜 "xl/worksheets/sheet*.xml"
        第一个匹配,所有 sheet 都指向同一个文件。多 sheet 场景下只有第一个 sheet
        能正确抽取,后面的 sheet 实际抽的是第一个 sheet 的内容。
        """
        sheets: list[dict] = []
        rid_to_target: dict[str, str] = {}

        # 先解析 workbook.xml.rels 得到 rId → target
        try:
            rels_xml = zf.read("xl/_rels/workbook.xml.rels")
            rels_root = ET.fromstring(rels_xml)
            for rel in rels_root:
                if _local_name(rel.tag) == "Relationship":
                    rid = rel.get("Id", "")
                    target = rel.get("Target", "")
                    # target 可能是 'worksheets/sheet1.xml' 或 '../worksheets/sheet1.xml'
                    target_normalized = re.sub(r'^\.\./', '', target)
                    if target_normalized.startswith("worksheets/"):
                        rid_to_target[rid] = f"xl/{target_normalized}"
        except Exception:
            pass

        # 从 workbook.xml 拿 sheet 顺序(rId 决定 file)
        try:
            wb_xml = zf.read("xl/workbook.xml")
            wb_root = ET.fromstring(wb_xml)
            for sheet in wb_root.iter():
                if _local_name(sheet.tag) == "sheet":
                    name = sheet.get("name", "")
                    rid = sheet.get(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                        "",
                    )
                    file_path = rid_to_target.get(rid, "")
                    sheets.append({"name": name, "id": rid, "file": file_path})
        except Exception:
            pass

        # fallback:解析不到 rels 时按名字匹配(避免完全没数据)
        if not sheets:
            try:
                wb_xml = zf.read("xl/workbook.xml")
                wb_root = ET.fromstring(wb_xml)
                for sheet in wb_root.iter():
                    if _local_name(sheet.tag) == "sheet":
                        name = sheet.get("name", "")
                        rid = sheet.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                            "",
                        )
                        # 兼容模式:无 rels 时按 sheet 顺序一一匹配文件
                        file_path = ""
                        for n in sorted(names):
                            if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"):
                                file_path = n
                                break
                        sheets.append({"name": name, "id": rid, "file": file_path})
            except Exception:
                pass

        return sheets

    def _extract_text(
        self,
        zf: zipfile.ZipFile,
        sheets: list[dict],
        strings: list[str],
        filename: str,
        names: set,
        max_rows: int,
        max_cols: int,
        include_images: bool = True,
        media_map: dict[int, ExtractedMedia] | None = None,
        media_anchors: dict | None = None,
        stem: str = "",
        truncation_warnings: list[str] | None = None,
    ) -> str:
        """提取 XLSX 文本内容。

        media_anchors 格式: {sheet_name: {R{row}C{col}: media_index}},
        按 sheet 名取自己的 anchor,避免多 sheet 错配。
        """
        lines = [f"# {filename}", ""]

        if media_map is None:
            media_map = {}
        if media_anchors is None:
            media_anchors = {}

        for sheet_info in sheets:
            sheet_name = sheet_info["name"]
            sheet_file = sheet_info.get("file", "")

            if not sheet_file or sheet_file not in zf.namelist():
                continue

            # 该 sheet 自己的 anchor(嵌套 dict 取这一层)
            sheet_anchors = media_anchors.get(sheet_name, {})

            try:
                sheet_xml = zf.read(sheet_file)
                sheet_root = ET.fromstring(sheet_xml)

                rows_out = []

                for row in sheet_root.iter():
                    if _local_name(row.tag) != "row":
                        continue

                    row_index = int(row.get("r", "0"))
                    if row_index > max_rows:
                        continue

                    values = [""] * max_cols

                    for cell in row:
                        if _local_name(cell.tag) != "c":
                            continue

                        cell_ref = cell.get("r", "")
                        if not cell_ref:
                            continue

                        col_index = _cell_ref_to_col_index(cell_ref)
                        if col_index > max_cols:
                            continue

                        value = ""
                        for v in cell.iter():
                            if _local_name(v.tag) == "v":
                                value = v.text or ""
                                break

                        cell_type = cell.get("t", "")
                        if cell_type == "s" and value:
                            try:
                                value = strings[int(value)]
                            except (ValueError, IndexError):
                                pass

                        try:
                            if cell_type not in ("s", "inlineStr") and value:
                                display: object = float(value)
                                raw = str(value)
                                if "." in raw:
                                    frac = raw.split(".", 1)[1]
                                    if frac and set(frac) <= {"0"}:
                                        display = int(display)
                                else:
                                    display = int(display)
                            else:
                                display = value
                        except (ValueError, TypeError):
                            display = value

                        values[col_index - 1] = str(display) if display else ""

                        # 检查该单元格是否有媒体(图/视/音)
                        cell_key = f"R{row_index}C{col_index}"
                        if cell_key in sheet_anchors:
                            m_idx = sheet_anchors[cell_key]
                            if m_idx in media_map:
                                m = media_map[m_idx]
                                rel = f"{stem}_media/{Path(m.local_path).name}"
                                icon = {"image": "📷", "video": "🎬", "audio": "🎵"}.get(m.kind, "📎")
                                ref = f"[{icon}]({rel})"
                                values[col_index - 1] = (
                                    f"{values[col_index - 1]} {ref}" if values[col_index - 1] else ref
                                )

                    if any(values):
                        while len(rows_out) < row_index - 1:
                            rows_out.append([""] * max_cols)
                        rows_out.append(values)

                if any(
                    int(row.get("r", "0")) > max_rows
                    for row in sheet_root.iter()
                    if _local_name(row.tag) == "row"
                ) and truncation_warnings is not None:
                    truncation_warnings.append(
                        f"工作表“{sheet_name}”超过 {max_rows} 行，已截断"
                    )
                if any(
                    _cell_ref_to_col_index(cell.get("r", "")) > max_cols
                    for cell in sheet_root.iter()
                    if _local_name(cell.tag) == "c"
                ) and truncation_warnings is not None:
                    truncation_warnings.append(
                        f"工作表“{sheet_name}”超过 {max_cols} 列，已截断"
                    )

                lines.append(f"## Sheet: {sheet_name}")
                lines.append("")

                if rows_out:
                    used_width = max((len(row) for row in rows_out), default=0)
                    for row in rows_out:
                        while len(row) > used_width and not row[-1]:
                            row.pop()
                        while len(row) < used_width:
                            row.append("")
                    lines.append(_markdown_table(rows_out))
                else:
                    lines.append("[Empty sheet]")

                # 未锚定的媒体在表格后列出(跨 sheet 汇总,只在最后一个 sheet 后打一次,
                # 避免每 sheet 都重复列。)
                if include_images and media_map:
                    used_indices: set[int] = set()
                    for _anchors in media_anchors.values():
                        used_indices.update(_anchors.values())
                    unanchored = [
                        i for i in media_map.keys()
                        if i not in used_indices
                    ]
                    if unanchored and sheet_info is sheets[-1]:
                        lines.append("")
                        lines.append("### 其他媒体")
                        for m_idx in unanchored:
                            m = media_map[m_idx]
                            rel = f"{stem}_media/{Path(m.local_path).name}"
                            alt = f"{m.kind}{m_idx}"
                            lines.append(format_media_ref(rel, m.kind, alt))

                lines.append("")

            except Exception as e:
                lines.append(f"## Sheet: {sheet_name}")
                lines.append("")
                lines.append(f"[Error reading sheet: {e}]")
                lines.append("")

        return "\n".join(lines).strip() + "\n"
