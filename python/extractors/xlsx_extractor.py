"""XLSX 文档提取器"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
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
        max_rows: int = 100,
        max_cols: int = 50,
        **kwargs,
    ) -> ExtractionResult:
        path = self._check_file_exists(source)
        result = ExtractionResult()

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
                result.media_kinds = [m.kind for m in media_list]

            # 解析媒体锚定位置(按 1-based 编号)
            media_anchors: dict[str, int] = {}
            if include_images:
                media_anchors = self._parse_media_anchors(zf, names, len(media_list))

            # 构建媒体映射: media_index (1-based) -> ExtractedMedia
            media_map: dict[int, ExtractedMedia] = (
                {i + 1: m for i, m in enumerate(media_list)} if include_images else {}
            )

            # 提取文本（包含媒体引用）
            result.markdown = self._extract_text(
                zf, sheets, strings, path.name, names, max_rows, max_cols,
                include_images, media_map, media_anchors, path.stem
            )

        result.metadata = {
            "format": "xlsx",
            "reader": "xlsx_extractor",
            "sheets": len(sheets),
        }
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
                # 按出现顺序遍历: 收集 anchor 内所有媒体引用 rId(blip/imgLayer 用 r:embed,
                # videoFile/audioFile/p14:media 用 r:embed 或 r:link)
                anchor_media_rids: list[str] = []
                for elem in drawing_root.iter():
                    tag = _local_name(elem.tag)
                    if tag == "twoCellAnchor" or tag == "oneCellAnchor":
                        anchor_media_rids = []  # 每个 anchor 单独计数
                    elif tag in ("blip", "imgLayer"):
                        embed = elem.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                        if embed:
                            anchor_media_rids.append(embed)
                    elif tag in ("videoFile", "audioFile"):
                        link = elem.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}link", ""
                        )
                        if link:
                            anchor_media_rids.append(link)
                    elif tag == "media":
                        embed = elem.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                        if embed:
                            anchor_media_rids.append(embed)
                    # 一个 anchor 结束后(下一个 anchor 开始时),处理之前收集的 rId
                    if tag in ("twoCellAnchor", "oneCellAnchor"):
                        # 这是开头,但 anchor 还没结束(可能还有子元素)。
                        # 实际我们用上面的顺序收集,只在这里标记 anchor 结束。
                        # 为避免重复,只在下一个 anchor 开始时 flush 上一个。
                        pass
                # 简化版:直接按出现顺序记录所有引用的 rId 对应 media(去重保留首次)
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

    def _parse_media_anchors(self, zf: zipfile.ZipFile, names: set, media_count: int) -> dict[str, int]:
        """解析媒体锚定位置，返回 {R{row}C{col}: media_index (1-based)}。

        按 drawings 中 anchor 出现顺序计数(每个 anchor 一个媒体)。
        媒体来源: blip / imgLayer (r:embed) / videoFile / audioFile (r:link) / p14:media (r:embed)。
        """
        anchors: dict[str, int] = {}

        drawing_files = sorted(
            name for name in names
            if name.startswith("xl/drawings/") and name.endswith(".xml")
        )

        for drawing_file in drawing_files:
            try:
                drawing_xml = zf.read(drawing_file)
                drawing_root = ET.fromstring(drawing_xml)

                media_index = 0
                for anchor in drawing_root.iter():
                    anchor_tag = _local_name(anchor.tag)
                    if anchor_tag in ("twoCellAnchor", "oneCellAnchor"):
                        # 只在 anchor 出现第一个媒体引用时 +1
                        # 同一个 anchor 内的多个引用都属同一媒体
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
                            media_index += 1
                            if media_index > media_count:
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
                                anchors[f"R{row}C{col}"] = media_index
            except Exception:
                continue

        return anchors

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
        """获取工作表列表"""
        sheets = []
        
        # 解析 workbook.xml 获取工作表信息
        try:
            wb_xml = zf.read("xl/workbook.xml")
            wb_root = ET.fromstring(wb_xml)
            
            for sheet in wb_root.iter():
                if _local_name(sheet.tag) == "sheet":
                    name = sheet.get("name", "")
                    sheet_id = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
                    sheets.append({"name": name, "id": sheet_id})
        except Exception:
            pass
        
        # 如果没有找到工作表，尝试从关系文件中获取
        if not sheets:
            try:
                rels_xml = zf.read("xl/_rels/workbook.xml.rels")
                rels_root = ET.fromstring(rels_xml)
                
                for rel in rels_root:
                    if _local_name(rel.tag) == "Relationship":
                        target = rel.get("Target", "")
                        rId = rel.get("Id", "")
                        if target.startswith("worksheets/sheet"):
                            sheets.append({"name": Path(target).stem, "id": rId})
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
    ) -> str:
        """提取 XLSX 文本内容"""
        lines = [f"# {filename}", ""]

        if media_map is None:
            media_map = {}
        if media_anchors is None:
            media_anchors = {}

        for sheet_info in sheets:
            sheet_name = sheet_info["name"]

            sheet_file = None
            for name in names:
                if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                    sheet_file = name
                    break

            if not sheet_file:
                continue

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
                        if cell_key in media_anchors:
                            m_idx = media_anchors[cell_key]
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

                # 未锚定的媒体在表格后列出
                if include_images and media_map:
                    unanchored = [
                        i for i in media_map.keys()
                        if i not in media_anchors.values()
                    ]
                    if unanchored:
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