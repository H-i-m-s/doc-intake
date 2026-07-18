"""HTML 文档提取器"""
from __future__ import annotations

import base64
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional

from .base import BaseExtractor, ExtractionResult


def _extract_meta_content(html: str, name: str) -> Optional[str]:
    """从 HTML 中提取 meta 标签内容"""
    pattern = rf'<meta\s+(?:name="{re.escape(name)}"[^>]*content="([^"]*)"|content="([^"]*)"[^>]*name="{re.escape(name)}")'
    match = re.search(pattern, html, re.IGNORECASE)
    if match:
        return match.group(1) or match.group(2)
    return None


def _extract_og_content(html: str, property_name: str) -> Optional[str]:
    """从 HTML 中提取 OpenGraph meta 标签内容"""
    pattern = rf'<meta\s+(?:property="{re.escape(property_name)}"[^>]*content="([^"]*)"|content="([^"]*)"[^>]*property="{re.escape(property_name)}")'
    match = re.search(pattern, html, re.IGNORECASE)
    if match:
        return match.group(1) or match.group(2)
    return None


def _extract_title(html: str) -> Optional[str]:
    """从 HTML 中提取 title"""
    match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def _extract_canonical_url(html: str) -> Optional[str]:
    """从 HTML 中提取 canonical URL"""
    match = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', html, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def _extract_metadata(html: str) -> dict:
    """提取 HTML 元数据"""
    metadata = {}
    
    og_title = _extract_og_content(html, "og:title")
    title = _extract_title(html)
    metadata["标题"] = og_title or title or ""
    
    og_desc = _extract_og_content(html, "og:description")
    desc = _extract_meta_content(html, "description")
    metadata["描述"] = og_desc or desc or ""
    
    author = _extract_meta_content(html, "author")
    if author:
        metadata["作者"] = author
    
    keywords = _extract_meta_content(html, "keywords")
    if keywords:
        metadata["关键词"] = keywords
    
    og_image = _extract_og_content(html, "og:image")
    if og_image:
        metadata["封面图"] = og_image
    
    canonical = _extract_canonical_url(html)
    if canonical:
        metadata["原始链接"] = canonical
    
    return metadata


def _extract_links(html: str) -> list[dict]:
    """提取所有链接"""
    links = []
    pattern = r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>'
    
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        url = match.group(1)
        text = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        if url and not url.startswith("#") and not url.startswith("javascript:"):
            links.append({"text": text, "url": url})
    
    return links


def _extract_images(html: str) -> list[dict]:
    """提取所有图片信息"""
    images = []
    pattern = r'<img\s+[^>]*src=["\']([^"\']+)["\'][^>]*(?:alt=["\']([^"\']*)["\'])?[^>]*>'
    
    for match in re.finditer(pattern, html, re.IGNORECASE):
        src = match.group(1)
        alt = match.group(2) or ""
        if src and not src.startswith("data:"):
            images.append({"src": src, "alt": alt})
    
    return images


def _extract_headings(html: str) -> list[dict]:
    """提取所有标题"""
    headings = []
    pattern = r'<(h[1-6])[^>]*>(.*?)</\1>'
    
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        level = int(match.group(1)[1])
        text = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        if text:
            headings.append({"level": level, "text": text})
    
    return headings


def _extract_code_blocks(html: str) -> list[dict]:
    """提取所有代码块"""
    code_blocks = []
    
    pattern = r'<pre[^>]*>\s*<code[^>]*(?:class="([^"]*)")?[^>]*>(.*?)</code>\s*</pre>'
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        lang = match.group(1) or ""
        code = match.group(2)
        code = code.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", '"')
        code_blocks.append({"language": lang, "code": code.strip()})
    
    return code_blocks


def _count_words(markdown: str) -> int:
    """统计字数"""
    text = re.sub(r'[#*`_\[\](){}|>!-]', '', markdown)
    text = re.sub(r'\s+', ' ', text)
    return len(text.strip().split())


