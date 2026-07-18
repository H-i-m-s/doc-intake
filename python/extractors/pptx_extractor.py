"""PPTX 文档提取器 - 重构版"""
from __future__ import annotations

import os
import re
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .emf_converter import convert_emf_to_png
from .omml_converter import OmmlToLatexConverter
from .mathtype_filter import filter_mathtype_previews
from ._utils import local_name as _local_name, markdown_table as _markdown_table
from logger import get_logger

logger = get_logger("pptx_extractor")


def _find_child(elem, tag_name):
    """查找指定名称的子元素"""
    for child in elem:
        if _local_name(child.tag) == tag_name:
            return child
    return None


def _find_children(elem, tag_name):
    """查找所有指定名称的子元素"""
    return [child for child in elem if _local_name(child.tag) == tag_name]


class PptxExtractor(BaseExtractor):
    """PPTX 提取器 - 重构版"""

    name = "pptx"

    def __init__(self, settings: dict):
        super().__init__(settings)
        self.omml_converter = OmmlToLatexConverter()
        self._mathtype_converter = None
    
    @property
    def mathtype_converter(self):
        if self._mathtype_converter is None:
            try:
                from mathtype_converter import MathTypeConverter
                self._mathtype_converter = MathTypeConverter()
            except ImportError:
                self._mathtype_converter = None
        return self._mathtype_converter

    def extract(self, source, output_dir=None, page_range=None, 
                language="zh", include_images=True, **kwargs):
        path = self._check_file_exists(source)
        
        if path.suffix.lower() == ".ppt":
            return self._handle_legacy_ppt(path, output_dir, include_images)
        
        result = ExtractionResult()

        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            if "ppt/presentation.xml" not in names:
                result.warnings.append("无效的 PPTX 文件")
                return result

            # 第一步：解析结构
            slides, rid_map, media_list = self._parse_structure(zf, names)
            
            # 获取 MathType 公式
            mathtype_equations = []
            if self.mathtype_converter:
                try:
                    mathtype_equations = self.mathtype_converter.extract_mathtype_from_pptx(source)
                except Exception as e:
                    logger.warning("MathType 提取失败，公式将退化为图片", error=str(e), source=source)
            
            # 不再构建全局 mathtype_map—— rId 在各 slide 的 rels 里独立
            # （都从 rId1 开始）,跨 slide 共享会串（slide1.rId4 和 slide5.rId4 不是一个东西）。
            # 每个 slide 自己的 mathtype_map 在 _extract_content 里临时构建。

            # 第二步：确定图片列表
            used_media = self._determine_images(slides, rid_map, media_list, zf)
            
            # 第三步：分配编号
            image_map = self._assign_numbers(used_media)

            # 第四步：提取内容
            result.markdown = self._extract_content(
                slides, image_map, mathtype_equations, zf,
                path.name, include_images
            )
            
            # 第五步：提取图片
            if include_images and output_dir and image_map:
                result.images = self._extract_images(
                    image_map, zf, output_dir, path.name
                )

        result.metadata = {
            "format": "pptx",
            "reader": "pptx_extractor",
            "slides": len(slides),
        }
        return result

    # ========== MathType 公式映射 ==========

    def _build_slide_mathtype_map(self, zf, slide_path: str, mathtype_equations: list) -> dict:
        """为一个 slide 构建 rId → LaTeX 映射。

        重要: 每个 slide 的 rels 里 rId 是独立的命名空间(都从 rId1 开始),
        不能跨 slide 合并。所以这里按 slide_path 单独建一张表。

        Returns:
            dict rId -> LaTeX string。只包含该 slide 里能成功转 LaTeX 的 OLE。
        """
        slide_map = {}
        if not slide_path:
            return slide_map
        rels_name = f"ppt/slides/_rels/{Path(slide_path).name}.rels"
        if rels_name not in zf.namelist():
            return slide_map
        try:
            rels_content = zf.read(rels_name).decode("utf-8")
            for match in re.finditer(
                r'Id="(rId\d+)"[^>]*Target="[^"]*/(oleObject\d+\.bin)"',
                rels_content,
            ):
                rId = match.group(1)
                ole_file = match.group(2)
                for eq in mathtype_equations:
                    if ole_file in eq.get("position", "") and eq.get("latex"):
                        slide_map[rId] = eq["latex"]
                        break
        except Exception:
            pass
        return slide_map

    # ========== 第一步：解析结构 ==========

    def _parse_structure(self, zf, names):
        """解析 PPTX 结构"""
        slides = []
        rid_map = {}
        
        # 获取幻灯片列表
        try:
            pres_xml = zf.read("ppt/presentation.xml")
            pres_root = ET.fromstring(pres_xml)
            for sldId in pres_root.iter():
                if _local_name(sldId.tag) == "sldId":
                    rId = sldId.get(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
                    )
                    if rId:
                        slides.append({"rId": rId})
        except Exception:
            pass
        
        # 获取 rId → 路径映射
        try:
            rels_xml = zf.read("ppt/_rels/presentation.xml.rels")
            rels_root = ET.fromstring(rels_xml)
            rId_to_path = {}
            for rel in rels_root:
                if _local_name(rel.tag) == "Relationship":
                    rid = rel.get("Id", "")
                    target = rel.get("Target", "")
                    if target.startswith("slides/slide"):
                        rId_to_path[rid] = target
            for slide in slides:
                slide["path"] = rId_to_path.get(slide["rId"], "")
        except Exception:
            pass
        
        # 获取媒体文件列表
        media_list = sorted(name for name in names if name.startswith("ppt/media/"))
        media_list = filter_mathtype_previews(media_list, zf)
        
        return slides, rid_map, media_list

    # ========== 第二步：确定图片列表 ==========

    def _determine_images(self, slides, rid_map, media_list, zf):
        """确定哪些图片需要提取"""
        used_media = []
        seen_rids = set()
        
        # 遍历幻灯片，查找需要的图片
        for slide_info in slides:
            slide_path = slide_info.get("path", "")
            if not slide_path:
                continue
            
            # 为当前 slide 构建 rId → 媒体文件映射
            rid_to_media = {}
            rels_path = f"ppt/slides/_rels/{Path(slide_path).name}.rels"
            if rels_path in zf.namelist():
                rels_xml = zf.read(rels_path).decode("utf-8")
                for match in re.finditer(
                    r'Id="(rId\d+)"[^>]*Target="[^"]*(?:media|hdphoto)/([^"]+)"', rels_xml
                ):
                    rid = match.group(1)
                    media = match.group(2)
                    rid_to_media[rid] = media
            
            try:
                slide_xml = zf.read(f"ppt/{slide_path}")
                slide_root = ET.fromstring(slide_xml)
                
                self._find_images_in_element(
                    slide_root, rid_to_media, used_media, seen_rids
                )
            except Exception:
                continue
        
        return used_media

    def _find_images_in_element(self, elem, rid_to_media, used_media, seen_rids, in_fallback=False):
        """递归查找元素中的图片"""
        tag = _local_name(elem.tag)
        
        # 处理 AlternateContent
        if tag == "AlternateContent":
            # 先处理 Choice（主要图片）
            for child in elem:
                child_tag = _local_name(child.tag)
                if child_tag == "Choice":
                    self._find_images_in_element(
                        child, rid_to_media, used_media, seen_rids, in_fallback=False
                    )
            # 再处理 Fallback（只收集 Equation 相关的预览）
            for child in elem:
                child_tag = _local_name(child.tag)
                if child_tag == "Fallback":
                    self._find_fallback_preview(
                        child, rid_to_media, used_media, seen_rids
                    )
            return
        
        # 处理 blip（图片引用）- 只在 Choice 或直接位置时处理
        if tag == "blip" and not in_fallback:
            embed = elem.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
            )
            if embed and embed in rid_to_media:
                media_name = rid_to_media[embed]
                # 使用媒体文件名判断是否重复，而不是 rId
                if media_name not in seen_rids:
                    seen_rids.add(media_name)
                    alt = "image"
                    used_media.append({
                        "rid": embed,
                        "file": media_name,
                        "type": "main",
                        "alt": alt
                    })
            return
        
        # 递归处理子元素
        for child in elem:
            self._find_images_in_element(
                child, rid_to_media, used_media, seen_rids, in_fallback
            )
    
    def _find_fallback_preview(self, elem, rid_to_media, used_media, seen_rids):
        """在 Fallback 中查找 Equation.3 相关的预览图片"""
        # 检查是否包含 Equation.3（不支持转 LaTeX 的格式）
        has_equation3 = False
        for child in elem.iter():
            if _local_name(child.tag) == "oleObj":
                prog_id = child.get("progId", "")
                if prog_id == "Equation.3":
                    has_equation3 = True
                    break
        
        if not has_equation3:
            return
        
        # 查找 blip
        for child in elem.iter():
            if _local_name(child.tag) == "blip":
                embed = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                )
                if embed and embed in rid_to_media and embed not in seen_rids:
                    seen_rids.add(embed)
                    media_name = rid_to_media[embed]
                    used_media.append({
                        "rid": embed,
                        "file": media_name,
                        "type": "preview",
                        "alt": "formula"
                    })

    # ========== 第三步：分配编号 ==========

    def _assign_numbers(self, used_media):
        """为图片分配连续编号"""
        image_map = {}
        counter = 1
        
        for media in used_media:
            file_name = media["file"]
            alt = media["alt"]
            ext = Path(file_name).suffix.lower()
            
            # EMF/WMF 转换为 PNG
            if ext in [".emf", ".wmf"]:
                new_name = f"image_{counter:03d}.png"
            else:
                new_name = f"image_{counter:03d}{ext}"
            
            original_path = f"ppt/media/{file_name}"
            image_map[original_path] = {"name": new_name, "alt": alt}
            counter += 1
        
        return image_map

    # ========== 第四步：提取内容 ==========

    def _extract_content(self, slides, image_map, mathtype_equations, zf,
                         filename, include_images):
        """提取所有内容为 Markdown

        mathtype_equations 是全局查到的 (olefile -> latex) 列表。
        每个 slide 根据自己的 rels 里 rId -> olefile 映射,按需查这张表,
        所以同一个 rId 在不同 slide 指向不同的公式,不会串。
        """
        # 设置当前 stem 用于图片引用（使用完整文件名）
        self._current_stem = Path(filename).name

        lines = [f"# {filename}", ""]

        for i, slide_info in enumerate(slides, 1):
            slide_path = slide_info.get("path", "")
            if not slide_path:
                continue

            # per-slide mathtype_map,rId 只在该 slide 范围内有效
            slide_mathtype_map = self._build_slide_mathtype_map(
                zf, slide_path, mathtype_equations
            )

            try:
                slide_xml = zf.read(f"ppt/{slide_path}")
                slide_root = ET.fromstring(slide_xml)

                # 设置当前 slide 路径
                self._current_slide_path = slide_path

                lines.append(f"## Slide {i}")
                lines.append("")

                slide_content = self._extract_element(
                    slide_root, image_map, slide_mathtype_map, zf
                )
                lines.append(slide_content)
                lines.append("")
            except Exception as e:
                logger.warning("Slide 提取失败", error=str(e), slide_path=slide_path)
                continue

        return "\n".join(lines).strip() + "\n"

    def _extract_element(self, elem, image_map, mathtype_map, zf, depth=0):
        """递归提取元素内容"""
        if depth > 50:
            return ""
        
        tag = _local_name(elem.tag)
        parts = []
        
        # 处理 AlternateContent
        if tag == "AlternateContent":
            for child in elem:
                child_tag = _local_name(child.tag)
                if child_tag == "Choice":
                    content = self._extract_element(
                        child, image_map, mathtype_map, zf, depth + 1
                    )
                    if content:
                        parts.append(content)
                    break  # 只处理 Choice
            return "\n".join(parts)
        
        # 处理 sp（形状）
        if tag == "sp":
            content = self._extract_sp(elem, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 处理 graphicFrame
        if tag == "graphicFrame":
            content = self._extract_graphic_frame(elem, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 处理 pic（独立图片）
        if tag == "pic":
            stem = getattr(self, '_current_stem', '')
            slide_path = getattr(self, '_current_slide_path', None)
            img_ref = self._extract_blip(elem, image_map, zf, stem, slide_path)
            if img_ref:
                parts.append(img_ref)
            return "\n".join(parts)
        
        # 处理表格
        if tag == "tbl":
            content = self._extract_table(elem, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 处理段落
        if tag == "p":
            content = self._extract_paragraph(elem, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 处理文本框
        if tag == "txBody":
            content = self._extract_tx_body(elem, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 递归处理其他元素
        for child in elem:
            content = self._extract_element(
                child, image_map, mathtype_map, zf, depth + 1
            )
            if content:
                parts.append(content)
        
        return "\n".join(parts)

    def _extract_sp(self, sp, image_map, mathtype_map, zf):
        """提取 sp（形状）内容"""
        parts = []
        
        # 查找文本框
        tx_body = _find_child(sp, "txBody")
        if tx_body is not None:
            content = self._extract_tx_body(tx_body, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
        
        # 查找图片
        stem = getattr(self, '_current_stem', '')
        slide_path = getattr(self, '_current_slide_path', None)
        img_ref = self._extract_blip(sp, image_map, zf, stem, slide_path)
        if img_ref:
            parts.append(img_ref)
        
        return "\n".join(parts)

    def _extract_tx_body(self, tx_body, image_map, mathtype_map, zf):
        """提取文本框内容"""
        parts = []
        
        for child in tx_body:
            tag = _local_name(child.tag)
            if tag == "p":
                content = self._extract_paragraph(child, image_map, mathtype_map, zf)
                if content:
                    parts.append(content)
        
        return "\n".join(parts)

    def _extract_paragraph(self, para, image_map, mathtype_map, zf):
        """提取段落内容"""
        parts = []
        list_info = None
        
        # 检查段落属性（列表信息）
        pPr = _find_child(para, "pPr")
        if pPr is not None:
            list_info = self._get_list_info(pPr)
        
        # 如果没有列表信息，检查是否有缩进
        if list_info is None and pPr is not None:
            # 检查 spcBef（段前间距）或其他缩进属性
            spc_bef = _find_child(pPr, "spcBef")
            if spc_bef is not None:
                # 可能是列表项
                pass
        
        # 提取段落内容（递归处理）
        self._extract_para_content(para, parts, image_map, mathtype_map, zf)
        
        content = "".join(parts).strip()
        
        # 应用列表格式
        if content and list_info and list_info["type"]:
            indent = "  " * list_info["level"]
            marker = list_info["marker"]
            content = f"{indent}{marker} {content}"
        
        return content
    
    def _extract_para_content(self, elem, parts, image_map, mathtype_map, zf, depth=0):
        """递归提取段落内容"""
        if depth > 20:
            return
        
        for child in elem:
            tag = _local_name(child.tag)
            
            if tag == "r":
                text = self._extract_run(child)
                if text:
                    parts.append(text)
            elif tag == "oMath":
                try:
                    latex = self.omml_converter.convert(child)
                    if latex and latex.strip():
                        parts.append(f"${latex.strip()}$")
                except Exception:
                    pass
            elif tag == "oMathPara":
                try:
                    latex = self.omml_converter.convert(child)
                    if latex and latex.strip():
                        parts.append(f"${latex.strip()}$")
                except Exception:
                    pass
            elif tag == "br":
                parts.append("\n")
            elif tag == "m":
                # OMML 包装元素，递归处理
                self._extract_para_content(child, parts, image_map, mathtype_map, zf, depth + 1)

    def _extract_run(self, run):
        """提取 run 中的文本"""
        text_parts = []
        for child in run:
            tag = _local_name(child.tag)
            if tag == "t" and child.text:
                text_parts.append(child.text)
        return "".join(text_parts)

    def _get_list_info(self, pPr):
        """获取列表信息"""
        level = 0
        list_type = None
        marker = None
        
        # 检查缩进级别
        lvl = _find_child(pPr, "lvl")
        if lvl is not None:
            level = int(lvl.get("{http://schemas.openxmlformats.org/drawingml/2006/main}val", "0"))
        
        # 检查 bullet 字符（无序列表）
        bu_char = _find_child(pPr, "buChar")
        if bu_char is not None:
            char = bu_char.get("{http://schemas.openxmlformats.org/drawingml/2006/main}char", "")
            if char in ["•", "●", "■", "◆", "◦", "▪"]:
                list_type = "unordered"
                marker = "-"
            elif char and char[0].isdigit():
                list_type = "ordered"
                marker = "1."
            elif char:
                list_type = "unordered"
                marker = "-"
        
        # 检查自动编号（有序列表）
        if list_type is None:
            bu_auto = _find_child(pPr, "buAutoNum")
            if bu_auto is not None:
                # type 属性可能没有命名空间
                auto_type = bu_auto.get("type", "")
                if not auto_type:
                    auto_type = bu_auto.get("{http://schemas.openxmlformats.org/drawingml/2006/main}type", "")
                if auto_type in ["arabicPeriod", "arabicPlain", "romanLcPeriod", "romanUcPeriod"]:
                    list_type = "ordered"
                    marker = "1."
                elif auto_type in ["alphaLcPeriod", "alphaUcPeriod"]:
                    list_type = "ordered"
                    marker = "a."
        
        if list_type is None:
            return None
        
        return {
            "type": list_type,
            "level": level,
            "marker": marker
        }

    def _extract_graphic_frame(self, gf, image_map, mathtype_map, zf):
        """提取 graphicFrame 内容"""
        parts = []
        
        # 查找表格
        tbl = self._find_recursive(gf, "tbl")
        if tbl is not None:
            content = self._extract_table(tbl, image_map, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)
        
        # 查找 OLE 对象
        for child in gf.iter():
            tag = _local_name(child.tag)
            if tag == "oleObj":
                content = self._extract_ole(child, gf, image_map, mathtype_map, zf)
                if content:
                    parts.append(content)
                break
        
        return "\n".join(parts)

    def _extract_table(self, tbl, image_map, mathtype_map, zf):
        """提取表格为 Markdown"""
        rows = []
        
        for tr in tbl:
            if _local_name(tr.tag) != "tr":
                continue
            
            row = []
            for tc in tr:
                if _local_name(tc.tag) != "tc":
                    continue
                
                # 提取单元格内容
                cell_content = self._extract_element(tc, image_map, mathtype_map, zf)
                row.append(cell_content.replace("\n", " ").strip())
            
            if row:
                rows.append(row)
        
        if not rows:
            return ""
        
        return _markdown_table(rows, trailing_blank=True)

    def _extract_ole(self, ole, graphic_frame, image_map, mathtype_map, zf):
        """提取 OLE 对象"""
        prog_id = ole.get("progId", "")
        rId = ole.get(
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", ""
        )
        
        # 检查是否是公式
        if "Equation" in prog_id:
            # 尝试从 mathtype_map 获取 LaTeX
            if rId and rId in mathtype_map:
                return f"${mathtype_map[rId]}$"
            
            # Equation.3 或其他无法转换的公式，返回预览图片
            preview = self._get_ole_preview(graphic_frame, image_map, zf)
            if preview:
                return preview
        
        return ""

    def _get_ole_preview(self, graphic_frame, image_map, zf):
        """获取 OLE 对象的预览图片"""
        # 在 Fallback 中查找 blip
        for child in graphic_frame.iter():
            tag = _local_name(child.tag)
            if tag == "Fallback":
                for blip in self._find_all(child, "blip"):
                    embed = blip.get(
                        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                    )
                    if embed:
                        # 从 image_map 中查找对应的新文件名
                        # 需要先从 rels 中找到 rId 对应的原始文件名
                        preview = self._find_preview_by_rid(embed, image_map, zf)
                        if preview:
                            return preview
        
        return None

    def _find_preview_by_rid(self, rid, image_map, zf):
        """通过 rId 查找预览图片"""
        stem = getattr(self, '_current_stem', '')
        
        # 遍历所有 slide rels
        for name in zf.namelist():
            if name.startswith("ppt/slides/_rels/") and name.endswith(".rels"):
                rels_xml = zf.read(name).decode("utf-8")
                for match in re.finditer(
                    f'Id="{rid}"[^>]*Target="[^"]*media/([^"]+)"', rels_xml
                ):
                    media_name = match.group(1)
                    original_path = f"ppt/media/{media_name}"
                    if original_path in image_map:
                        info = image_map[original_path]
                        new_name = info["name"]
                        alt = info["alt"]
                        if stem:
                            return f"![{alt}]({stem}_images/{new_name})"
                        return f"![{alt}]({new_name})"
        
        return None

    def _extract_blip(self, elem, image_map, zf=None, stem=None, slide_path=None):
        """提取图片引用"""
        for child in elem.iter():
            tag = _local_name(child.tag)
            if tag == "blip":
                embed = child.get(
                    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed", ""
                )
                if embed and zf and slide_path:
                    # 只在当前 slide 的 rels 文件中查找
                    rels_path = f"ppt/slides/_rels/{Path(slide_path).name}.rels"
                    if rels_path in zf.namelist():
                        rels_xml = zf.read(rels_path).decode("utf-8")
                        for match in re.finditer(
                            f'Id="{embed}"[^>]*Target="[^"]*(?:media|hdphoto)/([^"]+)"',
                            rels_xml
                        ):
                            media_name = match.group(1)
                            original_path = f"ppt/media/{media_name}"
                            if original_path in image_map:
                                info = image_map[original_path]
                                alt = info["alt"]
                                new_name = info["name"]
                                if stem:
                                    return f"![{alt}]({stem}_images/{new_name})"
                                return f"![{alt}]({new_name})"
        
        return None

    def _find_recursive(self, elem, tag_name):
        """递归查找指定标签的元素"""
        for child in elem:
            if _local_name(child.tag) == tag_name:
                return child
            result = self._find_recursive(child, tag_name)
            if result is not None:
                return result
        return None

    def _find_all(self, elem, tag_name):
        """递归查找所有指定标签的元素"""
        results = []
        for child in elem:
            if _local_name(child.tag) == tag_name:
                results.append(child)
            results.extend(self._find_all(child, tag_name))
        return results

    # ========== 第五步：提取图片 ==========

    def _extract_images(self, image_map, zf, output_dir, stem):
        """提取图片文件"""
        images_dir = Path(output_dir) / f"{stem}_images"
        images_dir.mkdir(parents=True, exist_ok=True)
        
        extracted = []
        
        for original_path, info in image_map.items():
            try:
                if original_path not in zf.namelist():
                    continue
                
                new_name = info["name"]
                out_path = images_dir / new_name
                
                # 提取文件
                with zf.open(original_path) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())
                
                # EMF/WMF 转换为 PNG
                if new_name.endswith(".png") and original_path.lower().endswith((".emf", ".wmf")):
                    # 先用原始扩展名保存，再转换
                    temp_path = str(out_path.with_suffix(Path(original_path).suffix.lower()))
                    os.rename(str(out_path), temp_path)
                    if convert_emf_to_png(temp_path, str(out_path)):
                        try:
                            os.remove(temp_path)
                        except OSError:
                            pass
                    else:
                        # 转换失败，改回原扩展名
                        os.rename(temp_path, str(out_path.with_suffix(".original")))
                
                extracted.append(str(out_path))
            except Exception:
                continue
        
        return extracted

    # ========== PPT 转换 ==========

    def _handle_legacy_ppt(self, path, output_dir, include_images):
        """处理旧版 .ppt 文件。

        使用 DispatchEx 创建独立 PowerPoint 进程，避免与系统中已有的
        PowerPoint 实例互相争抢 COM 锁。SaveAs 后立即 Close + Quit，
        不轮询等文件锁（实测 Quit() 后立刻可以读，无须等待）。
        """
        result = ExtractionResult()
        try:
            import win32com.client
            with tempfile.TemporaryDirectory() as tmpdir:
                pptx_filename = f"{path.stem}.pptx"
                pptx_path = os.path.join(tmpdir, pptx_filename)
                abs_source = str(path.resolve())
                powerpoint = win32com.client.DispatchEx("PowerPoint.Application")
                # 不设 Visible：Microsoft COM 不允许隐藏窗口
                # （Application.Visible: Invalid request. Hiding the application window is not allowed.）
                # 不设就是默认 Visible=True，会闪一下窗口，但能跑通。
                # 想完全静默 → 装 LibreOffice 用 unoconv。
                try:
                    presentation = powerpoint.Presentations.Open(abs_source)
                    presentation.SaveAs(pptx_path, 24)  # ppSaveAsOpenXMLPresentation
                    presentation.Close()
                finally:
                    powerpoint.Quit()
                pptx_extractor = PptxExtractor(self.settings)
                result = pptx_extractor.extract(
                    source=pptx_path, output_dir=output_dir, include_images=include_images
                )
        except ImportError:
            result.warnings.append("需要安装 pywin32: pip install pywin32")
            result.markdown = "# 错误\n\n需要安装 pywin32: pip install pywin32"
        except Exception as e:
            result.warnings.append(f"PPT 转换失败: {str(e)}")
            result.markdown = f"# 错误\n\nPPT 转换失败: {str(e)}"
        return result
