"""extractors 公共工具函数

各 extractor 之间重复的辅助函数集中到这里,避免代码重复:
- _local_name: XML 命名空间剥离
- markdown_table: 把二维字符串数组渲染成 Markdown 表格
- element_text: 递归收集 ElementTree 元素的所有文本
"""
from __future__ import annotations

from xml.etree import ElementTree as ET
from typing import List, Optional


def local_name(tag: str) -> str:
    """获取 XML tag 的本地名称(去掉命名空间前缀)

    例如 ``"{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"`` -> ``"p"``
    """
    return tag.split("}")[-1] if "}" in tag else tag


def markdown_table(rows: List[List[str]], trailing_blank: bool = False) -> str:
    """把二维字符串数组渲染成 Markdown 表格

    Args:
        rows: 二维数组,第一行作为表头。空行/空列表返回 ""。
        trailing_blank: 是否在末尾追加一个空行(PPTX 场景需要)。
    """
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    escaped = [[cell.replace("|", "\\|").replace("\n", " ") for cell in row] for row in normalized]

    lines = [
        "| " + " | ".join(escaped[0]) + " |",
        "| " + " | ".join(["---"] * width) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in escaped[1:])
    if trailing_blank:
        lines.append("")
    return "\n".join(lines)


def element_text(element: ET.Element) -> str:
    """递归获取元素文本,包含 element.text、子元素文本和子元素 tail"""
    parts = []
    if element.text:
        parts.append(element.text)
    for child in element:
        parts.append(element_text(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


# 向后兼容:三个 extractor 原来用的私有函数名
_local_name = local_name
_markdown_table = markdown_table
_element_text = element_text