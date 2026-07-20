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
from ._utils import (
    ExtractedMedia,
    format_media_ref,
    local_name as _local_name,
    markdown_table as _markdown_table,
    media_rel_path,
)
from logger import get_logger

logger = get_logger("docx_extractor")


class DocxExtractor(BaseExtractor):
    """DOCX 提取器，支持文本、图片/视频/音频、公式（OMML + MathType）和复杂表格"""

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

            # 抽取所有媒体(图片/视频/音频),按 document.xml.rels 引用顺序排序
            media_list: list[ExtractedMedia] = []
            if include_images:
                media_files = sorted(name for name in names if name.startswith("word/media/"))
                # 过滤 MathType 预览图片
                media_files = filter_mathtype_previews(media_files, zf)
                # 按 document.xml 中 rId 出现顺序排(避免 zip 名排序后顺序跳变)
                media_files = self._sort_media_by_refs(zf, media_files)
                media_list = extract_and_convert_media(media_files, zf, output_dir or "", path.stem)
                result.images = [m.local_path for m in media_list]
                result.media_kinds = [m.kind for m in media_list]

            # 构建媒体映射: original zip 路径 -> ExtractedMedia
            media_map: dict[str, ExtractedMedia] = (
                {m.original_path: m for m in media_list} if include_images else {}
            )

            # 提取 MathType 公式
            mathtype_equations = []
            if self.mathtype_converter:
                try:
                    mathtype_equations = self.mathtype_converter.extract_mathtype_from_docx(source)
                except Exception as e:
                    logger.warning("MathType 提取失败，公式将退化为图片", error=str(e), source=source)

            # 提取文本
            stem = path.stem
            result.markdown = self._extract_text(
                zf, stem, path.name, include_images, media_map, mathtype_equations
            )

        result.metadata = {"format": "docx", "reader": "docx_extractor"}
        return result

    def _sort_media_by_refs(self, zf, media_files: list[str]) -> list[str]:
        """按 document.xml 中 rId 实际出现顺序排序 media_files。

        未在 rels 中出现的(理论上不应该)回退到原顺序末尾。
        """
        if not media_files:
            return media_files
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path not in zf.namelist():
                return media_files
            rels_root = ET.fromstring(zf.read(rels_path))
            # rId -> 原始 zip 路径(完整,如 'word/media/image1.png')
            # 接受两种 Target 格式: 'media/xxx' 或 '../media/xxx'
            rid_to_path: dict[str, str] = {}
            for rel in rels_root:
                if _local_name(rel.tag) == "Relationship":
                    rId = rel.get("Id", "")
                    target = rel.get("Target", "")
                    target_normalized = re.sub(r'^\.\./', '', target)
                    if target_normalized.startswith("media/"):
                        rid_to_path[rId] = f"word/{target_normalized}"
            # document.xml 实际出现 rId 的顺序
            doc_xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
            rId_order: list[str] = []
            for m in re.finditer(r'r:embed="(rId\d+)"|r:link="(rId\d+)"', doc_xml):
                rid = m.group(1) or m.group(2)
                if rid in rid_to_path and rid not in rId_order:
                    rId_order.append(rid)
            # 按 rId_order 排 media_files
            ordered: list[str] = []
            seen: set[str] = set()
            for rid in rId_order:
                mp = rid_to_path.get(rid)
                if mp in media_files and mp not in seen:
                    ordered.append(mp)
                    seen.add(mp)
            # 兜底:rels 里没记录的追加到末尾
            for mp in media_files:
                if mp not in seen:
                    ordered.append(mp)
            return ordered
        except Exception:
            return media_files

    def _extract_text(self, zf, stem, filename, include_images=True, media_map=None, mathtype_equations=None):
        """提取 DOCX 文本，只处理 body 的直接子元素，避免重复"""
        root = ET.fromstring(zf.read("word/document.xml"))
        lines = [f"# {filename}", ""]

        if media_map is None:
            media_map = {}
        if mathtype_equations is None:
            mathtype_equations = []

        # 构建 rId -> ExtractedMedia 映射(基于 rels)
        rid_to_media = self._build_rid_media_map(zf, media_map)

        # 构建 MathType 公式映射(基于 rId)
        mathtype_map = {}

        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path in zf.namelist():
                rels_content = zf.read(rels_path).decode("utf-8")
                for match in re.finditer(r'Id="(rId\d+)"[^>]*Target="embeddings/(oleObject\d+\.bin)"', rels_content):
                    rId = match.group(1)
                    ole_file = match.group(2)
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

        seen_content = set()

        for child in body:
            tag = _local_name(child.tag)

            if tag == "p":
                num_info = self._get_num_info(child, num_type_map)
                content = self._extract_paragraph(
                    child, stem, include_images, rid_to_media, mathtype_map, num_info
                )
                if content and content not in seen_content:
                    seen_content.add(content)
                    lines.append(content)
                    lines.append("")

            elif tag == "tbl":
                table_content = self._extract_table(
                    child, stem, include_images, rid_to_media, mathtype_map
                )
                if table_content:
                    lines.append(table_content)
                    lines.append("")

            elif tag == "sdt":
                for sdt_child in child:
                    sdt_tag = _local_name(sdt_child.tag)
                    if sdt_tag == "sdtContent":
                        for content_child in sdt_child:
                            ctag = _local_name(content_child.tag)
                            if ctag == "p":
                                content = self._extract_paragraph(
                                    content_child, stem, include_images, rid_to_media, mathtype_map
                                )
                                if content and content not in seen_content:
                                    seen_content.add(content)
                                    lines.append(content)
                                    lines.append("")
                            elif ctag == "tbl":
                                table_content = self._extract_table(
                                    content_child, stem, include_images, rid_to_media
                                )
                                if table_content:
                                    lines.append(table_content)
                                    lines.append("")

            elif tag == "OLEObject":
                prog_id = child.get("ProgID", "")
                rId = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id",
                    "",
                )
                if "Equation" in prog_id and rId:
                    for key, latex in mathtype_map.items():
                        if key in rId or rId in key:
                            lines.append(f"${latex}$")
                            lines.append("")
                            break

        return "\n".join(lines).strip() + "\n"

    def _build_rid_media_map(self, zf, media_map: dict[str, ExtractedMedia]) -> dict[str, ExtractedMedia]:
        """构建 rId -> ExtractedMedia 映射(基于 rels)。

        接受两种 Target 格式: 'media/xxx' 或 '../media/xxx'。
        """
        rid_to_media: dict[str, ExtractedMedia] = {}
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path not in zf.namelist():
                return rid_to_media
            rels_root = ET.fromstring(zf.read(rels_path))
            for rel in rels_root:
                if _local_name(rel.tag) == "Relationship":
                    rId = rel.get("Id", "")
                    target = rel.get("Target", "")
                    target_normalized = re.sub(r'^\.\./', '', target)
                    if target_normalized.startswith("media/"):
                        full_path = f"word/{target_normalized}"
                        if full_path in media_map:
                            rid_to_media[rId] = media_map[full_path]
        except Exception:
            pass
        return rid_to_media

    def _parse_numbering(self, zf):
        """解析 numbering.xml 获取列表类型映射"""
        num_type_map: dict[str, dict[str, str]] = {}

        try:
            if "word/numbering.xml" not in zf.namelist():
                return num_type_map

            content = zf.read("word/numbering.xml")
            root = ET.fromstring(content)

            abstract_nums: dict[str, dict[str, str]] = {}
            for elem in root:
                if _local_name(elem.tag) == "abstractNum":
                    abstract_id = elem.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}abstractNumId", "")
                    levels: dict[str, str] = {}
                    for child in elem:
                        if _local_name(child.tag) == "lvl":
                            ilvl = child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ilvl", "0")
                            for lvl_child in child:
                                if _local_name(lvl_child.tag) == "numFmt":
                                    fmt = lvl_child.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "")
                                    if fmt in ["decimal", "upperLetter", "lowerLetter", "upperRoman", "lowerRoman"]:
                                        levels[ilvl] = "ordered"
                                    else:
                                        levels[ilvl] = "bullet"
                    abstract_nums[abstract_id] = levels

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
                                num_types = num_type_map.get(numId, {})
                                num_type = num_types.get(str(ilvl), "bullet")
                                return {"ilvl": ilvl, "type": num_type, "numId": numId}
        except Exception:
            pass
        return None

    def _extract_paragraph(self, para, stem, include_images, rid_to_media, mathtype_map, num_info=None):
        """提取段落内容"""
        parts = []

        list_prefix = ""
        if num_info:
            ilvl = num_info.get("ilvl", 0)
            num_type = num_info.get("type", "bullet")
            indent = "  " * ilvl
            if num_type == "bullet":
                list_prefix = f"{indent}- "
            else:
                list_prefix = f"{indent}1. "

        self._extract_content_recursive(para, stem, parts, include_images, rid_to_media, mathtype_map)

        content = "".join(parts).strip()
        if content and list_prefix:
            content = list_prefix + content
        return content

    def _extract_content_recursive(self, elem, stem, parts, include_images, rid_to_media, mathtype_map, depth=0):
        """递归提取内容，处理文本框等嵌套结构"""
        if depth > 20:
            return
        for child in elem:
            tag = _local_name(child.tag)

            if tag == "r":
                math_latex = self._check_ole_object(child, stem, mathtype_map, rid_to_media)
                if math_latex:
                    parts.append(f"${math_latex}$")
                    continue

                has_textbox = False
                handled_media = False
                handled_video = False
                for r_child in child.iter():
                    r_child_tag = _local_name(r_child.tag)
                    if r_child_tag == "txbxContent" and not has_textbox:
                        self._extract_content_recursive(
                            r_child, stem, parts, include_images, rid_to_media, mathtype_map, depth + 1
                        )
                        has_textbox = True
                    elif r_child_tag in ("videoFile", "audioFile") and include_images and not handled_video:
                        link = r_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}link", ""
                        )
                        if link and link in rid_to_media:
                            m = rid_to_media[link]
                            parts.append("\n" + self._render_media(m, stem, alt="") + "\n")
                            handled_video = True
                            handled_media = True
                    elif r_child_tag == "media" and include_images and not handled_video:
                        embed = r_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                        if embed and embed in rid_to_media:
                            m = rid_to_media[embed]
                            parts.append("\n" + self._render_media(m, stem, alt="") + "\n")
                            handled_video = True
                            handled_media = True
                    elif r_child_tag == "blip" and include_images and not handled_media:
                        embed = r_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                        if embed and embed in rid_to_media:
                            m = rid_to_media[embed]
                            # alt 用文件名(去后缀)作为默认 title,比 "image" 更友好
                            alt = Path(m.local_path).stem
                            parts.append("\n" + self._render_media(m, stem, alt=alt) + "\n")
                            handled_media = True
                    # 不 return: 继续递归到 blip 子元素找 <a14:imgLayer>(HD Photo 场景)
                    elif r_child_tag == "imgLayer" and include_images and not handled_media:
                        embed = r_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                        )
                        if embed and embed in rid_to_media:
                            m = rid_to_media[embed]
                            alt = Path(m.local_path).stem
                            parts.append("\n" + self._render_media(m, stem, alt=alt) + "\n")
                            handled_media = True

                if not has_textbox and not handled_media:
                    text = self._extract_run(child)
                    if text:
                        parts.append(text)
            elif tag == "oMath":
                try:
                    latex = self.omml_converter.convert(child)
                    if latex.strip():
                        parts.append(f"${latex}$")
                except Exception:
                    pass
            elif tag == "oMathPara":
                try:
                    latex = self.omml_converter.convert(child)
                    if latex.strip():
                        parts.append(f"${latex}$")
                except Exception:
                    pass
            elif tag == "drawing" or tag == "pict":
                if include_images:
                    for m in self._get_media_from_elem(child, rid_to_media):
                        # alt 用文件名(去后缀)作为默认 title,比 "image" 更友好
                        alt = Path(m.local_path).stem
                        parts.append("\n" + self._render_media(m, stem, alt=alt) + "\n")
            elif tag == "txbxContent":
                self._extract_content_recursive(
                    child, stem, parts, include_images, rid_to_media, mathtype_map, depth + 1
                )
            else:
                self._extract_content_recursive(
                    child, stem, parts, include_images, rid_to_media, mathtype_map, depth + 1
                )

    def _render_media(self, media: ExtractedMedia, stem: str, alt: str = "") -> str:
        """渲染媒体引用: image 用 ![](), video/audio 用 HTML 标签。"""
        return format_media_ref(media_rel_path(stem, media), media.kind, alt or "")

    def _check_ole_object(self, run, stem, mathtype_map, rid_to_media=None):
        """检查 run 中是否有 MathType OLE 对象,返回 LaTeX 或公式预览图引用"""
        for child in run.iter():
            tag = _local_name(child.tag)

            if tag == "OLEObject":
                prog_id = child.get("ProgID", "")
                rId = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
                )
                if "Equation" in prog_id and rId:
                    for key, latex in mathtype_map.items():
                        if key in rId or rId in key:
                            return latex

            elif tag == "object":
                for obj_child in child:
                    if _local_name(obj_child.tag) == "OLEObject":
                        prog_id = obj_child.get("ProgID", "")
                        rId = obj_child.get(
                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
                        )
                        if "Equation" in prog_id and rId:
                            for key, latex in mathtype_map.items():
                                if key in rId or rId in key:
                                    return latex

            elif tag == "AlternateContent":
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
                                            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
                                        )
                                        if "Equation" in prog_id and rId:
                                            for key, latex in mathtype_map.items():
                                                if key in rId or rId in key:
                                                    return latex

                for ac_child in child:
                    ac_tag = _local_name(ac_child.tag)
                    if ac_tag == "Fallback":
                        for blip in ac_child.iter():
                            if _local_name(blip.tag) == "blip":
                                embed = blip.get(
                                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                                )
                                if embed and rid_to_media and embed in rid_to_media:
                                    # 公式预览固定按图片渲染(回退 Equation.3 等无法转 LaTeX 的)
                                    media = rid_to_media[embed]
                                    return format_media_ref(
                                        media_rel_path(stem, media),
                                        media.kind,
                                        "formula",
                                    )
        return None

    def _get_media_from_elem(self, elem, rid_to_media):
        """从元素中获取所有媒体(图/视/音)"""
        media = []
        for ref in elem.iter():
            tag = _local_name(ref.tag)
            if tag in ("blip", "imgLayer"):
                embed = ref.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", "")
                if embed and embed in rid_to_media:
                    media.append(rid_to_media[embed])
        return media

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
        for child in run:
            if _local_name(child.tag) == "rPr":
                for sub in child:
                    if _local_name(sub.tag) == "strike":
                        return ""
        return "".join(text_parts)

    def _extract_table(self, table, stem, include_images, rid_to_media, mathtype_map=None):
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

                cell_parts = []
                for para in tc:
                    if _local_name(para.tag) == "p":
                        content = self._extract_paragraph(
                            para, stem, include_images, rid_to_media, mathtype_map
                        )
                        if content:
                            cell_parts.append(content)

                cell_text = " ".join(cell_parts)
                lines = cell_text.split("\n")
                result_lines = []
                for line in lines:
                    # 兼容 markdown 图片 / video / audio 引用 行内的换行
                    stripped = line.strip()
                    if stripped.startswith("![") or stripped.startswith("<video") or stripped.startswith("<audio"):
                        result_lines.append(stripped)
                    else:
                        result_lines.append(stripped)
                cell_text = " ".join(result_lines)

                if is_merge_start:
                    row.append(cell_text)

            if row:
                rows.append(row)

        if not rows:
            return ""

        return _markdown_table(rows)