def _process_base64_images(markdown: str, output_dir: str, stem: str) -> tuple[str, list[str]]:
    """处理 Markdown 中的 base64 图片（SVG 移除，PNG 保存）"""
    saved_files = []
    images_dir = Path(output_dir) / f"{stem}_images"
    images_dir.mkdir(parents=True, exist_ok=True)
    
    img_counter = 0
    
    def replace_image(match):
        nonlocal img_counter
        full_match = match.group(0)
        alt_text = match.group(1) or ""
        data_url = match.group(2)
        
        # 解析 data URL
        data_match = re.match(r'data:([^;]+);base64,([A-Za-z0-9+/=]+)', data_url)
        if not data_match:
            return full_match
        
        mime_type = data_match.group(1)
        base64_data = data_match.group(2)
        
        try:
            image_bytes = base64.b64decode(base64_data)
            
            # SVG 图标：移除（UI 元素，对内容无意义）
            if 'svg' in mime_type:
                # 检查是否是小图标（< 10KB）
                if len(image_bytes) < 10240:
                    return ""  # 移除小图标
                else:
                    # 大 SVG 保存为文件
                    img_counter += 1
                    filename = f"svg_{img_counter:03d}.svg"
                    filepath = images_dir / filename
                    filepath.write_bytes(image_bytes)
                    saved_files.append(str(filepath))
                    return f"![SVG Image]({stem}_images/{filename})"
            
            # PNG/JPEG/GIF 等：保存为文件
            elif any(t in mime_type for t in ['png', 'jpeg', 'jpg', 'gif', 'webp']):
                ext = '.png'
                if 'jpeg' in mime_type or 'jpg' in mime_type:
                    ext = '.jpg'
                elif 'gif' in mime_type:
                    ext = '.gif'
                elif 'webp' in mime_type:
                    ext = '.webp'
                
                img_counter += 1
                filename = f"img_{img_counter:03d}{ext}"
                filepath = images_dir / filename
                filepath.write_bytes(image_bytes)
                saved_files.append(str(filepath))
                
                alt = alt_text or f"Image {img_counter}"
                return f"![{alt}]({stem}_images/{filename})"
            
            # 其他类型：移除
            else:
                return ""
                
        except Exception:
            return full_match
    
    # 匹配 Markdown 图片语法
    modified_markdown = re.sub(
        r'!\[([^\]]*)\]\((data:[^)]+)\)',
        replace_image,
        markdown
    )
    
    # 清理多余的空行
    modified_markdown = re.sub(r'\n{3,}', '\n\n', modified_markdown)
    
    return modified_markdown, saved_files


