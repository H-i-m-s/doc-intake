"""PDF 提取器 - 本地兜底(PDF 降级链的最末档)

只做 PDF 内嵌文本/图片提取(基于 PyMuPDF)。
不做 OCR、不识别公式、不识别表格、不重排分栏。
是有总比没有好的兜底——保证用户拿到字符流。
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Optional

from .base import BaseExtractor, ExtractionResult
from ._utils import format_media_ref
from logger import get_logger

logger = get_logger("pdf_extractor")

# 页码范围解析: "1-3,8,11-12" -> [1,2,3,8,11,12]
_PAGE_RANGE_PATTERN = re.compile(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*")

# ─────────────────────────────────────────────────────────────────────
# 乱码检测 — Founder 方正 PDF 的 ToUnicode CMap 经常残缺/错误,
# 导致 ASCII / 数字字符被错误 fallback 到 CJK 扩展区。识别这些特征
# 字符并在占比超过阈值时给出 warning,告知用户这部分字符不可信,
# 应当走云端 OCR 后端(MinerU / PaddleOCR)。
# ─────────────────────────────────────────────────────────────────────

# Founder 方正 PDF 典型乱码区:CJK 扩展区 A 中 0x7280–0x72FF 段
# (常见样本:犐犆犛犌犅犆犇犈犉犊,对应 ASCII 'I''C''S''G''B' 等字符)
_FOUNDER_GARB_RANGE = (0x7280, 0x72FF)

# 真实文档几乎不会出现的 CJK 扩展区 (C/D/E/F/G/H)
# 出现 >0.5% 几乎肯定是字体 fallback 乱码
_RARE_CJK_RANGES = (
    (0x2A700, 0x2B73F),  # Ext C
    (0x2B740, 0x2B81F),  # Ext D
    (0x2B820, 0x2CEAF),  # Ext E
    (0x2CEB0, 0x2EBEF),  # Ext F
    (0x30000, 0x3134F),  # Ext G
    (0x31350, 0x323AF),  # Ext H
)


def _is_founder_garb_char(ch: str) -> bool:
    """Founder 方正 PDF 典型乱码特征字符 (0x7280-0x72FF)"""
    cp = ord(ch)
    return _FOUNDER_GARB_RANGE[0] <= cp <= _FOUNDER_GARB_RANGE[1]


def _is_rare_cjk_char(ch: str) -> bool:
    """真实文档几乎不用的 CJK 扩展区字符(出现 = 字体 fallback 乱码)"""
    cp = ord(ch)
    for lo, hi in _RARE_CJK_RANGES:
        if lo <= cp <= hi:
            return True
    return False


def count_garbled_chars(text: str) -> tuple[int, int, int]:
    """统计 Founder 乱码字符 / 罕见 CJK 字符数量。

    Returns: (founder_garb_count, rare_cjk_count, total_non_ws_count)
    """
    founder = 0
    rare = 0
    total = 0
    for ch in text:
        if ch.isspace():
            continue
        total += 1
        if _is_founder_garb_char(ch):
            founder += 1
        elif _is_rare_cjk_char(ch):
            rare += 1
    return founder, rare, total


def parse_page_range(spec: Optional[str], total_pages: int) -> list[int]:
    """解析页码范围字符串,返回 1-based 页码列表。无 spec 返回全部。"""
    if not spec:
        return list(range(1, total_pages + 1))
    selected: set[int] = set()
    for m in _PAGE_RANGE_PATTERN.finditer(spec):
        start = int(m.group(1))
        end = int(m.group(2)) if m.group(2) else start
        if start > end:
            start, end = end, start
        for p in range(start, end + 1):
            if 1 <= p <= total_pages:
                selected.add(p)
    return sorted(selected)


class PdfExtractor(BaseExtractor):
    """PDF 本地兜底提取器

    能力:
    - 提取每页文本字符(按 reading order)
    - 提取 PDF 内嵌图片,按页面 y 坐标插入到对应文字位置
    - 支持 page_range 子集提取

    不做(留云端 OCR/MinerU):
    - 扫描版 OCR(没文本层则返回空)
    - 表格识别
    - 公式识别
    - 分栏重排

    Founder 方正 PDF 的 ToUnicode CMap 经常残缺,会导致 ASCII / 数字字符被错误
    fallback 到 CJK 扩展区。识别后给出 warning,提示用户走云端 OCR 后端。
    """

    name = "pdf"

    def extract(
        self,
        source: str,
        output_dir: Optional[str] = None,
        page_range: Optional[str] = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        import fitz  # PyMuPDF

        result = ExtractionResult()
        warnings: list[str] = []

        doc = fitz.open(source)
        total = len(doc)
        pages = parse_page_range(page_range, total)

        if not pages:
            warnings.append("页码范围筛选后无有效页")
            result.markdown = "# 提取结果\n\n（页码范围无有效页）"
            doc.close()
            return result

        saved_images: list[str] = []
        media_dir: Optional[Path] = None
        stem = Path(source).stem
        if include_images and output_dir:
            media_dir = Path(output_dir) / f"{stem}_media"
            media_dir.mkdir(parents=True, exist_ok=True)

        page_chunks: list[str] = []
        total_chars = 0
        empty_pages = 0
        founder_garb_chars = 0
        rare_cjk_chars = 0
        total_non_ws = 0

        for page_num in pages:
            page = doc[page_num - 1]

            # 拿结构化文字 blocks (y0, y1, text)
            text_blocks = self._extract_text_blocks(page)

            if not text_blocks:
                empty_pages += 1
                page_chunks.append(
                    f"<!-- Page {page_num}: 本地无文本层,需 OCR 才能识别 -->\n"
                )
                continue

            # 全部文字(用于乱码统计 + 字符总数)
            page_text = "\n".join(t for _, _, t in text_blocks)
            total_chars += len(page_text)
            f, r, t = count_garbled_chars(page_text)
            founder_garb_chars += f
            rare_cjk_chars += r
            total_non_ws += t

            # 抽图 + 拿 y0
            page_images_with_pos: list[tuple[float, str, str]] = []
            if include_images:
                page_images_with_pos, page_local_paths = self._extract_page_images(
                    page, page_num, media_dir, doc, stem
                )
                saved_images.extend(page_local_paths)

            # 文字 + 图片按位置合并
            body = self._interleave(text_blocks, page_images_with_pos)
            page_chunks.append(f"## Page {page_num}\n\n{body}\n")

        doc.close()

        if not total_chars:
            warnings.append(
                "本地 PyMuPDF 提取到 0 字符 — PDF 可能是扫描版且本档无 OCR 能力,无法降级"
            )

        if empty_pages and empty_pages < len(pages):
            warnings.append(
                f"本地提取: {empty_pages}/{len(pages)} 页为图片/扫描版,无文本可提取"
            )

        # 乱码字符警告 — 超过阈值时建议走云端 OCR
        if total_non_ws:
            f_ratio = founder_garb_chars / total_non_ws
            r_ratio = rare_cjk_chars / total_non_ws
            if f_ratio >= 0.005:
                warnings.append(
                    f"检测到 Founder 方正 PDF 典型乱码字符 {founder_garb_chars} 个 "
                    f"({f_ratio:.1%},Unicode U+7280–U+72FF 区)。这是 PDF 文件本身 "
                    "ToUnicode CMap 缺失/错误导致的,本地档无法修复;建议用云端 OCR 后端 "
                    "(MinerU / PaddleOCR) 重新提取。"
                )
            elif r_ratio >= 0.005:
                warnings.append(
                    f"检测到罕见 CJK 扩展区字符 {rare_cjk_chars} 个 ({r_ratio:.1%}),"
                    "可能为字体 fallback 乱码,建议走云端 OCR 后端重新提取。"
                )

        result.markdown = (
            f"# PDF 本地提取结果\n\n"
            + f"源文件: {source}\n"
            + f"提取页: {len(pages)}/{total}\n"
            + f"字符总数: {total_chars}\n\n"
            + "\n".join(page_chunks)
        )
        result.images = saved_images
        # PDF 本地档只抽图(视频音频在 PDF 中概念上不常见,本地档不强抽)
        result.media_kinds = ["image"] * len(saved_images)
        result.warnings = warnings
        result.metadata = {
            "format": "pdf",
            "reader": "pymupdf-fallback",
            "pages": {"selected": len(pages), "total": total},
            "chars": total_chars,
            "empty_pages": empty_pages,
            "founder_garb_chars": founder_garb_chars,
            "rare_cjk_chars": rare_cjk_chars,
            "total_non_ws": total_non_ws,
        }
        result.output_dir = str(output_dir) if output_dir else None

        logger.info(
            "PDF 本地兜底提取完成",
            source=source,
            pages=f"{len(pages)}/{total}",
            chars=total_chars,
            images=len(saved_images),
            empty_pages=empty_pages,
            founder_garb_chars=founder_garb_chars,
            rare_cjk_chars=rare_cjk_chars,
        )
        return result

    # ─────────────────────────────────────────────────────────────────
    # 内部工具
    # ─────────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_text_blocks(page) -> list[tuple[float, float, str]]:
        """用 page.get_text('dict') 拿结构化文字,返回 [(y0, y1, text), ...]。

        按 PyMuPDF 的 reading order 输出。block 内的多行用 \\n 拼接。
        """
        d = page.get_text("dict")
        blocks: list[tuple[float, float, str]] = []
        for block in d.get("blocks", []):
            if "lines" not in block:
                continue
            x0, y0, x1, y1 = block["bbox"]
            line_texts: list[str] = []
            for line in block["lines"]:
                line_text = "".join(span.get("text", "") for span in line.get("spans", []))
                if line_text:
                    line_texts.append(line_text)
            text = "\n".join(line_texts).rstrip()
            if text:
                blocks.append((float(y0), float(y1), text))
        return blocks

    @staticmethod
    def _extract_page_images(
        page,
        page_num: int,
        media_dir: Optional[Path],
        doc,
        stem: str,
    ) -> tuple[list[tuple[float, str, str]], list[str]]:
        """从单页提取实际显示的内嵌图片。

        Returns:
            (images_with_pos, local_paths)
            - images_with_pos: [(y0, rel_path, alt), ...] — 按 y0 升序,供按位置插入
            - local_paths:     本地绝对路径列表,供 result.images 使用

        过滤规则:
        - 用 page.get_image_info(xrefs=True) 同时拿有 xref 的图和 inline image (带 bbox)
        - xref <= 0 (inline image) 跳过:doc.extract_image(0) 不可用,且极少出现
        - 同一 xref 一页只取一次
        - "纯资源引用"(在 get_images 但 get_image_info 没有)不抽,避免无意义图
        """
        if media_dir is None:
            return [], []

        images_with_pos: list[tuple[float, float, str, str]] = []
        local_paths: list[str] = []
        seen: set[int] = set()

        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref", 0)
            if xref <= 0:
                # inline image — PyMuPDF 不暴露原始 bytes,跳过
                continue
            if xref in seen:
                continue
            seen.add(xref)

            x0, y0, _x1, _y1 = info["bbox"]

            try:
                img_bytes = doc.extract_image(xref)["image"]
                ext = doc.extract_image(xref)["ext"]
            except Exception as e:
                logger.warning(
                    "PDF 图片提取失败",
                    xref=xref,
                    page=page_num,
                    error=str(e),
                )
                continue

            out_name = f"page{page_num:03d}_xref{xref}.{ext}"
            out_path = media_dir / out_name
            out_path.write_bytes(img_bytes)
            rel = f"{stem}_media/{out_name}"
            alt = f"page{page_num:03d}_xref{xref}"
            images_with_pos.append((float(y0), float(x0), rel, alt))
            local_paths.append(str(out_path))

        # 按 y0 升序,同 y0 按 x0 升序(左到右)。
        # y0 用 5px 粒度取整作为主 key — 容许 PyMuPDF 浮点误差 / 同行的多张图
        # (如双栏示意图的左右两幅)按 x0 排序,避免视觉错位。
        images_with_pos.sort(key=lambda x: (round(x[0] / 5), x[1]))
        # 重新打包为 (y0, rel, alt) 供下游使用
        packed = [(y0, rel, alt) for (y0, _x0, rel, alt) in images_with_pos]
        return packed, local_paths

    @staticmethod
    def _interleave(
        text_blocks: list[tuple[float, float, str]],
        images_with_pos: list[tuple[float, str, str]],
    ) -> str:
        """文字按 reading order 输出,图片按 y0 插入到对应位置。

        合并规则:
        - 对每张图,找 text_blocks 中"第一个 y0 > 图 y0"的 block,图片插在该 block 之前
          (等价于插在前一个 block 之后)。
        - 如果图 y0 < 第一个 block 的 y0,插在 body 最前。
        - 如果图 y0 >= 所有 block 的 y0,插在 body 最后。
        - 同位置多张图:按 images_with_pos 自身的顺序(已按 y0 升序)。

        输出:文字 block 之间用 \\n\\n 分隔,图片以独立段插入。
        """
        if not text_blocks:
            return ""

        pre: list[str] = []
        after: dict[int, list[str]] = defaultdict(list)
        last_idx = len(text_blocks) - 1

        for img_y0, rel, alt in images_with_pos:
            ref = format_media_ref(rel, "image", alt)
            placed = False
            for i, (tb_y0, _tb_y1, _t) in enumerate(text_blocks):
                if tb_y0 <= img_y0:
                    # block 顶 ≤ 图顶 → block 在图上方或同一水平 → 跳过
                    continue
                # block 顶 > 图顶 → block 在图下方 → 图插在此 block 之前
                insert_after = i - 1
                if insert_after < 0:
                    pre.append(ref)
                else:
                    after[insert_after].append(ref)
                placed = True
                break
            if not placed:
                # 所有 block 的 y0 都 <= 图 y0 (图在页面最底)
                after[last_idx].append(ref)

        parts: list[str] = []
        if pre:
            parts.extend(pre)
        for i, (_y0, _y1, text) in enumerate(text_blocks):
            parts.append(text)
            if i in after:
                parts.extend(after[i])

        return "\n\n".join(parts)