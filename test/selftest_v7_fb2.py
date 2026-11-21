"""v7 FB2/FBZ 提取器自测：九个现场造的样本，跑完删干净。

用法：python test/selftest_v7_fb2.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 基本：书名、作者、两章、嵌套 section 的标题级别（## / ### / ####）、段落顺序
  2. 诗体 + 引文：`<poem>` 每行独立成行、stanza 之间空行；`<cite>` 变引用块
  3. 注释 body：正文里 `[1]` 保留，文末出现 `## 注释`，注释内容在
  4. base64 图片：解出来的字节与原文一致、扩展名按 content-type、引用改写成 {stem}_media/
  5. 封面：正文没引用也被落盘，且不进 mediaMap
  6. `.fbz`（zip 包）：结果与裸 `.fb2` 一致
  7. `windows-1251` 编码：解码正确
  8. 引用了不存在的 binary：有 warning、不抛异常、不残留占位符
  9. include_images=False：无引用、无 media 目录
 10. 坏 XML：抛 Fb2Error（人话错误，不是裸异常）
"""

from __future__ import annotations

import base64
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

from extractors.fb2_extractor import Fb2Error, Fb2Extractor  # noqa: E402

# 1x1 PNG / 最小 JPEG 字节，够让媒体落盘即可，不追求能看。
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)
_JPEG = bytes.fromhex("ffd8ffd900020000ffd9")

_NS = ' xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"'
_NS_LINK_ONLY = ' xmlns:l="http://www.w3.org/1999/xlink"'


# ── 造样本 ──────────────────────────────────────────────────────────

def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def title_info(
    title: str,
    *,
    authors: tuple = (("First", "", "Last"),),
    lang: str = "en",
    annotation: str = "",
    cover: str = "",
) -> str:
    parts = []
    for first, middle, last in authors:
        fields = "".join(
            f"<{name}>{value}</{name}>"
            for name, value in (("first-name", first), ("middle-name", middle), ("last-name", last))
            if value
        )
        parts.append(f"<author>{fields}</author>")
    parts.append(f"<book-title>{title}</book-title>")
    if annotation:
        parts.append(f"<annotation><p>{annotation}</p></annotation>")
    if cover:
        parts.append(f'<coverpage><image l:href="#{cover}"/></coverpage>')
    parts.append(f"<lang>{lang}</lang>")
    return "".join(parts)


def fb2_document(
    title_block: str,
    bodies: str,
    binaries: str = "",
    *,
    namespace: bool = True,
    encoding: str = "utf-8",
) -> str:
    ns = _NS if namespace else _NS_LINK_ONLY
    return (
        f'<?xml version="1.0" encoding="{encoding}"?>\n'
        f"<FictionBook{ns}><description><title-info>{title_block}</title-info></description>"
        f"{bodies}{binaries}</FictionBook>"
    )


