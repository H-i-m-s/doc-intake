"""v6 EPUB 提取器自测：六个现场造的样本，跑完删干净。

用法：python test/selftest_v6_epub.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 最小 EPUB2（ncx 目录）：标题、两段正文、两张图引用、mediaMap 可改写成 {stem}_media/
  2. EPUB3（nav 文档）：目录标题取到；没有 h1-h6 的文档补 `##`，有 h1 的不重复加
  3. 字体混淆（encryption.xml 只有 IDPF 算法）→ 正常解析，fontObfuscated 为真
  4. 内容加密（ADEPT）→ 抛错，错误信息带算法与书名
  5. include_images=False → 无图引用、无 media 目录
  6. 引用的图片在包里不存在 → 有 warning、不抛异常、不残留占位符
"""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import zipfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

from extractors.epub_extractor import EpubError, EpubExtractor  # noqa: E402

# 1x1 PNG / 最小 JPEG 字节，够让媒体落盘即可，不追求能看。
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)
_JPEG = bytes.fromhex("ffd8ffd900020000ffd9")

XHTML = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<html xmlns="http://www.w3.org/1999/xhtml">'
    "<head><title>{title}</title></head><body>{body}</body></html>"
)

CONTAINER = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/content.opf" '
    'media-type="application/oebps-package+xml"/></rootfiles></container>'
)


# ── 造样本 ──────────────────────────────────────────────────────────

def make_epub(path: str, files: dict) -> None:
    """按 {zip 内路径: str|bytes} 造一个 epub；mimetype 必须是第一项且不压缩。"""
    with zipfile.ZipFile(path, "w") as zf:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        zf.writestr(info, "application/epub+zip")
        for name, payload in files.items():
            data = payload.encode("utf-8") if isinstance(payload, str) else payload
            zf.writestr(name, data)


def opf(package_version: str, metadata: str, manifest: str, spine: str, spine_attr: str = "") -> str:
    return (
        f'<?xml version="1.0" encoding="utf-8"?>\n'
        f'<package xmlns="http://www.idpf.org/2007/opf" version="{package_version}" '
        f'unique-identifier="uid"{spine_attr}>\n'
        f"<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">{metadata}</metadata>\n"
        f"<manifest>{manifest}</manifest>\n"
        f"<spine>{spine}</spine>\n"
        f"</package>"
    )


def build_epub2(path: str, *, extra_meta: str = "", encryption: str = "") -> None:
    """最小 EPUB2：ncx 目录、两张图（封面页 + 正文）、两段正文。"""
    files = {
        "META-INF/container.xml": CONTAINER,
        "OEBPS/content.opf": opf(
            "2.0",
            '<dc:title>Minimal Book</dc:title>'
            '<dc:creator>First Author</dc:creator>'
            '<dc:creator>Second Author</dc:creator>'
            "<dc:language>en</dc:language>"
            '<meta name="cover" content="cover-img"/>' + extra_meta,
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
            '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>'
            '<item id="pic" href="images/pic.png" media-type="image/png"/>'
            '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="notes" href="text/notes.xhtml" media-type="application/xhtml+xml"/>',
            '<itemref idref="cover"/>'
            '<itemref idref="ch1"/>'
            '<itemref idref="notes" linear="no"/>',
            ' toc="ncx"',
        ),
        "OEBPS/toc.ncx": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
            '<navPoint id="n1"><navLabel><text>Cover</text></navLabel>'
            '<content src="text/cover.xhtml"/></navPoint>'
            '<navPoint id="n2"><navLabel><text>第一章</text></navLabel>'
            '<content src="text/ch1.xhtml"/></navPoint>'
            "</navMap></ncx>"
        ),
        "OEBPS/text/cover.xhtml": XHTML.format(
            title="Cover",
            body='<div><img src="../images/cover.jpg" alt="Cover"/></div>',
        ),
        "OEBPS/text/ch1.xhtml": XHTML.format(
            title="Chapter One",
            body="<h1>Chapter One</h1><p>First paragraph.</p><p>Second paragraph.</p>"
            '<p><img src="../images/pic.png" alt="Diagram"/></p>'
            '<p><a href="#note1">1</a> tail text</p>',
        ),
        # linear="no" 的辅助文档不该进正文，但它的标题留给目录用
        "OEBPS/text/notes.xhtml": XHTML.format(
            title="Notes", body='<p id="note1"><a href="#n1">#n1</a> note body</p>'
        ),
        "OEBPS/images/cover.jpg": _JPEG,
        "OEBPS/images/pic.png": _PNG,
    }
    if encryption:
        files["META-INF/encryption.xml"] = encryption
    make_epub(path, files)


