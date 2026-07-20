"""PPTX 文档提取器 - 重构版

支持: 文本 / 表格 / OMML & MathType 公式 / 图片 / 视频 / 音频
所有媒体按 kind 分别连续编号(image_001.png, video_001.mp4, audio_001.mp3),
markdown 引用按 kind 分别用 ![](), <video>, <audio> 渲染。
"""
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
from ._utils import (
    ExtractedMedia,
    classify_media,
    format_media_ref,
    local_name as _local_name,
    markdown_table as _markdown_table,
    media_filename,
    media_rel_path,
)
from logger import get_logger

logger = get_logger("pptx_extractor")


# XML 命名空间常量(关系 ID / 嵌入 / 链接)
_R_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _find_child(elem, tag_name):
    for child in elem:
        if _local_name(child.tag) == tag_name:
            return child
    return None


def _find_children(elem, tag_name):
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
            slides, media_list = self._parse_structure(zf, names)

            # 获取 MathType 公式
            mathtype_equations = []
            if self.mathtype_converter:
                try:
                    mathtype_equations = self.mathtype_converter.extract_mathtype_from_pptx(source)
                except Exception as e:
                    logger.warning("MathType 提取失败，公式将退化为图片", error=str(e), source=source)

            # 第二步：确定媒体列表(图片/视频/音频,按 slide 出现顺序排)
            used_media = self._determine_media(slides, media_list, zf)

            # 第三步：按 kind 分别连续编号
            media_records = self._assign_numbers(used_media)

            # 第四步：提取内容(markdown)
            result.markdown = self._extract_content(
                slides, media_records, mathtype_equations, zf,
                path.name, include_images
            )

            # 第五步：抽取媒体文件
            if include_images and output_dir and media_records:
                extracted = self._extract_files(
                    media_records, zf, output_dir, path.stem
                )
                result.images = [m.local_path for m in extracted]
                result.media_kinds = [m.kind for m in extracted]

        result.metadata = {
            "format": "pptx",
            "reader": "pptx_extractor",
            "slides": len(slides),
        }
        return result

    # ========== MathType 公式映射 ==========

    def _build_slide_mathtype_map(self, zf, slide_path: str, mathtype_equations: list) -> dict:
        """为一个 slide 构建 rId → LaTeX 映射。

        rId 在各 slide 的 rels 里独立(都从 rId1 开始),不能跨 slide 合并。
        """
        slide_map: dict[str, str] = {}
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

        try:
            pres_xml = zf.read("ppt/presentation.xml")
            pres_root = ET.fromstring(pres_xml)
            for sldId in pres_root.iter():
                if _local_name(sldId.tag) == "sldId":
                    rId = sldId.get(f"{_R_NS}id", "")
                    if rId:
                        slides.append({"rId": rId})
        except Exception:
            pass

        try:
            rels_xml = zf.read("ppt/_rels/presentation.xml.rels")
            rels_root = ET.fromstring(rels_xml)
            rId_to_path: dict[str, str] = {}
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

        media_list = sorted(name for name in names if name.startswith("ppt/media/"))
        media_list = filter_mathtype_previews(media_list, zf)

        return slides, media_list

    # ========== 第二步：确定媒体列表 ==========

    def _determine_media(self, slides, media_list, zf):
        """扫描每个 slide,找出所有被引用的媒体(图/视/音),返回按出现顺序的字典列表。

        每条 dict: {media_path, kind, ext, alt, type}
        - type="main" → 主引用(图的 blip、视/音的 videoFile/audioFile/p14:media)
        - type="preview" → AlternateContent Fallback 中的预览图(公式回退等)

        同一个 media_path 可能被 slide xml 多个标签引用(如 videoFile 和 p14:media),
        按 rels Type 优先级取最具体的 kind: video > audio > image > other。
        """
        used_media: list[dict] = []
        # 同一 media_path 可能被多次扫描,记录已有记录以便按需升级 kind
        seen: dict[str, dict] = {}

        for slide_info in slides:
            slide_path = slide_info.get("path", "")
            if not slide_path:
                continue

            rid_to_info: dict[str, tuple[str, str | None]] = {}
            rels_path = f"ppt/slides/_rels/{Path(slide_path).name}.rels"
            if rels_path in zf.namelist():
                rels_xml = zf.read(rels_path).decode("utf-8")
                # 同时匹配 media / hdphoto，同一可接受两种 Target 格式:
                # 1. 标准 OOXML: Target="../media/xxx.ext"
                # 2. mock/部分工具: Target="media/xxx.ext" (无 ../ 前缀)
                for match in re.finditer(
                    r'Id="(rId\d+)"[^>]*Type="([^"]+)"[^>]*Target="(?:\.\./)?(media|hdphoto)/([^"]+)"',
                    rels_xml,
                ):
                    rid = match.group(1)
                    rtype = match.group(2)
                    subdir = match.group(3)
                    media_file = match.group(4)
                    kind = self._kind_from_rels_type(rtype)
                    rid_to_info[rid] = (f"ppt/{subdir}/{media_file}", kind)

            try:
                slide_xml = zf.read(f"ppt/{slide_path}")
                slide_root = ET.fromstring(slide_xml)
                self._scan_media_in_element(
                    slide_root, rid_to_info, used_media, seen
                )
            except Exception:
                continue

        return used_media

    @staticmethod
    def _kind_from_rels_type(rels_type: str) -> str | None:
        """rels Type → media kind。返回 None 表示由扩展名决定(rels Type 是通用 media 类型)。"""
        rt = rels_type.lower()
        if "video" in rt:
            return "video"
        if "audio" in rt:
            return "audio"
        # image / hdphoto(HD Photo 即 JPEG XR 是一种图片格式)均按图处理
        if "image" in rt or "hdphoto" in rt:
            return "image"
        # Microsoft 2007 通用 media 类型,目标扩展名定夺
        return None

    @staticmethod
    def _kind_priority(kind: str) -> int:
        return {"video": 4, "audio": 3, "image": 2, "other": 1}.get(kind, 0)

    def _scan_media_in_element(self, elem, rid_to_info, used_media, seen):
        """递归扫描元素中所有媒体引用。

        支持:
        - <a:blip r:embed="rIdN">   图片
        - <a14:imgLayer r:embed="rIdN">  HD Photo(wdp 文件)
        - <p:videoFile r:link="rIdN"> / <a:videoFile r:link="rIdN">  视频
        - <p:audioFile r:link="rIdN"> / <a:audioFile r:link="rIdN">  音频
        - <p14:media r:embed="rIdN">  PowerPoint 2010+ 通用媒体扩展(常见于嵌在 pic 里)
        - <mc:AlternateContent><mc:Choice> 优先;Fallback 只收 Equation.3 预览
        """
        tag = _local_name(elem.tag)

        if tag == "AlternateContent":
            for child in elem:
                if _local_name(child.tag) == "Choice":
                    self._scan_media_in_element(
                        child, rid_to_info, used_media, seen
                    )
            for child in elem:
                if _local_name(child.tag) == "Fallback":
                    self._scan_fallback_preview(
                        child, rid_to_info, used_media, seen
                    )
            return

        # 图片 / HD Photo 都用 r:embed
        # blip / imgLayer 仍要继续递归子元素(<a:blip> 内部可能含
        # <a:extLst><a:ext><a14:imgLayer> 这种 HD Photo 扩展元数据)
        if tag == "blip":
            embed = elem.get(f"{_R_NS}embed", "")
            if embed and embed in rid_to_info:
                self._add_media(
                    rid_to_info[embed][0], rid_to_info[embed][1],
                    seen=seen, used_media=used_media, mtype="main",
                )
            # 继续递归(不 return),子元素里可能含 imgLayer
        elif tag == "imgLayer":
            embed = elem.get(f"{_R_NS}embed", "")
            if embed and embed in rid_to_info:
                self._add_media(
                    rid_to_info[embed][0], rid_to_info[embed][1],
                    seen=seen, used_media=used_media, mtype="main",
                )
            return

        # 视频 / 音频文件引用(任意命名空间: a: / p: 都兼容)
        if tag in ("videoFile", "audioFile"):
            link = elem.get(f"{_R_NS}link", "")
            if link and link in rid_to_info:
                self._add_media(
                    rid_to_info[link][0], rid_to_info[link][1],
                    seen=seen, used_media=used_media, mtype="main",
                )
            return

        # PowerPoint 2010+ 媒体扩展(p14:media 用 r:embed)
        if tag == "media":
            embed = elem.get(f"{_R_NS}embed", "")
            if embed and embed in rid_to_info:
                self._add_media(
                    rid_to_info[embed][0], rid_to_info[embed][1],
                    seen=seen, used_media=used_media, mtype="main",
                )
            return

        for child in elem:
            self._scan_media_in_element(
                child, rid_to_info, used_media, seen
            )

    def _scan_fallback_preview(self, elem, rid_to_info, used_media, seen):
        """在 AlternateContent.Fallback 中收集 Equation.3 预览图。"""
        has_equation3 = False
        for child in elem.iter():
            if _local_name(child.tag) == "oleObj":
                prog_id = child.get("progId", "")
                if prog_id == "Equation.3":
                    has_equation3 = True
                    break
        if not has_equation3:
            return
        for child in elem.iter():
            if _local_name(child.tag) == "blip":
                embed = child.get(f"{_R_NS}embed", "")
                if embed and embed in rid_to_info:
                    self._add_media(
                        rid_to_info[embed][0], "image",
                        seen=seen, used_media=used_media, mtype="preview",
                    )

    def _add_media(self, media_path: str, kind: str | None,
                   seen: dict, used_media: list, mtype: str = "main"):
        """把媒体加入 used_media;同一 media_path 多次出现时按 kind 优先级升级。

        kind 优先级: video > audio > image > other。
        """
        if not media_path:
            return
        ext = Path(media_path).suffix.lower()
        if kind is None:
            kind = classify_media(ext)
        if kind == "other":
            kind = "other"  # 保持 other

        if media_path in seen:
            existing = seen[media_path]
            # 升级 kind(选更具体的)
            if self._kind_priority(kind) > self._kind_priority(existing["kind"]):
                existing["kind"] = kind
            return

        record = {
            "media_path": media_path,
            "kind": kind,
            "ext": ext,
            "alt": "image" if mtype == "main" and kind == "image" else "",
            "type": mtype,
        }
        seen[media_path] = record
        used_media.append(record)

    # ========== 第三步：分配编号 ==========

    def _assign_numbers(self, used_media: list[dict]) -> dict[str, dict]:
        """按 kind 分别连续编号,返回 media_path -> {kind, ext, new_name, alt, type}"""
        media_records: dict[str, dict] = {}
        counters = {"image": 0, "video": 0, "audio": 0, "other": 0}

        for media in used_media:
            media_path = media["media_path"]
            kind = media["kind"]
            ext = media["ext"]
            alt = media["alt"]

            counters[kind] += 1
            # EMF/WMF 转 PNG,其他保持原扩展
            if ext in (".emf", ".wmf"):
                new_name = media_filename("image", counters[kind], ".png")
            else:
                new_name = media_filename(kind, counters[kind], ext)

            media_records[media_path] = {
                "kind": kind,
                "ext": ext,
                "new_name": new_name,
                "alt": alt,
                "type": media.get("type", "main"),
            }

        return media_records

    # ========== 第四步：提取内容 ==========

    def _extract_content(self, slides, media_records, mathtype_equations, zf,
                         filename, include_images):
        # 用 stem(去后缀)拼 {stem}_media/xxx 与 main.py 写到磁盘的子目录对齐
        self._current_stem = Path(filename).stem

        lines = [f"# {filename}", ""]

        for i, slide_info in enumerate(slides, 1):
            slide_path = slide_info.get("path", "")
            if not slide_path:
                continue

            slide_mathtype_map = self._build_slide_mathtype_map(
                zf, slide_path, mathtype_equations
            )

            try:
                slide_xml = zf.read(f"ppt/{slide_path}")
                slide_root = ET.fromstring(slide_xml)
                self._current_slide_path = slide_path

                lines.append(f"## Slide {i}")
                lines.append("")

                slide_content = self._extract_element(
                    slide_root, media_records, slide_mathtype_map, zf
                )
                lines.append(slide_content)
                lines.append("")
            except Exception as e:
                logger.warning("Slide 提取失败", error=str(e), slide_path=slide_path)
                continue

        return "\n".join(lines).strip() + "\n"

    def _extract_element(self, elem, media_records, mathtype_map, zf, depth=0):
        if depth > 50:
            return ""

        tag = _local_name(elem.tag)
        parts = []

        if tag == "AlternateContent":
            for child in elem:
                if _local_name(child.tag) == "Choice":
                    content = self._extract_element(
                        child, media_records, mathtype_map, zf, depth + 1
                    )
                    if content:
                        parts.append(content)
                    break
            return "\n".join(parts)

        if tag == "sp":
            content = self._extract_sp(elem, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        if tag == "graphicFrame":
            content = self._extract_graphic_frame(elem, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        if tag == "pic":
            stem = getattr(self, '_current_stem', '')
            slide_path = getattr(self, '_current_slide_path', None)
            img_ref = self._extract_pic_media(elem, media_records, zf, stem, slide_path)
            if img_ref:
                parts.append(img_ref)
            return "\n".join(parts)

        if tag == "tbl":
            content = self._extract_table(elem, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        if tag == "p":
            content = self._extract_paragraph(elem, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        if tag == "txBody":
            content = self._extract_tx_body(elem, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        for child in elem:
            content = self._extract_element(
                child, media_records, mathtype_map, zf, depth + 1
            )
            if content:
                parts.append(content)

        return "\n".join(parts)

    def _extract_sp(self, sp, media_records, mathtype_map, zf):
        parts = []

        tx_body = _find_child(sp, "txBody")
        if tx_body is not None:
            content = self._extract_tx_body(tx_body, media_records, mathtype_map, zf)
            if content:
                parts.append(content)

        # sp 内可能含视频/音频(较少见,通常在 graphicFrame)
        stem = getattr(self, '_current_stem', '')
        slide_path = getattr(self, '_current_slide_path', None)
        for child in sp.iter():
            child_tag = _local_name(child.tag)
            if child_tag in ("videoFile", "audioFile"):
                ref = self._extract_link_media(
                    child, media_records, zf, stem, slide_path, link_attr="link"
                )
                if ref:
                    parts.append(ref)

        return "\n".join(parts)

    def _extract_tx_body(self, tx_body, media_records, mathtype_map, zf):
        parts = []
        for child in tx_body:
            tag = _local_name(child.tag)
            if tag == "p":
                content = self._extract_paragraph(child, media_records, mathtype_map, zf)
                if content:
                    parts.append(content)
        return "\n".join(parts)

    def _extract_paragraph(self, para, media_records, mathtype_map, zf):
        parts = []
        list_info = None

        pPr = _find_child(para, "pPr")
        if pPr is not None:
            list_info = self._get_list_info(pPr)

        self._extract_para_content(para, parts, media_records, mathtype_map, zf)

        content = "".join(parts).strip()
        if content and list_info and list_info["type"]:
            indent = "  " * list_info["level"]
            marker = list_info["marker"]
            content = f"{indent}{marker} {content}"
        return content

    def _extract_para_content(self, elem, parts, media_records, mathtype_map, zf, depth=0):
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
                self._extract_para_content(child, parts, media_records, mathtype_map, zf, depth + 1)

    def _extract_run(self, run):
        text_parts = []
        for child in run:
            tag = _local_name(child.tag)
            if tag == "t" and child.text:
                text_parts.append(child.text)
        return "".join(text_parts)

    def _get_list_info(self, pPr):
        level = 0
        list_type = None
        marker = None

        lvl = _find_child(pPr, "lvl")
        if lvl is not None:
            level = int(lvl.get("{http://schemas.openxmlformats.org/drawingml/2006/main}val", "0"))

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

        if list_type is None:
            bu_auto = _find_child(pPr, "buAutoNum")
            if bu_auto is not None:
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
        return {"type": list_type, "level": level, "marker": marker}

    def _extract_graphic_frame(self, gf, media_records, mathtype_map, zf):
        parts = []

        # 表格优先
        tbl = self._find_recursive(gf, "tbl")
        if tbl is not None:
            content = self._extract_table(tbl, media_records, mathtype_map, zf)
            if content:
                parts.append(content)
            return "\n".join(parts)

        # OLE 对象(公式)
        for child in gf.iter():
            tag = _local_name(child.tag)
            if tag == "oleObj":
                content = self._extract_ole(child, gf, media_records, zf)
                if content:
                    parts.append(content)
                break

        # 视频/音频(在 graphicFrame 里常以 p:video / p:audio 形式存在)
        stem = getattr(self, '_current_stem', '')
        slide_path = getattr(self, '_current_slide_path', None)
        for child in gf.iter():
            tag = _local_name(child.tag)
            if tag == "videoFile":
                ref = self._extract_link_media(
                    child, media_records, zf, stem, slide_path, link_attr="link"
                )
                if ref:
                    parts.append(ref)
            elif tag == "audioFile":
                ref = self._extract_link_media(
                    child, media_records, zf, stem, slide_path, link_attr="link"
                )
                if ref:
                    parts.append(ref)

        return "\n".join(parts)

    def _extract_table(self, tbl, media_records, mathtype_map, zf):
        rows = []
        for tr in tbl:
            if _local_name(tr.tag) != "tr":
                continue
            row = []
            for tc in tr:
                if _local_name(tc.tag) != "tc":
                    continue
                cell_content = self._extract_element(tc, media_records, mathtype_map, zf)
                row.append(cell_content.replace("\n", " ").strip())
            if row:
                rows.append(row)
        if not rows:
            return ""
        return _markdown_table(rows, trailing_blank=True)

    def _extract_ole(self, ole, graphic_frame, media_records, zf):
        prog_id = ole.get("progId", "")
        rId = ole.get(f"{_R_NS}id", "")

        if "Equation" in prog_id:
            slide_mathtype_map = self._build_slide_mathtype_map(
                zf, getattr(self, '_current_slide_path', ""), []
            )
            if rId and rId in slide_mathtype_map:
                return f"${slide_mathtype_map[rId]}$"

            preview = self._get_ole_preview(graphic_frame, media_records, zf)
            if preview:
                return preview
        return ""

    def _get_ole_preview(self, graphic_frame, media_records, zf):
        for child in graphic_frame.iter():
            tag = _local_name(child.tag)
            if tag == "Fallback":
                for blip in self._find_all(child, "blip"):
                    embed = blip.get(f"{_R_NS}embed", "")
                    if embed:
                        preview = self._find_preview_by_rid(embed, media_records, zf)
                        if preview:
                            return preview
        return None

    def _find_preview_by_rid(self, rid, media_records, zf):
        stem = getattr(self, '_current_stem', '')
        for name in zf.namelist():
            if name.startswith("ppt/slides/_rels/") and name.endswith(".rels"):
                rels_xml = zf.read(name).decode("utf-8")
                for match in re.finditer(
                    f'Id="{rid}"[^>]*Target="[^"]*media/([^"]+)"', rels_xml
                ):
                    media_name = match.group(1)
                    original_path = f"ppt/media/{media_name}"
                    if original_path in media_records:
                        info = media_records[original_path]
                        if info["kind"] == "image":
                            return format_media_ref(
                                f"{stem}_media/{info['new_name']}",
                                "image",
                                info.get("alt", "formula") or "formula",
                            )
        return None

    def _extract_pic_media(self, elem, media_records, zf, stem, slide_path):
        """处理 <p:pic> 节点:按优先级返回媒体引用。

        优先级: videoFile / audioFile / p14:media 上下文 > blip(imgLayer)。
        PowerPoint 常把视频包装在 <p:pic> 里(看似是图片,实际是视频帧),
        这种 pic 同时含 <a:blip>(海报图) 和 <a:videoFile>/<p14:media>(视频),
        要优先输出视频。

        实际 PPTX 中 rId 会有多种用途(<a:videoFile r:link=...>、
        <p14:media r:embed=...>),有些 rId 的 Target 是空占位(没有可用文件)。
        本函数收集所有 video/audio 引用,依次试,首个能 resolve 的赢;
        都失败才 fallback 到 blip。
        """
        if not (zf and slide_path):
            return None

        # 收集 pic 内所有 video/audio rId(顺序按 XML 出现顺序)
        candidate_rids: list[str] = []
        for child in elem.iter():
            tag = _local_name(child.tag)
            if tag in ("videoFile", "audioFile"):
                rid = child.get(f"{_R_NS}link", "")
                if rid and rid not in candidate_rids:
                    candidate_rids.append(rid)
            elif tag == "media":
                rid = child.get(f"{_R_NS}embed", "")
                if rid and rid not in candidate_rids:
                    candidate_rids.append(rid)

        for rid in candidate_rids:
            ref = self._resolve_media_ref(
                rid, media_records, zf, stem, slide_path, use_link=True
            )
            if ref:
                return ref

        # 没有有效 video/audio 上下文,按 blip(imgLayer) 走图片
        for child in elem.iter():
            if _local_name(child.tag) in ("blip", "imgLayer"):
                embed = child.get(f"{_R_NS}embed", "")
                if embed:
                    return self._resolve_media_ref(
                        embed, media_records, zf, stem, slide_path
                    )
        return None

    def _extract_link_media(self, elem, media_records, zf, stem, slide_path, link_attr="link"):
        """处理 videoFile / audioFile 节点,按 r:link 找 rels 中的媒体。"""
        rid = elem.get(f"{_R_NS}{link_attr}", "")
        if rid and zf and slide_path:
            return self._resolve_media_ref(rid, media_records, zf, stem, slide_path, use_link=True)
        return None

    def _resolve_media_ref(self, rid, media_records, zf, stem, slide_path, use_link=False):
        """通用:按 rId 查 slide rels -> 媒体路径 -> 在 media_records 找记录 -> 返回 markdown 引用。

        use_link=True 时查 r:link(视频/音频),否则查 r:embed(图片)。
        """
        rels_path = f"ppt/slides/_rels/{Path(slide_path).name}.rels"
        if rels_path not in zf.namelist():
            return None
        rels_xml = zf.read(rels_path).decode("utf-8")
        # rId -> media filename(可能有 hdphoto 前缀)
        for match in re.finditer(
            f'Id="{rid}"[^>]*Target="(?:\\.\\./)?(media|hdphoto)/([^"]+)"',
            rels_xml,
        ):
            subdir = match.group(1)
            media_name = match.group(2)
            original_path = f"ppt/{subdir}/{media_name}"
            if original_path in media_records:
                info = media_records[original_path]
                kind = info["kind"]
                alt = info.get("alt", "")
                # EMF/WMF 转 PNG 后,alt 仍可保留
                if kind == "video" and not alt:
                    alt = Path(media_name).stem
                if kind == "audio" and not alt:
                    alt = Path(media_name).stem
                return format_media_ref(
                    f"{stem}_media/{info['new_name']}",
                    kind,
                    alt,
                )
        return None

    def _find_recursive(self, elem, tag_name):
        for child in elem:
            if _local_name(child.tag) == tag_name:
                return child
            result = self._find_recursive(child, tag_name)
            if result is not None:
                return result
        return None

    def _find_all(self, elem, tag_name):
        results = []
        for child in elem:
            if _local_name(child.tag) == tag_name:
                results.append(child)
            results.extend(self._find_all(child, tag_name))
        return results

    # ========== 第五步：抽取媒体文件 ==========

    def _extract_files(self, media_records, zf, output_dir, stem):
        """从 zip 抽所有媒体文件到 {stem}_media/ 目录,EMF/WMF 转 PNG。

        返回 list[ExtractedMedia],用于填 result.images / result.media_kinds。
        """
        media_dir = Path(output_dir) / f"{stem}_media"
        media_dir.mkdir(parents=True, exist_ok=True)

        extracted: list[ExtractedMedia] = []

        for original_path, info in media_records.items():
            if original_path not in zf.namelist():
                continue
            new_name = info["new_name"]
            kind = info["kind"]
            ext = info["ext"]
            out_path = media_dir / new_name

            try:
                with zf.open(original_path) as src, open(out_path, "wb") as dst:
                    dst.write(src.read())

                # EMF/WMF:原扩展名存为 raw_,然后尝试转 PNG,失败则保留原 EMF/WMF
                if ext in (".emf", ".wmf"):
                    png_path = media_dir / media_filename("image", 0, ".png")  # 占位
                    # 用 new_name 已定为 .png,直接把 out_path 当 raw 转
                    raw_path = out_path.with_suffix(ext)
                    try:
                        out_path.rename(raw_path)
                    except OSError:
                        raw_path = out_path
                    if convert_emf_to_png(str(raw_path), str(out_path)):
                        try:
                            raw_path.unlink()
                        except OSError:
                            pass
                        extracted.append(ExtractedMedia(
                            local_path=str(out_path),
                            original_path=original_path,
                            kind="image",
                            ext=".png",
                        ))
                    else:
                        # 转换失败:保留原 EMF/WMF(重命名为 *.original)
                        try:
                            raw_path.rename(out_path.with_suffix(".original"))
                            final = str(out_path.with_suffix(".original"))
                        except OSError:
                            final = str(raw_path)
                        extracted.append(ExtractedMedia(
                            local_path=final,
                            original_path=original_path,
                            kind="image",
                            ext=ext,
                        ))
                    continue

                extracted.append(ExtractedMedia(
                    local_path=str(out_path),
                    original_path=original_path,
                    kind=kind,
                    ext=ext,
                ))
            except Exception as e:
                logger.warning("PPTX 媒体抽取失败", path=original_path, error=str(e))
                continue

        return extracted

    # ========== PPT 转换 ==========

    def _handle_legacy_ppt(self, path, output_dir, include_images):
        """处理旧版 .ppt 文件。

        使用 DispatchEx 创建独立 PowerPoint 进程,避免与系统中已有的
        PowerPoint 实例互相争抢 COM 锁。SaveAs 后立即 Close + Quit。
        """
        result = ExtractionResult()
        try:
            import win32com.client
            with tempfile.TemporaryDirectory() as tmpdir:
                pptx_filename = f"{path.stem}.pptx"
                pptx_path = os.path.join(tmpdir, pptx_filename)
                abs_source = str(path.resolve())
                powerpoint = win32com.client.DispatchEx("PowerPoint.Application")
                try:
                    presentation = powerpoint.Presentations.Open(abs_source)
                    presentation.SaveAs(pptx_path, 24)
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