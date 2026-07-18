"""XLSX 文档提取器"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .emf_converter import extract_and_convert_media
from ._utils import local_name as _local_name, element_text as _element_text, markdown_table as _markdown_table


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

            # 提取图片
            images = []
            if include_images:
                images = self._extract_media(zf, names, output_dir, path.stem)
                result.images = images

            # 解析图片锚定位置
            image_anchors = {}
            if include_images:
                image_anchors = self._parse_image_anchors(zf, names, images)

            # 构建图片映射（图片编号 -> 本地路径）
            image_path_map = {}
            if include_images and output_dir:
                image_path_map = self._build_image_path_map(images, output_dir, path.stem)

            # 提取文本（包含图片引用）
            result.markdown = self._extract_text(
                zf, sheets, strings, path.name, names, max_rows, max_cols,
                include_images, image_path_map, image_anchors
            )

        result.metadata = {
            "format": "xlsx",
            "reader": "xlsx_extractor",
            "sheets": len(sheets),
        }
        return result

    def _build_image_path_map(self, images: list[str], output_dir: str, stem: str) -> dict[int, str]:
        """构建图片编号到本地路径的映射"""
        image_path_map = {}
        
        for i, img_path in enumerate(images, 1):
            local_filename = Path(img_path).name
            rel_path = f"{stem}_images/{local_filename}"
            image_path_map[i] = rel_path
        
        return image_path_map

    def _parse_image_anchors(self, zf: zipfile.ZipFile, names: set, images: list[str]) -> dict[str, int]:
        """解析图片锚定位置，返回 {(sheet_name, row, col): image_index}"""
        anchors = {}
        
        # 查找 drawings 目录下的文件
        drawing_files = sorted(name for name in names if name.startswith("xl/drawings/") and name.endswith(".xml"))
        
        for drawing_file in drawing_files:
            try:
                drawing_xml = zf.read(drawing_file)
                drawing_root = ET.fromstring(drawing_xml)
                
                # 查找所有图片锚定
                img_index = 0
                for anchor in drawing_root.iter():
                    anchor_tag = _local_name(anchor.tag)
                    
                    # 处理两个锚定类型：xdr:twoCellAnchor 和 xdr:oneCellAnchor
                    if anchor_tag in ("twoCellAnchor", "oneCellAnchor"):
                        img_index += 1
                        if img_index > len(images):
                            break
                        
                        # 获取锚定位置
                        from_tag = None
                        col = 0
                        row = 0
                        
                        for child in anchor:
                            child_tag = _local_name(child.tag)
                            if child_tag == "from":
                                from_tag = child
                        
                        if from_tag is not None:
                            for pos in from_tag:
                                pos_tag = _local_name(pos.tag)
                                if pos_tag == "col":
                                    col = int(pos.text or "0") + 1  # 转为1-based
                                elif pos_tag == "row":
                                    row = int(pos.text or "0") + 1  # 转为1-based
                        
                        if row > 0 and col > 0:
                            # 使用位置作为键
                            key = f"R{row}C{col}"
                            anchors[key] = img_index
                            
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
        image_path_map: dict = None,
        image_anchors: dict = None,
    ) -> str:
        """提取 XLSX 文本内容"""
        lines = [f"# {filename}", ""]
        
        if image_path_map is None:
            image_path_map = {}
        if image_anchors is None:
            image_anchors = {}

        for sheet_info in sheets:
            sheet_name = sheet_info["name"]
            
            # 查找工作表文件
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
                
                # 解析行和列
                rows_out = []
                used_rows = set()
                
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
                        
                        # 获取单元格值
                        value = ""
                        for v in cell.iter():
                            if _local_name(v.tag) == "v":
                                value = v.text or ""
                                break
                        
                        # 检查是否是共享字符串
                        cell_type = cell.get("t", "")
                        if cell_type == "s" and value:
                            try:
                                value = strings[int(value)]
                            except (ValueError, IndexError):
                                pass
                        
                        # 数字 cell（默认 t="" 或 t="n"）: 原始值是数字字符串。
                        # 原值如 "1.5" 保持 "1.5"；"1.00" / "1.0" 截成 "1"(小数部分全 0)。
                        # 原逻辑 `display == int(display)` 会把 "1.5" 错误变 "1"(因为 1.5 != int(1.5)=1
                        # 走 False 分支,但 1.5 != 1 实际不截,只是凑巧;更糟的是 1.50 这种会被错误截断)。
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
                        
                        # 检查该单元格是否有图片
                        cell_key = f"R{row_index}C{col_index}"
                        if cell_key in image_anchors:
                            img_idx = image_anchors[cell_key]
                            if img_idx in image_path_map:
                                # 在单元格值后添加图片标记
                                img_ref = image_path_map[img_idx]
                                values[col_index - 1] = f"{values[col_index - 1]} [📷]({img_ref})" if values[col_index - 1] else f"[📷]({img_ref})"
                    
                    if any(values):
                        used_rows.add(row_index)
                        while len(rows_out) < row_index - 1:
                            rows_out.append([""] * max_cols)
                        rows_out.append(values)

                lines.append(f"## Sheet: {sheet_name}")
                lines.append("")

                if rows_out:
                    # 截断到实际使用的列数
                    used_width = max((len(row) for row in rows_out), default=0)
                    for row in rows_out:
                        while len(row) > used_width and not row[-1]:
                            row.pop()
                        while len(row) < used_width:
                            row.append("")

                    # 生成表格
                    lines.append(_markdown_table(rows_out))
                else:
                    lines.append("[Empty sheet]")

                # 如果有图片但没有锚定位置，在表格后列出
                if include_images and image_path_map:
                    unanchored = [i for i in image_path_map.keys() 
                                  if not any(v == i for v in image_anchors.values())]
                    if unanchored:
                        lines.append("")
                        lines.append("### 其他图片")
                        for img_idx in unanchored:
                            img_path = image_path_map[img_idx]
                            lines.append(f"![image{img_idx}]({img_path})")

                lines.append("")

            except Exception as e:
                lines.append(f"## Sheet: {sheet_name}")
                lines.append("")
                lines.append(f"[Error reading sheet: {e}]")
                lines.append("")

        return "\n".join(lines).strip() + "\n"

    def _extract_media(
        self,
        zf: zipfile.ZipFile,
        names: set,
        output_dir: str | None,
        stem: str,
    ) -> list[str]:
        """提取 XLSX 中的嵌入图片"""
        media_files = sorted(name for name in names if name.startswith("xl/media/"))
        if not media_files:
            return []

        if not output_dir:
            return media_files

        return extract_and_convert_media(
            media_files, zf, output_dir, stem
        )