def build_epub3(path: str) -> None:
    """EPUB3：nav 文档给标题；一章有 h1，一章没有。"""
    make_epub(path, {
        "META-INF/container.xml": CONTAINER,
        "OEBPS/content.opf": opf(
            "3.0",
            "<dc:title>Three Point Oh</dc:title><dc:creator>Someone</dc:creator>"
            "<dc:language>zh</dc:language>",
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
            '<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>'
            '<item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>',
            '<itemref idref="ch1"/><itemref idref="ch2"/>',
        ),
        "OEBPS/nav.xhtml": (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" '
            'xmlns:epub="http://www.idpf.org/2007/ops"><body>'
            '<nav epub:type="toc"><ol>'
            '<li><a href="text/ch1.xhtml">封面章节</a></li>'
            '<li><a href="text/ch2.xhtml">无标题章节</a></li>'
            "</ol></nav></body></html>"
        ),
        "OEBPS/text/ch1.xhtml": XHTML.format(
            title="ch1", body="<h2>正文自带标题</h2><p>alpha</p>"
        ),
        "OEBPS/text/ch2.xhtml": XHTML.format(title="ch2", body="<p>beta</p>"),
    })


def encryption_xml(algorithm: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" '
        'xmlns:enc="http://www.w3.org/2001/04/xmlenc#">'
        "<enc:EncryptedData><enc:EncryptionMethod "
        f'Algorithm="{algorithm}"/></enc:EncryptedData></encryption>'
    )


# ── 断言小工具 ──────────────────────────────────────────────────────

class Checker:
    def __init__(self) -> None:
        self.failed = 0
        self.passed = 0

    def ok(self, condition: bool, label: str, detail: str = "") -> bool:
        if condition:
            self.passed += 1
            print("  ✓ %s" % label)
        else:
            self.failed += 1
            print("  ✗ %s%s" % (label, ("｜" + detail) if detail else ""))
        return condition

    def summary(self) -> int:
        print()
        print("通过 %d 项，失败 %d 项" % (self.passed, self.failed))
        return 0 if self.failed == 0 else 1


def rewrite_like_save_result(markdown: str, media_map: dict, stem: str) -> str:
    """照 main.py 的 save_result 重写媒体引用：占位符 -> {stem}_media/文件名。

    规则与那边一字不差：`](占位符)` 与 `src="占位符"` 两处替换。
    """
    for placeholder, info in media_map.items():
        local_name = os.path.basename(info["local_path"])
        escaped = re.escape(placeholder)
        markdown = re.sub(rf'\]\(\s*{escaped}(?:\s+["\'][^"\']*["\'])?\s*\)',
                          f"]({stem}_media/{local_name})", markdown)
        markdown = re.sub(rf'src="{escaped}"', f'src="{stem}_media/{local_name}"', markdown)
    return markdown


def make_title_with_space(epub_path: str, out_dir: str) -> str:
    return ""


def image_refs(markdown: str) -> list[str]:
    return re.findall(r"!\[[^\]]*\]\(([^)]*)\)", markdown)


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-epub-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ── 六个场景 ────────────────────────────────────────────────────────

