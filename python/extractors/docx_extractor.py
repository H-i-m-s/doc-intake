"""DOCX 文档提取器"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .emf_converter import extract_and_convert_media
from .omml_converter import OmmlToLatexConverter
from .mathtype_filter import filter_mathtype_previews
from ._utils import local_name as _local_name, markdown_table as _markdown_table
from logger import get_logger

logger = get_logger("docx_extractor")


class DocxExtractor(BaseExtractor):
    """DOCX 提取器，支持文本、图片、公式（OMML + MathType）和复杂表格"""

    name = "docx"

    def __init__(self, settings: dict):
        super().__init__(settings)
        self.omml_converter = OmmlToLatexConverter()
        self._mathtype_converter = None
    
    @property
    def mathtype_converter(self):
        """延迟加载 MathType 转换器"""
        if self._mathtype_converter is None:
            try:
                from mathtype_converter import MathTypeConverter
                self._mathtype_converter = MathTypeConverter()
            except ImportError:
                self._mathtype_converter = None
        return self._mathtype_converter

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        path = self._check_file_exists(source)
        result = ExtractionResult()

        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())

            if "word/document.xml" not in names:
                result.warnings.append("无效的 DOCX 文件")
                return result

            # 提取图片
            images = []
            if include_images:
                media_files = sorted(name for name in names if name.startswith("word/media/"))
                
                # 过滤 MathType 预览图片
                media_files = filter_mathtype_previews(media_files, zf)
                
                images = extract_and_convert_media(media_files, zf, output_dir or "", path.stem)
                result.images = images

            # 构建图片映射
            image_path_map = {}
            if include_images and output_dir:
                image_path_map = self._build_image_path_map(zf, images, output_dir, path.stem)

            # 提取 MathType 公式
            mathtype_equations = []
            if self.mathtype_converter:
                try:
                    mathtype_equations = self.mathtype_converter.extract_mathtype_from_docx(source)
                except Exception as e:
                    logger.warning("MathType 提取失败，公式将退化为图片", error=str(e), source=source)

            # 提取文本
            result.markdown = self._extract_text(
                zf, path.name, include_images, image_path_map, mathtype_equations
            )

        result.metadata = {"format": "docx", "reader": "docx_extractor"}
        return result

    def _build_image_path_map(self, zf, images, output_dir, stem):
        image_path_map = {}
        
        # 获取所有媒体文件
        all_media_files = sorted(name for name in zf.namelist() if name.startswith("word/media/"))
        
        # 过滤 MathType 预览图片（与 extract 方法一致）
        media_files = filter_mathtype_previews(all_media_files, zf)
        
        for i, media_name in enumerate(media_files):
            if i < len(images):
                original_filename = media_name.split("/")[-1]
                local_filename = Path(images[i]).name
                image_path_map[f"word/media/{original_filename}"] = f"{stem}_images/{local_filename}"
        return image_path_map

    def _extract_text(self, zf, filename, include_images=True, image_path_map=None, mathtype_equations=None):
        """提取 DOCX 文本，只处理 body 的直接子元素，避免重复"""
        root = ET.fromstring(zf.read("word/document.xml"))
        lines = [f"# {filename}", ""]

        if image_path_map is None:
            image_path_map = {}
        if mathtype_equations is None:
            mathtype_equations = []

        # 构建 rId 映射
        rid_to_local = self._build_rid_map(zf, image_path_map)

        # 构建 MathType 公式映射（基于 rId）
        mathtype_map = {}
        
        # 从 rels 文件获取 rId 到 oleObject 的映射
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path in zf.namelist():
                rels_content = zf.read(rels_path).decode("utf-8")
                # 查找 oleObject 关系
                for match in re.finditer(r'Id="(rId\d+)"[^>]*Target="embeddings/(oleObject\d+\.bin)"', rels_content):
                    rId = match.group(1)
                    ole_file = match.group(2)
                    
                    # 查找对应的 MathType 公式
                    for eq in mathtype_equations:
                        if ole_file in eq.get("position", ""):
                            mathtype_map[rId] = eq["latex"]
                            break
        except Exception:
            pass
        
        # 解析 numbering.xml 获取列表类型映射
        num_type_map = self._parse_numbering(zf)

        # 找到 body 元素
        body = None
        for elem in root.iter():
            if _local_name(elem.tag) == "body":
                body = elem
                break
        
        if body is None:
            return "\n".join(lines)

        # 只处理 body 的直接子元素
        seen_content = set()
        
        for child in body:
            tag = _local_name(child.tag)
            
            if tag == "p":
                # 获取列表信息
                num_info = self._get_num_info(child, num_type_map)
                content = self._extract_paragraph(child, include_images, rid_to_local, mathtype_map, num_info)
                if content and content not in seen_content:
                    seen_content.add(content)
                    lines.append(content)
                    lines.append("")
            
            elif tag == "tbl":
                table_content = self._extract_table(child, include_images, rid_to_local, mathtype_map)
                if table_content:
                    lines.append(table_content)
                    lines.append("")
            
            elif tag == "sdt":
                # 内容控件
                for sdt_child in child:
                    sdt_tag = _local_name(sdt_child.tag)
                    if sdt_tag == "sdtContent":
                        for content_child in sdt_child:
                            ctag = _local_name(content_child.tag)
                            if ctag == "p":
                                content = self._extract_paragraph(content_child, include_images, rid_to_local, mathtype_map)
                                if content and content not in seen_content:
                                    seen_content.add(content)
                                    lines.append(content)
                                    lines.append("")
                            elif ctag == "tbl":
                                table_content = self._extract_table(content_child, include_images, rid_to_local)
                                if table_content:
                                    lines.append(table_content)
                                    lines.append("")
            
            elif tag == "OLEObject":
                # MathType OLE 对象（直接在 body 中）
                prog_id = child.get("ProgID", "")
                rId = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                    ""
                )
                if "Equation" in prog_id and rId:
                    for key, latex in mathtype_map.items():
                        if key in rId or rId in key:
                            lines.append(f"${latex}$")
                            lines.append("")
                            break

        return "\n".join(lines).strip() + "\n"

    def _build_rid_map(self, zf, image_path_map):
        """构建 rId 到图片路径的映射"""
        rid_to_local = {}
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path in zf.namelist():
                rels_root = ET.fromstring(zf.read(rels_path))
                for rel in rels_root:
                    if _local_name(rel.tag) == "Relationship":
                        rId = rel.get("Id", "")
                        target = rel.get("Target", "")
                        if target.startswith("media/"):
                            full_path = f"word/{target}"
                            if full_path in image_path_map:
                                rid_to_local[rId] = image_path_map[full_path]
        except Exception:
            pass
        return rid_to_local

    def _parse_numbering(self, zf):
        """解析 numbering.xml 获取列表类型映射"""
        num_type_map = {}  # numId -> {ilvl: type}
        
        try:
            if "word/numbering.xml" not in zf.namelist():
                return num_type_map
            
            content = zf.read("word/numbering.xml")
            root = ET.fromstring(content)
            
            # 解析 abstractNum（列表类型定义）
            abstract_nums = {}
            for elem in root:
                if _local_name(elem.tag) == "abstractNum":
                    abstract_id = elem.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}abstractNumId", "")
                    levels = {}
                    for child in elem:
                        if _local_name(child.tag) == "lvl":
                            ilvl = child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ilvl", "0")
                            for lvl_child in child:
                                if _local_name(lvl_child.tag) == "numFmt":
                                    fmt = lvl_child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                                    # 判断列表类型
                                    if fmt in ["decimal", "upperLetter", "lowerLetter", "upperRoman", "lowerRoman"]:
                                        levels[ilvl] = "ordered"
                                    else:
                                        levels[ilvl] = "bullet"
                    abstract_nums[abstract_id] = levels
            
            # 解析 num（列表实例）
            for elem in root:
                if _local_name(elem.tag) == "num":
                    num_id = elem.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}numId", "")
                    for child in elem:
                        if _local_name(child.tag) == "abstractNumId":
                            abstract_id = child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                            num_type_map[num_id] = abstract_nums.get(abstract_id, {})
        except Exception:
            pass
        
        return num_type_map

    def _get_num_info(self, para, num_type_map):
        """获取段落的列表信息"""
        try:
            for child in para:
                if _local_name(child.tag) == "pPr":
                    for ppr_child in child:
                        if _local_name(ppr_child.tag) == "numPr":
                            ilvl = 0
                            numId = ""
                            
                            for num_child in ppr_child:
                                tag = _local_name(num_child.tag)
                                if tag == "ilvl":
                                    ilvl = int(num_child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "0"))
                                elif tag == "numId":
                                    numId = num_child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                            
                            if numId:
                                # 获取列表类型
                                num_types = num_type_map.get(numId, {})
                                num_type = num_types.get(str(ilvl), "bullet")
                                return {"ilvl": ilvl, "type": num_type, "numId": numId}
        except Exception:
            pass
        
        return None

    def _extract_paragraph(self, para, include_images, rid_to_local, mathtype_map, num_info=None):
        """提取段落内容"""
        parts = []
        
        # 检查是否有列表属性
        list_prefix = ""
        if num_info:
            ilvl = num_info.get("ilvl", 0)
            num_type = num_info.get("type", "bullet")
            
            # 生成缩进（每级 2 个空格）
            indent = "  " * ilvl
            
            # 生成列表标记
            if num_type == "bullet":
                list_prefix = f"{indent}- "
            else:
                # 有序列表使用数字
                list_prefix = f"{indent}1. "
        
        # 递归处理所有子元素
        self._extract_content_recursive(para, parts, include_images, rid_to_local, mathtype_map)
        
        content = "".join(parts).strip()
        if content and list_prefix:
            content = list_prefix + content
        
        return content
    
    def _extract_content_recursive(self, elem, parts, include_images, rid_to_local, mathtype_map):
        """递归提取内容，处理文本框等嵌套结构"""
        for child in elem:
            tag = _local_name(child.tag)
            
            if tag == "r":
                # 检查 run 中是否有 OLE 对象
                math_latex = self._check_ole_object(child, mathtype_map, rid_to_local)
                if math_latex:
                    parts.append(f"${math_latex}$")
                else:
                    # 检查 run 中是否有文本框或图片
                    has_textbox = False
                    has_image = False
                    for r_child in child.iter():
                        r_child_tag = _local_name(r_child.tag)
                        if r_child_tag == "txbxContent" and not has_textbox:
                            # 递归处理文本框内容
                            self._extract_content_recursive(r_child, parts, include_images, rid_to_local, mathtype_map)
                            has_textbox = True
                        elif r_child_tag == "blip" and include_images:
                            # 图片
                            embed = r_child.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", "")
                            if embed and embed in rid_to_local:
                                parts.append(f"\n![image]({rid_to_local[embed]})\n")
                                has_image = True
                    
                    # 如果没有文本框和图片，才提取文本
                    if not has_textbox and not has_image:
                        text = self._extract_run(child)
                        if text:
                            parts.append(text)
            elif tag == "oMath":
                # OMML 公式
                try:
                    latex = self.omml_converter.convert(child)
                    if latex.strip():
                        parts.append(f"${latex}$")
                except Exception:
                    pass
            elif tag == "oMathPara":
                # OMML 块公式 - 使用行内格式
                try:
                    latex = self.omml_converter.convert(child)
                    if latex.strip():
                        parts.append(f"${latex}$")
                except Exception:
                    pass
            elif tag == "drawing" or tag == "pict":
                # 图片
                if include_images:
                    images = self._get_images_from_elem(child, rid_to_local)
                    for img in images:
                        parts.append(f"\n![image]({img})\n")
            elif tag == "txbxContent":
                # 文本框
                self._extract_content_recursive(child, parts, include_images, rid_to_local, mathtype_map)
            else:
                # 递归处理其他元素（包括文本框）
                self._extract_content_recursive(child, parts, include_images, rid_to_local, mathtype_map)

    def _check_ole_object(self, run, mathtype_map, rid_to_local=None):
        """检查 run 中是否有 MathType OLE 对象"""
        for child in run.iter():
            tag = _local_name(child.tag)
            
            # 检查 OLEObject（大写 O）
            if tag == "OLEObject":
                prog_id = child.get("ProgID", "")
                rId = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                    ""
                )
                
                # 检查是否是 MathType 公式
                if "Equation" in prog_id and rId:
                    # 查找对应的 MathType 公式
                    for key, latex in mathtype_map.items():
                        if key in rId or rId in key:
                            return latex
            
            # 检查 object 标签中的 OLEObject
            elif tag == "object":
                for obj_child in child:
                    if _local_name(obj_child.tag) == "OLEObject":
                        prog_id = obj_child.get("ProgID", "")
                        rId = obj_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                            ""
                        )
                        if "Equation" in prog_id and rId:
                            for key, latex in mathtype_map.items():
                                if key in rId or rId in key:
                                    return latex
            
            # 检查 AlternateContent 中的 OLE 对象
            elif tag == "AlternateContent":
                # 检查 Choice 中的 OLE 对象
                for ac_child in child:
                    ac_tag = _local_name(ac_child.tag)
                    if ac_tag == "Choice":
                        for choice_child in ac_child:
                            choice_tag = _local_name(choice_child.tag)
                            if choice_tag == "drawing":
                                for drawing_child in choice_child.iter():
                                    d_tag = _local_name(drawing_child.tag)
                                    if d_tag == "OLEObject":
                                        prog_id = drawing_child.get("ProgID", "")
                                        rId = drawing_child.get(
                                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                                            ""
                                        )
                                        if "Equation" in prog_id and rId:
                                            for key, latex in mathtype_map.items():
                                                if key in rId or rId in key:
                                                    return latex
                
                # 检查 Fallback 中的图片（Equation.3 回退）
                for ac_child in child:
                    ac_tag = _local_name(ac_child.tag)
                    if ac_tag == "Fallback":
                        # 查找 Fallback 中的 blip
                        for blip in ac_child.iter():
                            if _local_name(blip.tag) == "blip":
                                embed = blip.get(
                                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed",
                                    ""
                                )
                                if embed and rid_to_local and embed in rid_to_local:
                                    return f"![formula]({rid_to_local[embed]})"
        
        return None
    
    def _get_images_from_elem(self, elem, rid_to_local):
        """从元素中获取图片"""
        images = []
        for ref in elem.iter():
            if _local_name(ref.tag) == "blip":
                embed = ref.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", "")
                if embed and embed in rid_to_local:
                    images.append(rid_to_local[embed])
        return images

    def _extract_run(self, run):
        """提取 run 中的文本"""
        text_parts = []
        for child in run:
            tag = _local_name(child.tag)
            if tag == "t" and child.text:
                text_parts.append(child.text)
            elif tag == "tab":
                text_parts.append("\t")
            elif tag == "br":
                text_parts.append("\n")
        
        # 检查删除线
        for child in run:
            if _local_name(child.tag) == "rPr":
                for sub in child:
                    if _local_name(sub.tag) == "strike":
                        return ""
        
        return "".join(text_parts)

    def _extract_table(self, table, include_images, rid_to_local, mathtype_map=None):
        """提取表格，支持合并单元格"""
        if mathtype_map is None:
            mathtype_map = {}
        rows = []
        
        for tr in table:
            if _local_name(tr.tag) != "tr":
                continue
            
            row = []
            for tc in tr:
                if _local_name(tc.tag) != "tc":
                    continue
                
                # 检查是否是合并单元格的起始
                tcPr = None
                for child in tc:
                    if _local_name(child.tag) == "tcPr":
                        tcPr = child
                        break
                
                is_merge_start = True
                if tcPr is not None:
                    for child in tcPr:
                        if _local_name(child.tag) == "vMerge":
                            val = child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                            if val == "continue":
                                is_merge_start = False
                            break
                
                # 提取单元格内容
                cell_parts = []
                for para in tc:
                    if _local_name(para.tag) == "p":
                        content = self._extract_paragraph(para, include_images, rid_to_local, mathtype_map)
                        if content:
                            cell_parts.append(content)
                
                cell_text = " ".join(cell_parts)
                # 只替换非图片引用部分的换行符
                lines = cell_text.split("\n")
                result_lines = []
                for line in lines:
                    if line.strip().startswith("![image]"):
                        result_lines.append(line.strip())
                    else:
                        result_lines.append(line.strip())
                cell_text = " ".join(result_lines)
                
                if is_merge_start:
                    row.append(cell_text)
            
            if row:
                rows.append(row)
        
        if not rows:
            return ""
        
        return _markdown_table(rows)

    def _get_images(self, elem, rid_to_local):
        """获取元素中的图片"""
        images = []
        for drawing in elem.iter():
            if _local_name(drawing.tag) in ["drawing", "pict"]:
                for ref in drawing.iter():
                    if _local_name(ref.tag) == "blip":
                        embed = ref.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", "")
                        if embed and embed in rid_to_local:
                            images.append(rid_to_local[embed])
        return images