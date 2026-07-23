"""HTML 文档提取器"""
from __future__ import annotations

import base64
import json
import re
import urllib.request
import urllib.parse
import ipaddress
import socket
from pathlib import Path
from typing import Optional

from .base import BaseExtractor, ExtractionResult
from ._utils import ExtractedMedia, classify_media, format_media_ref, media_filename

MAX_REMOTE_MEDIA_BYTES = 50 * 1024 * 1024


def _extract_meta_content(html: str, name: str) -> Optional[str]:
    pattern = rf'<meta\s+(?:name="{re.escape(name)}"[^>]*content="([^"]*)"|content="([^"]*)"[^>]*name="{re.escape(name)}")'
    match = re.search(pattern, html, re.IGNORECASE)
    if match:
        return match.group(1) or match.group(2)
    return None


def _extract_og_content(html: str, property_name: str) -> Optional[str]:
    pattern = rf'<meta\s+(?:property="{re.escape(property_name)}"[^>]*content="([^"]*)"|content="([^"]*)"[^>]*property="{re.escape(property_name)}")'
    match = re.search(pattern, html, re.IGNORECASE)
    if match:
        return match.group(1) or match.group(2)
    return None


def _extract_title(html: str) -> Optional[str]:
    match = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


def _extract_canonical_url(html: str) -> Optional[str]:
    match = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', html, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def _extract_metadata(html: str) -> dict:
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
    links = []
    pattern = r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>'
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        url = match.group(1)
        text = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        if url and not url.startswith("#") and not url.startswith("javascript:"):
            links.append({"text": text, "url": url})
    return links