def case_epub2(root: str) -> Checker:
    """EPUB2 + ncx：标题、正文、两张图、占位符可改写成 {stem}_media/。"""
    check = Checker()
    print()
    print("── 1. 最小 EPUB2（ncx 目录）──")
    epub_path = os.path.join(root, "minimal.epub")
    out_dir = os.path.join(root, "out2")
    build_epub2(epub_path)

    result = EpubExtractor({}).extract(epub_path, output_dir=out_dir)

    check.ok(result.markdown.startswith("# Minimal Book"), "首行是 `# 书名`")
    check.ok("First paragraph." in result.markdown and "Second paragraph." in result.markdown,
             "两段正文都在")
    check.ok(len(image_refs(result.markdown)) == 2, "正文里有两条图引用",
             "实际 %d 条" % len(image_refs(result.markdown)))
    check.ok("note body" not in result.markdown, 'linear="no" 的章节没进正文')
    # 脚注锚点只留文字，正文里不该出现裸露的 #note1
    check.ok("#note1" not in result.markdown, "脚注锚点没留下裸 #note1")
    check.ok("docintake-media-" in result.markdown, "转换后仍是占位符（改写交给 save_result）")

    stem = os.path.splitext(os.path.basename(epub_path))[0]
    rewritten = rewrite_like_save_result(result.markdown, result.metadata["mediaMap"], stem)
    check.ok("docintake-media-" not in rewritten, "mediaMap 改写过之后不剩占位符")
    check.ok(all(ref.startswith(f"{stem}_media/") for ref in image_refs(rewritten)),
             "图引用都变成 {stem}_media/xxx.ext", str(image_refs(rewritten)))
    media_dir = os.path.join(out_dir, f"{stem}_media")
    on_disk = sorted(os.listdir(media_dir)) if os.path.isdir(media_dir) else []
    check.ok(len(on_disk) == 2, "图片真的落盘（2 个文件）", str(on_disk))
    check.ok(all(os.path.basename(ref) in on_disk for ref in image_refs(rewritten)),
             "落盘文件名和引用对得上")
    check.ok(result.metadata.get("author") == "First Author、Second Author",
             "多个 dc:creator 全收", str(result.metadata.get("author")))
    return check


def case_epub3(root: str) -> Checker:
    """EPUB3 + nav：目录标题取到，只给没有 h1-h6 的章节补 ##。"""
    check = Checker()
    print()
    print("── 2. EPUB3（nav 文档）──")
    epub_path = os.path.join(root, "v3.epub")
    build_epub3(epub_path)
    result = EpubExtractor({}).extract(epub_path, output_dir=None)

    check.ok("## 正文自带标题" in result.markdown, "有 h1-h6 的章节保留正文标题")
    check.ok("## 封面章节" not in result.markdown, "有 h1-h6 的章节没被重复补目录标题")
    check.ok("## 无标题章节" in result.markdown, "没有 h1-h6 的章节补了目录标题")
    check.ok(result.markdown.count("无标题章节") == 1, "补的标题只出现一次")
    check.ok(result.metadata.get("epubVersion") == "3.0", "epubVersion 读到 3.0")
    check.ok(result.metadata.get("chapterCount") == 2, "chapterCount 按 spine 计",
             str(result.metadata.get("chapterCount")))
    return check


def case_font_obfuscation(root: str) -> Checker:
    """字体混淆不是 DRM：照常解析，只记 fontObfuscated。"""
    check = Checker()
    print()
    print("── 3. 字体混淆（IDPF 算法）──")
    epub_path = os.path.join(root, "obfuscated.epub")
    build_epub2(epub_path, encryption=encryption_xml("http://www.idpf.org/2008/embedding"))
    result = EpubExtractor({}).extract(epub_path, output_dir=None)

    check.ok("First paragraph." in result.markdown, "正文正常解析")
    check.ok(result.metadata.get("fontObfuscated") is True, "metadata.fontObfuscated 为真")
    check.ok(not any("DRM" in warning for warning in result.warnings), "没有当成 DRM 报错")
    return check