def write_bytes(path: str, payload: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(payload)


MAIN_BODIES = (
    "<body>"
    "<title><p>Probe Book</p><p>A Subtitle Line</p></title>"
    "<section><title><p>Chapter One</p></title>"
    "<p>First paragraph.</p>"
    "<p>Second paragraph with <emphasis>italic</emphasis> and <strong>bold</strong>.</p>"
    '<p>See <a l:href="#n1" type="note">[1]</a> for the note.</p>'
    "<section><title><p>Nested Section</p></title><p>Nested paragraph.</p>"
    "<section><title><p>Deeper Section</p></title><p>Deeper paragraph.</p></section>"
    "</section>"
    "</section>"
    "<section><title><p>Chapter Two</p></title>"
    "<poem><title><p>Poem Title</p></title>"
    "<stanza><v>line one</v><v>line two</v></stanza>"
    "<stanza><v>second stanza line</v></stanza>"
    "<text-author>Anon</text-author></poem>"
    "<cite><p>Quoted first.</p><p>Quoted second.</p><text-author>Someone</text-author></cite>"
    '<image l:href="#pic.png"/>'
    "</section>"
    "</body>"
    '<body name="notes"><title><p>注释</p></title>'
    '<section id="n1"><title><p>1</p></title><p>Note body text.</p></section></body>'
)

MAIN_BINARIES = (
    f'<binary id="pic.png" content-type="image/png">{b64(_PNG)}</binary>'
    f'<binary id="cover.jpg" content-type="image/jpeg">{b64(_JPEG)}</binary>'
)


def build_main_book(path: str, *, namespace: bool = True) -> None:
    """主样本：两章、三层 section、诗、引文、注释 body、一张正文图 + 一张封面。"""
    document = fb2_document(
        title_info("Probe Book", authors=(("First", "", "Last"),), annotation="Short blurb.",
                   cover="cover.jpg"),
        MAIN_BODIES,
        MAIN_BINARIES,
        namespace=namespace,
    )
    write_bytes(path, document.encode("utf-8"))


def build_fbz(path: str, inner_name: str = "book.fb2") -> None:
    """FBZ：zip 里装一份 fb2。"""
    fb2_bytes = fb2_document(
        title_info("Probe Book", authors=(("First", "", "Last"),), annotation="Short blurb.",
                   cover="cover.jpg"),
        MAIN_BODIES,
        MAIN_BINARIES,
    ).encode("utf-8")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(inner_name, fb2_bytes)


def build_cp1251(path: str) -> None:
    """俄语圈常见编码：windows-1251。"""
    document = fb2_document(
        title_info("Тестовая книга", authors=(("Иван", "", "Петров"),), lang="ru"),
        "<body><section><title><p>Первая глава</p></title>"
        "<p>Это текст в кодировке windows-1251.</p></section></body>",
        encoding="windows-1251",
    )
    write_bytes(path, document.encode("windows-1251"))


def build_missing_binary(path: str) -> None:
    document = fb2_document(
        title_info("Missing Picture"),
        '<body><section><title><p>Only Chapter</p></title>'
        "<p>Text before the picture.</p>"
        '<image l:href="#ghost.png"/>'
        "<p>Text after the picture.</p></section></body>",
    )
    write_bytes(path, document.encode("utf-8"))


def build_broken(path: str) -> None:
    write_bytes(path, b"<FictionBook><body><section><p>unclosed\n")


def build_no_namespace(path: str) -> None:
    build_main_book(path, namespace=False)


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


def image_refs(markdown: str) -> list[str]:
    return re.findall(r"!\[[^\]]*\]\(([^)]*)\)", markdown)


def lines_of(markdown: str) -> list[str]:
    return [line.rstrip() for line in markdown.splitlines()]


def media_files(out_dir: str, stem: str) -> list[str]:
    media_dir = os.path.join(out_dir, f"{stem}_media")
    return sorted(os.listdir(media_dir)) if os.path.isdir(media_dir) else []


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-fb2-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ── 十个场景 ────────────────────────────────────────────────────────

def case_basic(root: str) -> Checker:
    """书名、作者、章节标题级别、段落顺序。"""
    check = Checker()
    print()
    print("── 1. 基本结构（两章 + 三层 section）──")
    source = os.path.join(root, "basic.fb2")
    build_main_book(source)
    result = Fb2Extractor({}).extract(source, output_dir=None)
    markdown = result.markdown

    check.ok(markdown.startswith("# Probe Book"), "首行是 `# 书名`")
    check.ok("*A Subtitle Line*" in markdown, "书名页 title 的第二段变成一行斜体")
    check.ok(result.metadata.get("author") == "First Last", "作者名拼出来了",
             str(result.metadata.get("author")))
    check.ok(result.metadata.get("language") == "en", "lang 读到")
    check.ok(result.metadata.get("sectionCount") == 2, "顶层 section 数是 2",
             str(result.metadata.get("sectionCount")))
    check.ok("## Chapter One" in markdown, "顶层 section 是 `##`")
    check.ok("### Nested Section" in markdown, "第二层 section 是 `###`")
    check.ok("#### Deeper Section" in markdown, "第三层 section 是 `####`")

    positions = [
        markdown.find("First paragraph."),
        markdown.find("Second paragraph with"),
        markdown.find("Nested paragraph."),
        markdown.find("Deeper paragraph."),
    ]
    check.ok(all(pos >= 0 for pos in positions) and positions == sorted(positions),
             "段落顺序与原文一致", str(positions))
    check.ok("**bold**" in markdown and "*italic*" in markdown, "行内加粗 / 斜体转换了")
    check.ok("Short blurb." in markdown, "annotation 放在正文前")
    check.ok(markdown.find("Short blurb.") < markdown.find("## Chapter One"),
             "annotation 在第一章之前")
    check.ok("#n1" not in markdown, "脚注锚点没留下裸 #n1")
    check.ok("base64" not in markdown, "正文里没有 base64")
    check.ok(result.warnings == [], "没有 warning", str(result.warnings))
    return check


def case_poem_and_cite(root: str) -> Checker:
    """诗体每行独立成行、stanza 之间空行；引文变引用块。"""
    check = Checker()
    print()
    print("── 2. 诗体 + 引文 ──")
    source = os.path.join(root, "poem.fb2")
    build_main_book(source)
    markdown = Fb2Extractor({}).extract(source, output_dir=None).markdown
    lines = lines_of(markdown)

    check.ok("line one" in lines and "line two" in lines, "诗行各自成了独立的一行",
             str([line for line in lines if line.startswith("line")]))
    first = lines.index("line one")
    check.ok(lines[first + 1] == "line two", "同一 stanza 的两行紧挨着", str(lines[first:first + 2]))
    check.ok(lines[first + 2] == "", "stanza 之间空行")
    check.ok(lines[first + 3] == "second stanza line", "第二个 stanza 跟在空行之后",
             str(lines[first:first + 4]))
    check.ok(any(line.startswith("> Quoted first.") for line in lines), "cite 的第一段是引用块")
    check.ok(any(line.startswith("> Quoted second.") for line in lines), "cite 的第二段是引用块")
    check.ok(any("Someone" in line for line in lines), "引文署名还在")
    check.ok("**Poem Title**" in markdown, "诗的 title 输出成一行加粗")
    check.ok(any("Anon" in line for line in lines), "诗的署名还在")
    return check


def case_notes(root: str) -> Checker:
    """注释 body 挪到最后，`[1]` 保留。"""
    check = Checker()
    print()
    print("── 3. 注释 body ──")
    source = os.path.join(root, "notes.fb2")
    build_main_book(source)
    markdown = Fb2Extractor({}).extract(source, output_dir=None).markdown

    check.ok("[1]" in markdown, "正文里的 [1] 还在")
    check.ok("## 注释" in markdown, "文末有 `## 注释`")
    check.ok(markdown.find("## 注释") > markdown.find("## Chapter Two"), "注释在正文最后")
    check.ok(markdown.rstrip().endswith("Note body text."), "注释内容在全文末尾",
             repr(markdown[-40:]))
    check.ok("### 1" in markdown, "注释 section 的 title 降一级输出")
    check.ok(markdown.count("## 注释") == 1, "`## 注释` 只出现一次")
    return check


def case_image(root: str) -> Checker:
    """base64 图片：字节一致、扩展名按 content-type、引用改写成 {stem}_media/。"""
    check = Checker()
    print()
    print("── 4. base64 图片 ──")
    source = os.path.join(root, "picture.fb2")
    out_dir = os.path.join(root, "out_picture")
    build_main_book(source)
    result = Fb2Extractor({}).extract(source, output_dir=out_dir)
    stem = os.path.splitext(os.path.basename(source))[0]

    refs = image_refs(result.markdown)
    check.ok(len(refs) == 1, "正文里只有一条图片引用（封面的不算）", str(refs))
    check.ok(refs and refs[0].startswith("docintake-media-"),
             "转换后是占位符（改写交给 save_result）", str(refs))

    rewritten = rewrite_like_save_result(result.markdown, result.metadata["mediaMap"], stem)
    check.ok("docintake-media-" not in rewritten, "mediaMap 改写过之后不剩占位符")
    check.ok(all(ref.startswith(f"{stem}_media/") for ref in image_refs(rewritten)),
             "图引用变成 {stem}_media/xxx.ext", str(image_refs(rewritten)))
    check.ok("#pic.png" not in rewritten, "正文里没有残留 #pic.png")

    on_disk = media_files(out_dir, stem)
    check.ok(on_disk == ["image_001.png", "image_002.jpg"], "落盘两张：1 张正文图 + 1 张封面",
             str(on_disk))
    body_png = os.path.join(out_dir, f"{stem}_media", "image_001.png")
    check.ok(os.path.getsize(body_png) == len(_PNG), "正文图的字节数与原文一致",
             f"{os.path.getsize(body_png)} vs {len(_PNG)}")
    check.ok(os.path.basename(image_refs(rewritten)[0]) == "image_001.png",
             "引用指向的就是那张 png")
    return check


def case_cover(root: str) -> Checker:
    """封面正文没引用也要落盘，但不占正文引用、不进 mediaMap。"""
    check = Checker()
    print()
    print("── 5. 封面 ──")
    source = os.path.join(root, "cover.fb2")
    out_dir = os.path.join(root, "out_cover")
    build_main_book(source)
    result = Fb2Extractor({}).extract(source, output_dir=out_dir)
    stem = os.path.splitext(os.path.basename(source))[0]

    on_disk = media_files(out_dir, stem)
    check.ok("image_002.jpg" in on_disk, "封面落盘了", str(on_disk))
    cover_path = os.path.join(out_dir, f"{stem}_media", "image_002.jpg")
    check.ok(os.path.exists(cover_path) and os.path.getsize(cover_path) == len(_JPEG),
             "封面字节数与原文一致")
    check.ok("image_002" not in result.markdown, "正文里没有多出封面引用")
    check.ok(len(result.metadata["mediaMap"]) == 1, "封面不进 mediaMap",
             str(list(result.metadata["mediaMap"])))
    check.ok(len(result.images) == 2, "result.images 里连封面一起算", str(result.images))
    return check


def case_fbz(root: str) -> Checker:
    """FBZ：zip 里装一份 fb2，结果与裸 fb2 一致。"""
    check = Checker()
    print()
    print("── 6. .fbz（zip 包）──")
    bare = os.path.join(root, "bare.fb2")
    packed = os.path.join(root, "packed.fbz")
    build_main_book(bare)
    build_fbz(packed)

    bare_result = Fb2Extractor({}).extract(bare, output_dir=None)
    packed_result = Fb2Extractor({}).extract(packed, output_dir=None)

    check.ok(packed_result.markdown == bare_result.markdown, "markdown 与裸 fb2 一字不差")
    check.ok(packed_result.metadata.get("title") == "Probe Book", "书名读到了")
    check.ok(packed_result.metadata.get("format") == "fb2", "format 是 fb2")
    check.ok(len(packed_result.metadata.get("mediaMap") or {}) == 1, "图片照样登记了")
    return check


def case_cp1251(root: str) -> Checker:
    """windows-1251：按声明解出来。"""
    check = Checker()
    print()
    print("── 7. windows-1251 编码 ──")
    source = os.path.join(root, "cp1251.fb2")
    build_cp1251(source)
    result = Fb2Extractor({}).extract(source, output_dir=None)

    check.ok("Тестовая книга" in result.markdown, "书名解对了", result.markdown.splitlines()[:1])
    check.ok("Первая глава" in result.markdown, "章节标题解对了")
    check.ok("Это текст в кодировке windows-1251." in result.markdown, "正文解对了")
    check.ok(result.metadata.get("author") == "Иван Петров", "作者名解对了",
             str(result.metadata.get("author")))
    check.ok(not result.warnings, "解码没有留 warning", str(result.warnings))
    return check


def case_missing_binary(root: str) -> Checker:
    """引用了不存在的 binary：warning + 继续，不抛异常，不留占位符。"""
    check = Checker()
    print()
    print("── 8. 引用了不存在的 binary ──")
    source = os.path.join(root, "missing.fb2")
    out_dir = os.path.join(root, "out_missing")
    build_missing_binary(source)
    result = Fb2Extractor({}).extract(source, output_dir=out_dir)
    stem = os.path.splitext(os.path.basename(source))[0]

    check.ok("Text before the picture." in result.markdown, "缺图不影响正文")
    check.ok(any("ghost.png" in warning for warning in result.warnings),
             "warning 里写了缺哪个 id", str(result.warnings))
    check.ok(any("Only Chapter" in warning for warning in result.warnings),
             "warning 里写了在哪一节（定位靠它）", str(result.warnings))
    check.ok(not image_refs(result.markdown), "图引用被清掉了", str(image_refs(result.markdown)))
    check.ok("docintake-media-" not in result.markdown, "没有残留的占位符")
    check.ok(not media_files(out_dir, stem), "没建出空 media 目录")
    return check


def case_no_images(root: str) -> Checker:
    """include_images=False：不写盘、不引用。"""
    check = Checker()
    print()
    print("── 9. include_images=False ──")
    source = os.path.join(root, "noimg.fb2")
    out_dir = os.path.join(root, "out_noimg")
    build_main_book(source)
    result = Fb2Extractor({}).extract(source, output_dir=out_dir, include_images=False)
    stem = os.path.splitext(os.path.basename(source))[0]

    check.ok(not image_refs(result.markdown), "正文里没有图引用",
             str(image_refs(result.markdown)))
    check.ok(not os.path.isdir(os.path.join(out_dir, f"{stem}_media")), "没建 media 目录")
    check.ok(not result.images, "result.images 为空")
    check.ok(result.metadata.get("mediaMap") == {}, "mediaMap 为空")
    check.ok("First paragraph." in result.markdown, "正文照常输出")
    check.ok(not result.warnings, "没有 warning", str(result.warnings))
    return check


def case_broken_xml(root: str) -> Checker:
    """坏 XML：抛 Fb2Error，信息是人话。"""
    check = Checker()
    print()
    print("── 10. 坏 XML ──")
    source = os.path.join(root, "broken.fb2")
    build_broken(source)

    message = ""
    try:
        Fb2Extractor({}).extract(source, output_dir=None)
    except Fb2Error as exc:
        message = str(exc)
    except Exception:  # 抛了别的类型也算不合格：上层只会看到 traceback 文字
        message = ""

    check.ok(bool(message), "抛出了 Fb2Error（不是裸异常）")
    check.ok("FB2" in message, "错误信息说了 FB2", message)
    check.ok("行" in message, "错误信息带位置", message)
    return check


def case_no_namespace(root: str) -> Checker:
    """不带命名空间的 FB2 也要读得出来（按本地名匹配元素）。"""
    check = Checker()
    print()
    print("── 11. 不带命名空间 ──")
    source = os.path.join(root, "nons.fb2")
    build_no_namespace(source)
    result = Fb2Extractor({}).extract(source, output_dir=None)
    check.ok("## Chapter One" in result.markdown, "章节标题读到了")
    check.ok(result.metadata.get("title") == "Probe Book", "书名读到了")
    check.ok(len(image_refs(result.markdown)) == 1, "l:href 图片引用读到了")
    return check


def self_test() -> int:
    print("FB2/FBZ 提取器自测（现场造样本）")

    def run(root: str) -> int:
        total = Checker()
        for case in (case_basic, case_poem_and_cite, case_notes, case_image, case_cover,
                     case_fbz, case_cp1251, case_missing_binary, case_no_images,
                     case_broken_xml, case_no_namespace):
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
    print("用法：python test/selftest_v7_fb2.py")