def _extract_media_info(html: str) -> list[dict]:
    """提取 HTML 中所有媒体(图/视/音),返回 [{src, kind, alt, tag, poster}]。

    支持 <img src=...>、<video src=...>、<audio src=...>、<video><source src=...></video>、<audio><source src=...></audio>。
    kind 按扩展名/媒体标签判断。
    """
    items: list[dict] = []
    seen_srcs: set[str] = set()

    # <img src=... alt=...>
    for m in re.finditer(
        r'<img\b[^>]*\bsrc=["\']([^"\']+)["\'][^>]*(?:\balt=["\']([^"\']*)["\'])?[^>]*>',
        html,
        re.IGNORECASE,
    ):
        src = m.group(1)
        alt = m.group(2) or ""
        if src in seen_srcs:
            continue
        seen_srcs.add(src)
        ext = Path(urllib.parse.urlparse(src).path).suffix
        items.append({
            "src": src,
            "kind": classify_media(ext) or "image",
            "alt": alt,
            "tag": "img",
            "poster": "",
        })

    # <video src=...> + <video><source src=...></video>(取首个 source)
    for m in re.finditer(
        r'<video\b[^>]*>(.*?)</video>',
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        inner = m.group(1)
        poster = ""
        poster_m = re.search(r'\bposter=["\']([^"\']+)["\']', m.group(0), re.IGNORECASE)
        if poster_m:
            poster = poster_m.group(1)
        # 优先 src,否则找 source
        src_m = re.search(r'<video\b[^>]*\bsrc=["\']([^"\']+)["\']', m.group(0), re.IGNORECASE)
        if not src_m:
            src_m = re.search(r'<source\b[^>]*\bsrc=["\']([^"\']+)["\']', inner, re.IGNORECASE)
        if not src_m:
            continue
        src = src_m.group(1)
        if src in seen_srcs:
            continue
        seen_srcs.add(src)
        ext = Path(urllib.parse.urlparse(src).path).suffix
        kind = classify_media(ext)
        if kind == "other":
            kind = "video"  # video 标签兜底为 video
        items.append({
            "src": src,
            "kind": kind,
            "alt": "",
            "tag": "video",
            "poster": poster,
        })

    # <audio src=...> + <audio><source src=...></audio>
    for m in re.finditer(
        r'<audio\b[^>]*>(.*?)</audio>',
        html,
        re.IGNORECASE | re.DOTALL,
    ):
        inner = m.group(1)
        src_m = re.search(r'<audio\b[^>]*\bsrc=["\']([^"\']+)["\']', m.group(0), re.IGNORECASE)
        if not src_m:
            src_m = re.search(r'<source\b[^>]*\bsrc=["\']([^"\']+)["\']', inner, re.IGNORECASE)
        if not src_m:
            continue
        src = src_m.group(1)
        if src in seen_srcs:
            continue
        seen_srcs.add(src)
        ext = Path(urllib.parse.urlparse(src).path).suffix
        kind = classify_media(ext)
        if kind == "other":
            kind = "audio"  # audio 标签兜底为 audio
        items.append({
            "src": src,
            "kind": kind,
            "alt": "",
            "tag": "audio",
            "poster": "",
        })

    return items


def _extract_headings(html: str) -> list[dict]:
    headings = []
    pattern = r'<(h[1-6])[^>]*>(.*?)</\1>'
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        level = int(match.group(1)[1])
        text = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        if text:
            headings.append({"level": level, "text": text})
    return headings


def _extract_code_blocks(html: str) -> list[dict]:
    code_blocks = []
    pattern = r'<pre[^>]*>\s*<code[^>]*(?:class="([^"]*)")?[^>]*>(.*?)</code>\s*</pre>'
    for match in re.finditer(pattern, html, re.IGNORECASE | re.DOTALL):
        lang = match.group(1) or ""
        code = match.group(2)
        code = code.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", '"')
        code_blocks.append({"language": lang, "code": code.strip()})
    return code_blocks


def _count_words(markdown: str) -> int:
    text = re.sub(r'[#*`_\[\](){}|>!-]', '', markdown)
    text = re.sub(r'\s+', ' ', text)
    return len(text.strip().split())


# 视频/音频常见扩展名(用于 post-process:把 [URL](URL) 还原为 <video>/<audio> 标签)
_VIDEO_EXTS = (".mp4", ".webm", ".ogg", ".mov", ".m4v", ".avi", ".wmv")
_AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac")
_MEDIA_LINK_RE = re.compile(
    r'\[([^\]]*)\]\((https?://[^)\s]+)\)',
    re.IGNORECASE,
)


def _restore_video_audio_tags(markdown: str) -> str:
    """post-process: html-to-markdown 会把 <video src=...> 转成 [URL](URL)。
    本函数扫描 markdown,把以视频/音频扩展名结尾的链接还原为 <video>/<audio> HTML 标签。

    避开代码块(``` / `),避免误伤。
    """
    if not markdown:
        return markdown

    code_blocks: list[str] = []

    def _stash(m):
        idx = len(code_blocks)
        code_blocks.append(m.group(0))
        return f"\x00CODEBLOCK{idx}\x00"

    placeholder_md = re.sub(r'```[\s\S]*?```', _stash, markdown)
    placeholder_md = re.sub(r'`[^`\n]+`', _stash, placeholder_md)

    def _restore(m):
        alt = m.group(1).strip()
        url = m.group(2)
        path_only = urllib.parse.urlparse(url.lower()).path
        # alt 是 URL(或空)时,用文件名(去扩展名)作为 title,避免标记为整个 URL。
        if not alt or alt == url:
            alt = Path(path_only).stem or "media"
        if any(path_only.endswith(ext) for ext in _VIDEO_EXTS):
            title = f' title="{alt}"'
            return f'<video controls src="{url}"{title}></video>'
        if any(path_only.endswith(ext) for ext in _AUDIO_EXTS):
            title = f' title="{alt}"'
            return f'<audio controls src="{url}"{title}></audio>'
        return m.group(0)

    out = _MEDIA_LINK_RE.sub(_restore, placeholder_md)

    def _unstash(m):
        idx = int(m.group(1))
        return code_blocks[idx]
    out = re.sub(r'\x00CODEBLOCK(\d+)\x00', _unstash, out)
    return out


# <video src="URL"> / <audio src="URL"> 整体匹配(用于后续 src 本地化)
_VIDEO_SRC_RE = re.compile(
    r'(<video\b[^>]*\bsrc=")([^"]+)("[^>]*>)',
    re.IGNORECASE,
)
_AUDIO_SRC_RE = re.compile(
    r'(<audio\b[^>]*\bsrc=")([^"]+)("[^>]*>)',
    re.IGNORECASE,
)


def _substitute_media_srcs(markdown: str, url_to_local: dict[str, str]) -> str:
    """把 markdown 里 <video src="URL"> / <audio src="URL"> 的 URL 替换为已下载的本地路径。

    url_to_local: {原 URL: 本地绝对路径}。会同时生成相对引用 {stem}_media/filename。
    """
    if not markdown or not url_to_local:
        return markdown

    def _make_rel(abs_path: str) -> str:
        # 取文件名,只写 {safe_stem}_media/xxx.ext 相对路径
        # (safe_stem 在调用方已确定,这里用文件名即可,因为 markdown 整体相对输出根目录)
        return Path(abs_path).name

    def _sub(m):
        prefix, url, suffix = m.group(1), m.group(2), m.group(3)
        local = url_to_local.get(url)
        if local:
            return f'{prefix}{_make_rel(local)}{suffix}'
        return m.group(0)

    markdown = _VIDEO_SRC_RE.sub(_sub, markdown)
    markdown = _AUDIO_SRC_RE.sub(_sub, markdown)
    return markdown


def _process_base64_media(markdown: str, output_dir: str, stem: str) -> tuple[str, list[ExtractedMedia]]:
    """处理 Markdown 中的 base64 媒体(图片为主,音视频极少)。

    - SVG < 10KB:移除(UI 装饰)
    - SVG >= 10KB:保存为 svg_NNN.svg,按 image 引用
    - PNG/JPEG/GIF/WEBP:保存为 img_NNN.ext,按 image 引用
    - 其他:移除
    """
    saved: list[ExtractedMedia] = []
    images_dir = Path(output_dir) / f"{stem}_media"
    images_dir.mkdir(parents=True, exist_ok=True)

    counters = {"image": 0, "video": 0, "audio": 0, "other": 0}

    def replace_image(match):
        full_match = match.group(0)
        alt_text = match.group(1) or ""
        data_url = match.group(2)

        data_match = re.match(r'data:([^;]+);base64,([A-Za-z0-9+/=]+)', data_url)
        if not data_match:
            return full_match

        mime_type = data_match.group(1)
        base64_data = data_match.group(2)

        try:
            media_bytes = base64.b64decode(base64_data)
        except Exception:
            return full_match

        # 推断 kind
        if 'svg' in mime_type:
            kind = "image"
            ext = ".svg"
        elif 'video' in mime_type:
            kind = "video"
            # mime 子串 → 扩展名。需要覆盖 video/webm、video/ogg、video/quicktime。
            # key 用 mime 子串中的独特字串,确保 'webm' 不会误伤 'image/webp' 等场景。
            ext_map = {
                'webm': '.webm',
                'ogg': '.ogv',
                'quicktime': '.mov',
                'mp4': '.mp4',
            }
            ext = next((v for k, v in ext_map.items() if k in mime_type), '.mp4')
        elif 'audio' in mime_type:
            kind = "audio"
            ext_map = {
                'mpeg': '.mp3',
                'mp3': '.mp3',
                'ogg': '.ogg',
                'wav': '.wav',
                'aac': '.aac',
            }
            ext = next((v for k, v in ext_map.items() if k in mime_type), '.mp3')
        elif 'png' in mime_type:
            kind = "image"
            ext = ".png"
        elif 'jpeg' in mime_type or 'jpg' in mime_type:
            kind = "image"
            ext = ".jpg"
        elif 'gif' in mime_type:
            kind = "image"
            ext = ".gif"
        elif 'webp' in mime_type:
            kind = "image"
            ext = ".webp"
        else:
            return ""

        # 小 SVG 图标移除
        if kind == "image" and ext == ".svg" and len(media_bytes) < 10240:
            return ""

        counters[kind] += 1
        filename = media_filename(kind, counters[kind], ext)
        filepath = images_dir / filename
        try:
            filepath.write_bytes(media_bytes)
        except Exception:
            return full_match

        rel_path = f"{stem}_media/{filename}"
        saved.append(ExtractedMedia(
            local_path=str(filepath),
            original_path=f"data:{mime_type}",
            kind=kind,
            ext=ext,
        ))
        alt = alt_text or f"{kind.title()} {counters[kind]}"
        return format_media_ref(rel_path, kind, alt)

    modified = re.sub(
        r'!\[([^\]]*)\]\((data:[^)]+)\)',
        replace_image,
        markdown,
    )
    modified = re.sub(r'\n{3,}', '\n\n', modified)
    return modified, saved


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

        # post-process:把 html-to-markdown 转出的 [URL](URL) 还原为 <video>/<audio> 标签
        # (原始 URL,等下载后用 _substitute_media_srcs 替换为本地路径)
        result.markdown = _restore_video_audio_tags(result.markdown)

        if source.startswith(("http://", "https://")):
            from urllib.parse import urlparse
            parsed = urlparse(source)
            safe_stem = parsed.netloc.replace(".", "_")
        else:
            safe_stem = re.sub(r'[<>:"/\\|?*]', '_', Path(source).stem)[:50]

        # 处理 base64 媒体(图/音视频)
        if output_dir:
            result.markdown, base64_media = _process_base64_media(
                result.markdown, output_dir, safe_stem
            )
            for m in base64_media:
                result.images.append(m.local_path)

        # 下载远程媒体(图/音视频)
        if include_images and output_dir:
            downloaded = self._download_remote_media(
                html_content, output_dir, safe_stem
            )
            for m in downloaded:
                result.images.append(m.local_path)

            # 把 markdown 中 <video src="URL"> / <audio src="URL"> 的 URL 替换为本地路径
            if downloaded:
                url_to_local = {m.original_path: m.local_path for m in downloaded}
                result.markdown = _substitute_media_srcs(result.markdown, url_to_local)

        if save_json:
            headings = _extract_headings(html_content)
            links = _extract_links(html_content)
            media_info = _extract_media_info(html_content)
            code_blocks = _extract_code_blocks(html_content)

            result.metadata["标题列表"] = headings
            result.metadata["链接列表"] = links
            result.metadata["媒体列表"] = media_info
            result.metadata["代码块"] = code_blocks
            result.metadata["统计"] = {
                "字数": _count_words(result.markdown),
                "标题数": len(headings),
                "链接数": len(links),
                "媒体数": len(media_info),
                "代码块数": len(code_blocks),
            }

        return result

    def _build_frontmatter(self, metadata: dict) -> str:
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
        if source.startswith(("http://", "https://")):
            try:
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

    @staticmethod
    def _is_public_remote_url(url: str) -> bool:
        """仅允许 HTTP(S) 公网地址，阻断本机、私网和保留地址。"""
        try:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
                return False
            host = parsed.hostname
            if host.lower() in {"localhost", "localhost.localdomain"}:
                return False
            addresses = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
            for address in addresses:
                ip = ipaddress.ip_address(address[4][0])
                if not ip.is_global:
                    return False
            return True
        except (ValueError, OSError, socket.gaierror):
            return False

    def _download_remote_media(self, html: str, output_dir: str, stem: str) -> list[ExtractedMedia]:
        """下载远程媒体(图片/视频/音频),按 kind 分别连续编号。

        限制:只下载前 maxRemoteImagesPerHtml 个。防止超多 URL 的页面拉爆磁盘。
        """
        media_items = _extract_media_info(html)
        if not media_items:
            return []

        max_items = self.settings.get("maxRemoteImagesPerHtml", 100)
        if len(media_items) > max_items:
            self.logger.warning(
                "远程媒体超过配置上限",
                found=len(media_items), limit=max_items,
            )

        safe_stem = re.sub(r'[<>:"/\\|?*]', '_', stem)[:50]
        media_dir = Path(output_dir) / f"{safe_stem}_media"
        media_dir.mkdir(parents=True, exist_ok=True)

        downloaded: list[ExtractedMedia] = []
        counters = {"image": 0, "video": 0, "audio": 0, "other": 0}

        for item in media_items[:max_items]:
            url = item["src"]
            if url.startswith("data:") or url.startswith("#") or url.startswith("/"):
                continue
            try:
                if url.startswith("//"):
                    url = "https:" + url

                if not self._is_public_remote_url(url):
                    self.logger.warning("拒绝下载非公网媒体地址", url=url)
                    continue

                ext = self._get_media_ext(url)
                kind = classify_media(ext)
                # 兜底:按 HTML 标签强制分类
                if kind == "other" and item["tag"] in ("video", "audio"):
                    kind = item["tag"]

                counters[kind] += 1
                filename = media_filename(kind, counters[kind], ext)
                filepath = media_dir / filename

                request = urllib.request.Request(
                    url,
                    headers={"User-Agent": "doc-intake/1.0"},
                )
                temp_filepath = filepath.with_name(f".{filepath.name}.download")
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        content_length = response.headers.get("Content-Length")
                        if content_length and int(content_length) > MAX_REMOTE_MEDIA_BYTES:
                            raise ValueError("远程媒体超过 50MB 限制")
                        total = 0
                        with open(temp_filepath, "wb") as output:
                            while True:
                                chunk = response.read(1024 * 1024)
                                if not chunk:
                                    break
                                total += len(chunk)
                                if total > MAX_REMOTE_MEDIA_BYTES:
                                    raise ValueError("远程媒体超过 50MB 限制")
                                output.write(chunk)
                    temp_filepath.replace(filepath)
                finally:
                    temp_filepath.unlink(missing_ok=True)
                downloaded.append(ExtractedMedia(
                    local_path=str(filepath),
                    original_path=url,
                    kind=kind,
                    ext=ext,
                ))
            except Exception as e:
                self.logger.debug("下载远程媒体失败", url=url, error=str(e))
                continue

        return downloaded

    def _get_media_ext(self, url: str) -> str:
        path = urllib.parse.urlparse(url).path.lower()
        # 图 / 视 / 音 都覆盖
        for ext in [
            # image
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp",
            # video
            ".mp4", ".webm", ".mov", ".m4v", ".avi", ".wmv",
            # audio
            ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
        ]:
            if path.endswith(ext):
                return ext
        return ".bin"