class HtmlExtractor(BaseExtractor):
    """HTML 提取器"""

    name = "html"

    def __init__(self, settings: dict):
        super().__init__(settings)
        from logger import get_logger
        self.logger = get_logger("html_extractor")

    def extract(
        self,
        source: str,
        output_dir: str | None = None,
        page_range: str | None = None,
        language: str = "zh",
        include_images: bool = True,
        save_json: bool = False,
        **kwargs,
    ) -> ExtractionResult:
        result = ExtractionResult()
        
        html_content = self._read_html(source)
        if not html_content:
            result.warnings.append("无法读取 HTML 内容")
            result.markdown = "# 错误\n\n无法读取 HTML 内容"
            return result
        
        metadata = _extract_metadata(html_content)
        result.metadata = metadata
        
        try:
            from html_to_markdown import convert, ConversionOptions
            
            options = ConversionOptions(
                heading_style="atx",
                extract_metadata=False,
            )
            
            convert_result = convert(html_content, options)
            
            if hasattr(convert_result, 'content'):
                markdown = convert_result.content
            elif isinstance(convert_result, dict):
                markdown = convert_result.get("content", "")
            elif isinstance(convert_result, str):
                markdown = convert_result
            else:
                markdown = str(convert_result)
            
            frontmatter = self._build_frontmatter(metadata)
            if frontmatter:
                result.markdown = f"{frontmatter}\n\n{markdown}"
            else:
                result.markdown = markdown
                
        except ImportError:
            result.warnings.append("需要安装 html-to-markdown: pip install html-to-markdown")
            result.markdown = "# 错误\n\n需要安装 html-to-markdown: pip install html-to-markdown"
        except Exception as e:
            result.warnings.append(f"转换失败: {str(e)}")
            result.markdown = f"# 错误\n\n{str(e)}"
        
        # 处理 base64 图片
        if output_dir:
            if source.startswith(("http://", "https://")):
                from urllib.parse import urlparse
                parsed = urlparse(source)
                safe_stem = parsed.netloc.replace(".", "_")
            else:
                safe_stem = re.sub(r'[<>:"/\\|?*]', '_', Path(source).stem)[:50]
            
            result.markdown, saved_files = _process_base64_images(
                result.markdown, output_dir, safe_stem
            )
            result.images.extend(saved_files)
        
        if include_images and output_dir:
            downloaded_images = self._download_remote_images(html_content, output_dir, safe_stem if 'safe_stem' in locals() else "html")
            result.images.extend(downloaded_images)
        
        if save_json:
            headings = _extract_headings(html_content)
            links = _extract_links(html_content)
            images_info = _extract_images(html_content)
            code_blocks = _extract_code_blocks(html_content)
            
            result.metadata["标题列表"] = headings
            result.metadata["链接列表"] = links
            result.metadata["图片列表"] = images_info
            result.metadata["代码块"] = code_blocks
            result.metadata["统计"] = {
                "字数": _count_words(result.markdown),
                "标题数": len(headings),
                "链接数": len(links),
                "图片数": len(images_info),
                "代码块数": len(code_blocks),
            }
        
        return result
    
    def _build_frontmatter(self, metadata: dict) -> str:
        """构建 YAML frontmatter"""
        if not metadata:
            return ""
        
        lines = ["---"]
        for key, value in metadata.items():
            if isinstance(value, list):
                lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
            else:
                if any(c in str(value) for c in [":", "#", "{", "}", "[", "]", ",", "&", "*", "?", "|", "-", "<", ">", "=", "!", "%", "@", "`"]):
                    lines.append(f'{key}: "{value}"')
                else:
                    lines.append(f"{key}: {value}")
        lines.append("---")
        
        return "\n".join(lines)
    
    def _read_html(self, source: str) -> Optional[str]:
        """读取 HTML 内容（支持本地文件和 URL）"""
        if source.startswith(("http://", "https://")):
            try:
                # 添加 User-Agent 头以绕过反爬虫
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
                req = urllib.request.Request(source, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as response:
                    content_type = response.headers.get("Content-Type", "")
                    charset = "utf-8"
                    
                    if "charset=" in content_type:
                        charset = content_type.split("charset=")[-1].split(";")[0].strip()
                    
                    return response.read().decode(charset, errors='replace')
            except Exception as e:
                self.logger.error(f"获取 URL 失败: {e}")
                return None
        
        path = Path(source)
        if not path.exists():
            return None
        
        try:
            for encoding in ["utf-8", "gbk", "gb2312", "latin-1"]:
                try:
                    return path.read_text(encoding=encoding)
                except UnicodeDecodeError:
                    continue
            return path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return None
    
    def _download_remote_images(self, html: str, output_dir: str, stem: str) -> list[str]:
        """下载远程图片（非 base64）

        限制：只下载前 maxRemoteImagesPerHtml 张图片。防止超多 URL 的页面拉爆磁盘 / 网络。
        """
        img_pattern = r'<img\s+[^>]*src=["\']([^"\']+)["\'][^>]*>'
        img_urls = re.findall(img_pattern, html, re.IGNORECASE)

        if not img_urls:
            return []

        max_images = self.settings.get("maxRemoteImagesPerHtml", 100)
        if img_urls and len(img_urls) > max_images:
            self.logger.warning(
                "远程图片超过配置上限",
                found=len(img_urls), limit=max_images,
            )

        safe_stem = re.sub(r'[<>:"/\\|?*]', '_', stem)[:50]
        images_dir = Path(output_dir) / f"{safe_stem}_images"
        images_dir.mkdir(parents=True, exist_ok=True)

        extracted = []
        img_counter = 0

        for url in img_urls[:max_images]:
            if url.startswith("data:") or url.startswith("#") or url.startswith("/"):
                continue
            
            try:
                if url.startswith("//"):
                    url = "https:" + url
                
                ext = self._get_image_ext(url)
                img_counter += 1
                filename = f"remote_{img_counter:03d}{ext}"
                filepath = images_dir / filename
                
                urllib.request.urlretrieve(url, str(filepath))
                extracted.append(str(filepath))
                
            except Exception:
                continue
        
        return extracted
    
    def _get_image_ext(self, url: str) -> str:
        """从 URL 推断图片扩展名"""
        path = urllib.parse.urlparse(url).path.lower()
        
        for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"]:
            if path.endswith(ext):
                return ext
        
        return ".png"