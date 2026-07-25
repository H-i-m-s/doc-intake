"""DOCX 文档提取器"""
from __future__ import annotations

import posixpath
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from .base import BaseExtractor, ExtractionResult
from .emf_converter import extract_and_convert_media
from .omml_converter import OmmlToLatexConverter
from ._utils import (
    ExtractedMedia,
    format_media_ref,
    local_name as _local_name,
    markdown_table as _markdown_table,
    media_rel_path,
)
from logger import get_logger

logger = get_logger("docx_extractor")


def _attr_by_local_name(element: ET.Element, name: str) -> str:
    """读取属性的本地名，兼容 Transitional 与 Strict OOXML 命名空间。"""
    for key, value in element.attrib.items():
        if _local_name(key) == name:
            return value
    return ""


def _docx_target_candidates(target: str) -> list[str]:
    """生成 DOCX 关系 Target 的候选 ZIP 路径。"""
    normalized = (target or "").replace("\\", "/").lstrip("/")
    candidates: list[str] = []
    if normalized.startswith(("media/", "embeddings/")):
        candidates.append(f"word/{normalized}")
    candidates.append(posixpath.normpath(posixpath.join("word", normalized)))
    # 兼容旧文档里把 ../media 写成 word/media 的非标准写法。
    stripped = re.sub(r"^(?:\.\./)+", "", normalized)
    candidates.append(f"word/{stripped}")
    return list(dict.fromkeys(candidates))


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

            # 先提取 MathType 公式，再决定哪些媒体需要落盘。
            # 成功转换的公式不需要预览图；失败公式只保留其 Fallback 图，避免导出数百个无引用 WMF。
            mathtype_equations = []
            if self.mathtype_converter:
                try:
                    mathtype_equations = self.mathtype_converter.extract_mathtype_from_docx(source)
                except Exception as e:
                    logger.warning("MathType 提取失败，公式将退化为图片", error=str(e), source=source)

            # 抽取正文实际引用的媒体(图片/视频/音频),按 document.xml.rels 引用顺序排序。
            media_list: list[ExtractedMedia] = []
            if include_images:
                all_media_files = sorted(name for name in names if name.startswith("word/media/"))
                media_files = self._select_media_files(zf, all_media_files, mathtype_equations)
                media_files = self._sort_media_by_refs(zf, media_files)
                media_list = extract_and_convert_media(media_files, zf, output_dir or "", path.stem)
                result.images = [m.local_path for m in media_list]

            # 构建媒体映射: original zip 路径 -> ExtractedMedia
            media_map: dict[str, ExtractedMedia] = (
                {m.original_path: m for m in media_list} if include_images else {}
            )

            # 提取文本
            stem = path.stem
            result.markdown = self._extract_text(
                zf, stem, path.name, include_images, media_map, mathtype_equations
            )

        result.metadata = {"format": "docx", "reader": "docx_extractor"}
        return result

    def _select_media_files(self, zf, media_files: list[str], mathtype_equations: list[dict]) -> list[str]:
        """选择正文图片和失败 MathType 公式回退图。"""
        if not media_files:
            return []

        selected: set[str] = set()
        root = ET.fromstring(zf.read("word/document.xml"))
        rels_root = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
        rid_to_path: dict[str, str] = {}
        for rel in rels_root:
            if _local_name(rel.tag) != "Relationship":
                continue
            candidates = _docx_target_candidates(rel.get("Target", ""))
            match = next((candidate for candidate in candidates if candidate in media_files), None)
            if match:
                rid_to_path[rel.get("Id", "")] = match

        parsed_equation_targets = {
            Path(eq.get("position", "")).as_posix().replace("\\", "/")
            for eq in mathtype_equations
            if eq.get("position")
        }
        ole_rids_with_latex: set[str] = set()
        for rel in rels_root:
            if _local_name(rel.tag) != "Relationship":
                continue
            target = next(
                (candidate for candidate in _docx_target_candidates(rel.get("Target", "")) if candidate in zf.namelist()),
                "",
            )
            if target.replace("\\", "/") in parsed_equation_targets:
                ole_rids_with_latex.add(rel.get("Id", ""))

        for paragraph in root.iter():
            if _local_name(paragraph.tag) != "p":
                continue
            ole_rids = {
                _attr_by_local_name(node, "id")
                for node in paragraph.iter()
                if _local_name(node.tag) == "OLEObject"
            }
            has_failed_ole = bool(ole_rids - ole_rids_with_latex)
            parent_map = {
                child: parent
                for parent in paragraph.iter()
                for child in parent
            }
            formula_blip_paths: list[str] = []
            ordinary_blip_paths: list[str] = []
            paragraph_vml_paths: list[str] = []
            for node in paragraph.iter():
                tag = _local_name(node.tag)
                if tag == "blip":
                    r_id = _attr_by_local_name(node, "embed")
                    if r_id not in rid_to_path:
                        continue
                    ancestor = parent_map.get(node)
                    inside_alternate = False
                    while ancestor is not None and ancestor is not paragraph:
                        if _local_name(ancestor.tag) == "AlternateContent":
                            inside_alternate = True
                            break
                        ancestor = parent_map.get(ancestor)
                    if inside_alternate:
                        formula_blip_paths.append(rid_to_path[r_id])
                    else:
                        ordinary_blip_paths.append(rid_to_path[r_id])
                elif tag == "imagedata" and has_failed_ole:
                    r_id = _attr_by_local_name(node, "id")
                    if r_id in rid_to_path:
                        paragraph_vml_paths.append(rid_to_path[r_id])
                elif tag in ("media", "imgLayer"):
                    r_id = _attr_by_local_name(node, "embed")
                    if r_id in rid_to_path:
                        ordinary_blip_paths.append(rid_to_path[r_id])
                elif tag in ("videoFile", "audioFile"):
                    r_id = _attr_by_local_name(node, "link")
                    if r_id in rid_to_path:
                        ordinary_blip_paths.append(rid_to_path[r_id])

            if not ole_rids:
                selected.update(ordinary_blip_paths + formula_blip_paths)
            else:
                # 公式所在段落仍可能混有普通图片；普通图片必须保留。
                selected.update(ordinary_blip_paths)
                if has_failed_ole:
                    # Fallback blip 是可渲染的现代预览；没有 Fallback 时才保留 VML 预览。
                    selected.add(
                        formula_blip_paths[0]
                        if formula_blip_paths
                        else (paragraph_vml_paths[0] if paragraph_vml_paths else "")
                    )
            # 成功转为 LaTeX 的公式不导出其预览图片。
            selected.discard("")

        return [media for media in media_files if media in selected]

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
            # rId -> 原始 ZIP 路径，关系表和 document.xml 都可能使用 Strict 命名空间。
            rid_to_path: dict[str, str] = {}
            for rel in rels_root:
                if _local_name(rel.tag) != "Relationship":
                    continue
                r_id = rel.get("Id", "")
                target = rel.get("Target", "")
                candidates = _docx_target_candidates(target)
                match = next((candidate for candidate in candidates if candidate in media_files), None)
                if match:
                    rid_to_path[r_id] = match

            doc_root = ET.fromstring(zf.read("word/document.xml"))
            r_id_order: list[str] = []
            for element in doc_root.iter():
                for attr_name in ("embed", "link", "id"):
                    value = _attr_by_local_name(element, attr_name)
                    if value and value in rid_to_path and value not in r_id_order:
                        r_id_order.append(value)

            ordered: list[str] = []
            seen: set[str] = set()
            for r_id in r_id_order:
                media_path = rid_to_path[r_id]
                if media_path not in seen:
                    ordered.append(media_path)
                    seen.add(media_path)
            for media_path in media_files:
                if media_path not in seen:
                    ordered.append(media_path)
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

        # 构建公式 OLE 的 rId -> LaTeX 映射，同时保留失败公式的预览图回退映射。
        mathtype_map: dict[str, str] = {}
        ole_preview_map: dict[str, ExtractedMedia] = {}
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path in zf.namelist():
                rels_root = ET.fromstring(zf.read(rels_path))
                target_to_equation = {
                    Path(eq.get("position", "")).as_posix().replace("\\", "/"): eq.get("latex", "")
                    for eq in mathtype_equations
                    if eq.get("position") and eq.get("latex")
                }
                rid_to_target: dict[str, str] = {}
                for rel in rels_root:
                    if _local_name(rel.tag) != "Relationship":
                        continue
                    r_id = rel.get("Id", "")
                    target = rel.get("Target", "")
                    candidates = _docx_target_candidates(target)
                    if any(candidate in zf.namelist() for candidate in candidates):
                        rid_to_target[r_id] = next(
                            candidate for candidate in candidates if candidate in zf.namelist()
                        )

                for r_id, target in rid_to_target.items():
                    normalized_target = target.replace("\\", "/")
                    if "/embeddings/" in normalized_target:
                        latex = target_to_equation.get(normalized_target, "")
                        if latex:
                            mathtype_map[r_id] = latex

                # 在同一段落中，公式 OLE 前后的两个 WMF 通常是 VML Fallback/Preview。
                # 建立 OLE rId -> 可渲染预览媒体的映射，失败时保持公式原位置。
                for paragraph in root.iter():
                    if _local_name(paragraph.tag) != "p":
                        continue
                    ole_ids = [
                        _attr_by_local_name(node, "id")
                        for node in paragraph.iter()
                        if _local_name(node.tag) == "OLEObject"
                    ]
                    if not ole_ids:
                        continue
                    preview_ids = [
                        _attr_by_local_name(node, "embed") or _attr_by_local_name(node, "id")
                        for node in paragraph.iter()
                        if _local_name(node.tag) == "blip"
                    ]
                    fallback_ids = [
                        _attr_by_local_name(node, "id")
                        for node in paragraph.iter()
                        if _local_name(node.tag) == "imagedata"
                    ]
                    preview_media = [
                        rid_to_media[r_id]
                        for r_id in preview_ids
                        if r_id in rid_to_media
                    ]
                    fallback_media = [
                        rid_to_media[r_id]
                        for r_id in fallback_ids
                        if r_id in rid_to_media
                    ]
                    for ole_id in ole_ids:
                        # 优先选择 Fallback/Drawing 中的 blip；VML imagedata 是旧版预览，
                        # 但在目标论文中同样可作为无 Fallback 时的回退。
                        preview = (preview_media or fallback_media or [None])[0]
                        if preview is not None:
                            ole_preview_map[ole_id] = preview
        except Exception:
            logger.exception("构建 DOCX 公式关系映射失败")

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
                    child, stem, include_images, rid_to_media, mathtype_map, ole_preview_map, num_info
                )
                if content and content not in seen_content:
                    seen_content.add(content)
                    lines.append(content)
                    lines.append("")

            elif tag == "tbl":
                table_content = self._extract_table(
                    child, stem, include_images, rid_to_media, mathtype_map, ole_preview_map
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
                                    content_child, stem, include_images, rid_to_media, mathtype_map, ole_preview_map
                                )
                                if content and content not in seen_content:
                                    seen_content.add(content)
                                    lines.append(content)
                                    lines.append("")
                            elif ctag == "tbl":
                                table_content = self._extract_table(
                                    content_child,
                                    stem,
                                    include_images,
                                    rid_to_media,
                                    mathtype_map,
                                    ole_preview_map,
                                )
                                if table_content:
                                    lines.append(table_content)
                                    lines.append("")

            # OLEObject 属于段落内部节点，已由 _extract_content_recursive 按原顺序处理。

        return "\n".join(lines).strip() + "\n"

    def _build_rid_media_map(self, zf, media_map: dict[str, ExtractedMedia]) -> dict[str, ExtractedMedia]:
        """构建 rId -> ExtractedMedia 映射，兼容 Strict/Transitional 关系属性。"""
        rid_to_media: dict[str, ExtractedMedia] = {}
        try:
            rels_path = "word/_rels/document.xml.rels"
            if rels_path not in zf.namelist():
                return rid_to_media
            rels_root = ET.fromstring(zf.read(rels_path))
            for rel in rels_root:
                if _local_name(rel.tag) != "Relationship":
                    continue
                r_id = rel.get("Id", "")
                target = rel.get("Target", "")
                full_path = next(
                    (candidate for candidate in _docx_target_candidates(target) if candidate in media_map),
                    None,
                )
                if full_path is not None:
                    rid_to_media[r_id] = media_map[full_path]
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

    def _extract_paragraph(
        self,
        para,
        stem,
        include_images,
        rid_to_media,
        mathtype_map,
        ole_preview_map=None,
        num_info=None,
    ):
        """提取段落内容，公式和图片按 XML 节点顺序输出。"""
        parts = []
        if ole_preview_map is None:
            ole_preview_map = {}

        list_prefix = ""
        if num_info:
            ilvl = num_info.get("ilvl", 0)
            num_type = num_info.get("type", "bullet")
            indent = "  " * ilvl
            if num_type == "bullet":
                list_prefix = f"{indent}- "
            else:
                list_prefix = f"{indent}1. "

        self._extract_content_recursive(
            para,
            stem,
            parts,
            include_images,
            rid_to_media,
            mathtype_map,
            ole_preview_map,
        )

        content = "".join(parts).strip()
        if content and list_prefix:
            content = list_prefix + content
        return content

    def _extract_content_recursive(
        self,
        elem,
        stem,
        parts,
        include_images,
        rid_to_media,
        mathtype_map,
        ole_preview_map,
        depth=0,
    ):
        """递归提取内容，处理文本框等嵌套结构。"""
        if depth > 20:
            return
        for child in elem:
            tag = _local_name(child.tag)

            if tag == "r":
                math_value = self._check_ole_object(
                    child,
                    stem,
                    mathtype_map,
                    ole_preview_map,
                    rid_to_media,
                )
                if math_value:
                    parts.append(math_value)
                    continue

                has_textbox = False
                handled_media = False
                handled_video = False
                for r_child in child.iter():
                    r_child_tag = _local_name(r_child.tag)
                    if r_child_tag == "txbxContent" and not has_textbox:
                        self._extract_content_recursive(
                            r_child,
                            stem,
                            parts,
                            include_images,
                            rid_to_media,
                            mathtype_map,
                            ole_preview_map,
                            depth + 1,
                        )
                        has_textbox = True
                    elif r_child_tag in ("videoFile", "audioFile") and include_images and not handled_video:
                        link = _attr_by_local_name(r_child, "link")
                        if link and link in rid_to_media:
                            m = rid_to_media[link]
                            parts.append("\n" + self._render_media(m, stem, alt="") + "\n")
                            handled_video = True
                            handled_media = True
                    elif r_child_tag == "media" and include_images and not handled_video:
                        embed = _attr_by_local_name(r_child, "embed")
                        if embed and embed in rid_to_media:
                            m = rid_to_media[embed]
                            parts.append("\n" + self._render_media(m, stem, alt="") + "\n")
                            handled_video = True
                            handled_media = True
                    elif r_child_tag == "blip" and include_images and not handled_media:
                        embed = _attr_by_local_name(r_child, "embed")
                        if embed and embed in rid_to_media:
                            m = rid_to_media[embed]
                            # alt 用文件名(去后缀)作为默认 title,比 "image" 更友好
                            alt = Path(m.local_path).stem
                            parts.append("\n" + self._render_media(m, stem, alt=alt) + "\n")
                            handled_media = True
                    # 不 return: 继续递归到 blip 子元素找 <a14:imgLayer>(HD Photo 场景)
                    elif r_child_tag == "imgLayer" and include_images and not handled_media:
                        embed = _attr_by_local_name(r_child, "embed")
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
                    child,
                    stem,
                    parts,
                    include_images,
                    rid_to_media,
                    mathtype_map,
                    ole_preview_map,
                    depth + 1,
                )
            else:
                self._extract_content_recursive(
                    child,
                    stem,
                    parts,
                    include_images,
                    rid_to_media,
                    mathtype_map,
                    ole_preview_map,
                    depth + 1,
                )

    def _render_media(self, media: ExtractedMedia, stem: str, alt: str = "") -> str:
        """渲染媒体引用: image 用 ![](), video/audio 用 HTML 标签。"""
        return format_media_ref(media_rel_path(stem, media), media.kind, alt or "")

    def _check_ole_object(
        self,
        run,
        stem,
        mathtype_map,
        ole_preview_map=None,
        rid_to_media=None,
    ):
        """返回原位置的公式 LaTeX，或无法转换时的预览图片引用。"""
        if ole_preview_map is None:
            ole_preview_map = {}

        for child in run.iter():
            if _local_name(child.tag) != "OLEObject":
                continue
            prog_id = _attr_by_local_name(child, "ProgID")
            r_id = _attr_by_local_name(child, "id")
            if "Equation" not in prog_id or not r_id:
                continue
            if r_id in mathtype_map:
                return f"${mathtype_map[r_id]}$"
            preview = ole_preview_map.get(r_id)
            if preview is not None:
                return self._render_media(preview, stem, alt="formula")
        return None

    def _get_media_from_elem(self, elem, rid_to_media):
        """从元素中获取所有媒体(图/视/音)，兼容 Strict/Transitional 属性。"""
        media = []
        for ref in elem.iter():
            tag = _local_name(ref.tag)
            if tag in ("blip", "imgLayer", "imagedata"):
                embed = _attr_by_local_name(ref, "embed") or _attr_by_local_name(ref, "id")
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

    def _extract_table(
        self,
        table,
        stem,
        include_images,
        rid_to_media,
        mathtype_map=None,
        ole_preview_map=None,
    ):
        """提取表格，支持合并单元格。"""
        if mathtype_map is None:
            mathtype_map = {}
        if ole_preview_map is None:
            ole_preview_map = {}
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
                            para,
                            stem,
                            include_images,
                            rid_to_media,
                            mathtype_map,
                            ole_preview_map,
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