def case_drm(root: str) -> Checker:
    """内容加密：必须明确失败，错误信息带算法和书名。"""
    check = Checker()
    print()
    print("── 4. 内容加密（ADEPT）──")
    epub_path = os.path.join(root, "drm.epub")
    build_epub2(epub_path, encryption=encryption_xml("http://ns.adobe.com/adept"))

    message = ""
    try:
        EpubExtractor({}).extract(epub_path, output_dir=None)
    except EpubError as exc:
        message = str(exc)
    except Exception as exc:  # 抛了别的类型也算不合格：上层就只会看到 traceback 文字
        message = ""

    check.ok(bool(message), "抛出了 EpubError（不是裸异常）")
    check.ok("DRM" in message, "错误信息说了 DRM", message)
    check.ok("http://ns.adobe.com/adept" in message, "错误信息带算法", message)
    check.ok("Minimal Book" in message, "错误信息带书名", message)
    return check


def case_no_images(root: str) -> Checker:
    """include_images=False：不写盘、不引用。"""
    check = Checker()
    print()
    print("── 5. include_images=False ──")
    epub_path = os.path.join(root, "noimg.epub")
    out_dir = os.path.join(root, "out_noimg")
    build_epub2(epub_path)
    result = EpubExtractor({}).extract(epub_path, output_dir=out_dir, include_images=False)

    stem = os.path.splitext(os.path.basename(epub_path))[0]
    check.ok(not image_refs(result.markdown), "正文里没有图引用", str(image_refs(result.markdown)))
    check.ok(not os.path.isdir(os.path.join(out_dir, f"{stem}_media")), "没建 media 目录")
    check.ok(not result.images, "result.images 为空")
    check.ok(result.metadata.get("mediaMap") == {}, "mediaMap 为空")
    check.ok("First paragraph." in result.markdown, "正文照常输出")
    return check


def case_missing_image(root: str) -> Checker:
    """引用的图片不在包里：warning + 继续，不抛异常，不留占位符。"""
    check = Checker()
    print()
    print("── 6. 图片在包里缺失 ──")
    epub_path = os.path.join(root, "missing.epub")
    out_dir = os.path.join(root, "out_missing")
    build_epub2(epub_path)

    # 把 pic.png 抽掉，但正文仍然引用它
    stripped = os.path.join(root, "stripped.epub")
    with zipfile.ZipFile(epub_path) as src, zipfile.ZipFile(stripped, "w") as dst:
        for item in src.infolist():
            if item.filename == "OEBPS/images/pic.png":
                continue
            dst.writestr(item, src.read(item.filename))

    result = EpubExtractor({}).extract(stripped, output_dir=out_dir)

    check.ok("First paragraph." in result.markdown, "缺图不影响正文")
    check.ok(any("pic.png" in warning for warning in result.warnings),
             "warning 里写了缺哪个路径", str(result.warnings))
    # 留下的占位符必须都是 mediaMap 里有下落的，缺图的那个不能漏到正文里
    leftovers = [
        placeholder for placeholder in re.findall(r"docintake-media-\d+", result.markdown)
        if placeholder not in result.metadata["mediaMap"]
    ]
    check.ok(not leftovers, "正文里没残留无下落的占位符", str(leftovers))
    check.ok(len(image_refs(result.markdown)) == 1, "只剩封面那一条图引用",
             str(image_refs(result.markdown)))
    return check


def self_test() -> int:
    print("EPUB 提取器自测（现场造样本）")

    def run(root: str) -> int:
        total = Checker()
        for case in (case_epub2, case_epub3, case_font_obfuscation,
                     case_drm, case_no_images, case_missing_image):
            check = case(root)
            total.passed += check.passed
            total.failed += check.failed
        return total.summary()

    return with_temp(run)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")

    if "--selftest" in sys.argv:
        sys.exit(0 if self_test() in (0, 2) else 1)

    print(__doc__)
    print("用法：python test/selftest_v6_epub.py")
