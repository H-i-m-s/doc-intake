"""v8 CBZ 提取器自测：八个现场造的样本，跑完删干净。

用法：python test/selftest_v8_cbz.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. 自然排序：`page1` / `page2` / `page10` 的顺序是 1、2、10，落盘是 image_001..003，
     且每个文件的内容与对应页一致（只验顺序不验对应关系等于没验）
  2. 打包垃圾：`__MACOSX/`、`._xxx`、`Thumbs.db`、`ComicInfo.xml` 都不当页
  3. 子目录里的页：`ch01/`、`ch02/` 按目录自然序在前，同级按文件名，落盘不互相覆盖
  4. ComicInfo.xml 进 metadata 与正文；没有 ComicInfo 时书名回落到文件名
  5. PageCount 与实际页数不一致 -> 有 warning，页数按实际图片数
  6. include_images=False：无引用、无 media 目录、mediaMap 为空
  7. 空包 / 全非图片 / 不是 zip -> 抛 CbzError，信息是人话
  8. 0 字节图片 -> warning + 跳过该页（其余页照常出）
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

from extractors.cbz_extractor import CbzError, CbzExtractor  # noqa: E402

# 1x1 PNG。够让媒体落盘即可，不追求能看。
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)


def page_bytes(tag: str) -> bytes:
    """给每页一份可辨认的字节：落盘后按内容就能反推它是哪一页。"""
    return _PNG + tag.encode("utf-8")


# ── 造样本 ──────────────────────────────────────────────────────────

def build_cbz(path: str, entries: list[tuple[str, bytes]]) -> None:
    """按给定顺序把条目写进 zip，不排序（顺序本身也是被测的对象之一）。"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, payload in entries:
            zf.writestr(name, payload)


def comic_info(title: str = "", series: str = "", number: str = "", volume: str = "",
               writer: str = "", publisher: str = "", year: str = "",
               summary: str = "", page_count: str = "") -> bytes:
    fields = (
        ("Title", title), ("Series", series), ("Number", number), ("Volume", volume),
        ("Writer", writer), ("Publisher", publisher), ("Year", year),
        ("Summary", summary), ("PageCount", page_count),
    )
    body = "".join(
        f"  <{name}>{value}</{name}>\n" for name, value in fields if value != ""
    )
    return (
        '<?xml version="1.0"?>\n'
        '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
        f"{body}</ComicInfo>\n"
    ).encode("utf-8")


def build_natural(path: str) -> None:
    """三页：page1 / page2 / page10，故意按 10、1、2 的写入顺序塞进去。"""
    build_cbz(path, [
        ("page10.jpg", page_bytes("page10")),
        ("page1.jpg", page_bytes("page1")),
        ("page2.jpg", page_bytes("page2")),
    ])


def build_noise(path: str) -> None:
    """一页真图 + 一堆打包垃圾。"""
    build_cbz(path, [
        ("page1.jpg", page_bytes("page1")),
        ("__MACOSX/._page1.jpg", b"\x00\x05\x16\x07resource-fork"),
        ("._page1.jpg", b"\x00\x05\x16\x07resource-fork"),
        ("Thumbs.db", b"\x00" * 8),
        ("ComicInfo.xml", comic_info(title="Noise")),
        ("notes.txt", b"not a page"),
    ])


def build_subdirs(path: str) -> None:
    """两级章节目录，且写入顺序故意打乱。"""
    build_cbz(path, [
        ("ch02/page1.jpg", page_bytes("ch02-p1")),
        ("ch01/page10.jpg", page_bytes("ch01-p10")),
        ("ch01/page2.jpg", page_bytes("ch01-p2")),
        ("ch01/page1.jpg", page_bytes("ch01-p1")),
    ])


def build_meta(path: str) -> None:
    build_cbz(path, [
        ("page1.jpg", page_bytes("p1")),
        ("page2.jpg", page_bytes("p2")),
        ("ComicInfo.xml", comic_info(
            title="Probe Comic", series="测试系列", number="1", volume="2",
            writer="Someone", publisher="Probe Press", year="2024",
            summary="一句简介。", page_count="2",
        )),
    ])


def build_no_meta(path: str) -> None:
    build_cbz(path, [("page1.jpg", page_bytes("p1"))])


def build_mismatch(path: str) -> None:
    build_cbz(path, [
        ("page1.jpg", page_bytes("p1")),
        ("page2.jpg", page_bytes("p2")),
        ("page3.jpg", page_bytes("p3")),
        ("ComicInfo.xml", comic_info(title="Mismatch", page_count="5")),
    ])


def build_empty(path: str) -> None:
    """有 zip 结构，但一张图都没有。"""
    build_cbz(path, [("ComicInfo.xml", comic_info(title="Empty")), ("readme.txt", b"x")])


def build_not_zip(path: str) -> None:
    with open(path, "wb") as handle:
        handle.write(b"this is not a zip archive at all")


def build_zero_byte(path: str) -> None:
    build_cbz(path, [
        ("page1.jpg", page_bytes("p1")),
        ("page2.jpg", b""),
        ("page3.jpg", page_bytes("p3")),
    ])


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
    """照 main.py 的 save_result 重写媒体引用：占位符 -> {stem}_media/文件名。"""
    for placeholder, info in media_map.items():
        local_name = os.path.basename(info["local_path"])
        escaped = re.escape(placeholder)
        markdown = re.sub(rf'\]\(\s*{escaped}(?:\s+["\'][^"\']*["\'])?\s*\)',
                          f"]({stem}_media/{local_name})", markdown)
        markdown = re.sub(rf'src="{escaped}"', f'src="{stem}_media/{local_name}"', markdown)
    return markdown


def image_refs(markdown: str) -> list[str]:
    return re.findall(r"!\[[^\]]*\]\(([^)]*)\)", markdown)


def media_files(out_dir: str, stem: str) -> list[str]:
    media_dir = os.path.join(out_dir, f"{stem}_media")
    return sorted(os.listdir(media_dir)) if os.path.isdir(media_dir) else []


def media_dir_exists(out_dir: str, stem: str) -> bool:
    return os.path.isdir(os.path.join(out_dir, f"{stem}_media"))


def read_media(out_dir: str, stem: str, name: str) -> bytes:
    with open(os.path.join(out_dir, f"{stem}_media", name), "rb") as handle:
        return handle.read()


def stem_of(source: str) -> str:
    return os.path.splitext(os.path.basename(source))[0]


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-cbz-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


# ── 八个场景 ────────────────────────────────────────────────────────

def case_natural_order(root: str) -> Checker:
    """page1 / page2 / page10：页序是 1、2、10，落盘编号与内容都对得上。"""
    check = Checker()
    print()
    print("── 1. 自然排序（page1 / page2 / page10）──")
    source = os.path.join(root, "natural.cbz")
    out_dir = os.path.join(root, "out_natural")
    build_natural(source)
    stem = stem_of(source)

    result = CbzExtractor({}).extract(source, output_dir=out_dir)
    refs = image_refs(result.markdown)
    check.ok(len(refs) == 3, "正文里三条图片引用", str(refs))
    check.ok(all(ref.startswith("docintake-media-") for ref in refs),
             "转换后是占位符（改写交给 save_result）", str(refs))

    rewritten = rewrite_like_save_result(result.markdown, result.metadata["mediaMap"], stem)
    names = [os.path.basename(ref) for ref in image_refs(rewritten)]
    check.ok(names == ["image_001.jpg", "image_002.jpg", "image_003.jpg"],
             "引用按 001..003 连续编号", str(names))
    check.ok("docintake-media-" not in rewritten, "改写过之后不剩占位符")

    on_disk = media_files(out_dir, stem)
    check.ok(on_disk == ["image_001.jpg", "image_002.jpg", "image_003.jpg"],
             "落盘三个文件，编号连续", str(on_disk))

    # 顺序的真凭据是内容：image_001 必须就是 page1 的字节。
    check.ok(read_media(out_dir, stem, "image_001.jpg") == page_bytes("page1"),
             "image_001 是 page1")
    check.ok(read_media(out_dir, stem, "image_002.jpg") == page_bytes("page2"),
             "image_002 是 page2")
    check.ok(read_media(out_dir, stem, "image_003.jpg") == page_bytes("page10"),
             "image_003 是 page10（不是 page10 被字典序挤到 page1 前面）")

    check.ok("共 3 页" in result.markdown, "正文写了「共 3 页」")
    check.ok(result.metadata.get("pageCount") == 3, "metadata.pageCount 是 3",
             str(result.metadata.get("pageCount")))
    check.ok("第 1 页" not in result.markdown and "第1页" not in result.markdown,
             "没有「第 N 页」标题")
    check.ok(not result.warnings, "没有 warning", str(result.warnings))
    return check


def case_noise(root: str) -> Checker:
    """打包垃圾不算页。"""
    check = Checker()
    print()
    print("── 2. 跳过 __MACOSX / ._xxx / Thumbs.db / ComicInfo.xml ──")
    source = os.path.join(root, "noise.cbz")
    out_dir = os.path.join(root, "out_noise")
    build_noise(source)
    stem = stem_of(source)

    result = CbzExtractor({}).extract(source, output_dir=out_dir)
    check.ok(len(image_refs(result.markdown)) == 1, "只有一页",
             str(image_refs(result.markdown)))
    check.ok(result.metadata.get("pageCount") == 1, "pageCount 是 1",
             str(result.metadata.get("pageCount")))
    check.ok("共 1 页" in result.markdown, "正文写了「共 1 页」")
    check.ok(media_files(out_dir, stem) == ["image_001.jpg"], "只落盘一页",
             str(media_files(out_dir, stem)))
    check.ok(read_media(out_dir, stem, "image_001.jpg") == page_bytes("page1"),
             "落盘的是那张真图，不是资源叉")
    check.ok("note" not in result.markdown and "not a page" not in result.markdown,
             "txt 条目没进正文")
    return check


def case_subdirs(root: str) -> Checker:
    """ch01/page1 在 ch02/page1 前；同级按文件名；落盘不互相覆盖。"""
    check = Checker()
    print()
    print("── 3. 子目录里的页 ──")
    source = os.path.join(root, "subdirs.cbz")
    out_dir = os.path.join(root, "out_subdirs")
    build_subdirs(source)
    stem = stem_of(source)

    result = CbzExtractor({}).extract(source, output_dir=out_dir)
    on_disk = media_files(out_dir, stem)
    check.ok(len(on_disk) == 4, "四页各落一个文件（同名不同目录没被覆盖）", str(on_disk))
    check.ok(on_disk == ["image_001.jpg", "image_002.jpg", "image_003.jpg", "image_004.jpg"],
             "编号连续", str(on_disk))

    expected = [page_bytes("ch01-p1"), page_bytes("ch01-p2"),
                page_bytes("ch01-p10"), page_bytes("ch02-p1")]
    actual = [read_media(out_dir, stem, name) for name in on_disk]
    check.ok(actual == expected,
             "顺序是 ch01/page1 -> ch01/page2 -> ch01/page10 -> ch02/page1",
             str([item[8:].decode("utf-8", "replace") for item in actual]))
    check.ok(result.metadata.get("pageCount") == 4, "pageCount 是 4",
             str(result.metadata.get("pageCount")))
    return check


def case_metadata(root: str) -> Checker:
    """ComicInfo 进 metadata 与正文；没有它时书名回落到文件名。"""
    check = Checker()
    print()
    print("── 4. ComicInfo.xml 元数据 / 回落到文件名 ──")
    source = os.path.join(root, "meta.cbz")
    build_meta(source)
    result = CbzExtractor({}).extract(source, output_dir=None)
    meta = result.metadata

    check.ok(result.markdown.startswith("# Probe Comic"), "首行是 `# Title`",
             result.markdown.splitlines()[:1])
    check.ok("*测试系列 · Vol.1*" in result.markdown, "系列/卷号成一行斜体")
    check.ok("一句简介。" in result.markdown, "Summary 作为一段斜体简介")
    check.ok(result.markdown.find("一句简介。") < result.markdown.find("docintake-media-"),
             "简介在图片之前")
    check.ok(meta.get("format") == "cbz", "format 是 cbz")
    check.ok(meta.get("reader") == "cbz-local", "reader 是 cbz-local")
    check.ok(meta.get("author") == "Someone", "author 取 Writer", str(meta.get("author")))
    check.ok(meta.get("series") == "测试系列", "series 进 metadata")
    check.ok(meta.get("number") == "1", "number 进 metadata")
    check.ok(meta.get("volume") == "2", "volume 进 metadata")
    check.ok(meta.get("publisher") == "Probe Press", "publisher 进 metadata")
    check.ok(meta.get("year") == "2024", "year 进 metadata")
    check.ok(meta.get("pageCount") == 2, "pageCount 是 2", str(meta.get("pageCount")))
    check.ok(not result.warnings, "PageCount 与实际一致时没有 warning", str(result.warnings))

    bare = os.path.join(root, "no-metadata-at-all.cbz")
    build_no_meta(bare)
    bare_result = CbzExtractor({}).extract(bare, output_dir=None)
    check.ok(bare_result.markdown.startswith("# no-metadata-at-all"),
             "没有 ComicInfo 时书名回落到文件名（去扩展名）",
             bare_result.markdown.splitlines()[:1])
    check.ok(bare_result.metadata.get("title") == "no-metadata-at-all", "metadata.title 同样回落")
    check.ok(bare_result.metadata.get("author") == "", "author 是空串",
             repr(bare_result.metadata.get("author")))
    check.ok("series" not in bare_result.metadata, "没有值的 series 不写进 metadata",
             str(sorted(bare_result.metadata)))
    return check


def case_page_count_mismatch(root: str) -> Checker:
    """PageCount=5、实际 3 页：有 warning，页数按实际算。"""
    check = Checker()
    print()
    print("── 5. PageCount 与实际页数不一致 ──")
    source = os.path.join(root, "mismatch.cbz")
    build_mismatch(source)
    result = CbzExtractor({}).extract(source, output_dir=None)

    check.ok(result.metadata.get("pageCount") == 3, "pageCount 按实际图片数（3）",
             str(result.metadata.get("pageCount")))
    check.ok("共 3 页" in result.markdown, "正文写的是实际页数")
    check.ok(any("PageCount" in warning for warning in result.warnings),
             "warning 提到 PageCount", str(result.warnings))
    check.ok(any("5" in warning and "3" in warning for warning in result.warnings),
             "warning 里两个数都在（写的 5、实际 3）", str(result.warnings))
    return check


def case_no_images(root: str) -> Checker:
    """include_images=False：不落盘、不留引用。"""
    check = Checker()
    print()
    print("── 6. include_images=False ──")
    source = os.path.join(root, "noimg.cbz")
    out_dir = os.path.join(root, "out_noimg")
    build_natural(source)
    stem = stem_of(source)

    result = CbzExtractor({}).extract(source, output_dir=out_dir, include_images=False)
    check.ok(not image_refs(result.markdown), "正文里没有图引用",
             str(image_refs(result.markdown)))
    check.ok("docintake-media-" not in result.markdown, "没有占位符")
    check.ok(not media_dir_exists(out_dir, stem), "没建 media 目录")
    check.ok(result.metadata.get("mediaMap") == {}, "mediaMap 为空",
             str(result.metadata.get("mediaMap")))
    check.ok(not result.images, "result.images 为空")
    check.ok("媒体提取已关闭（共 3 页）" in result.markdown,
             "正文留了一行「媒体提取已关闭（共 3 页）」")
    check.ok(result.markdown.startswith("# noimg"), "标题照常输出",
             str(result.markdown.splitlines()[:1]))
    return check


def case_broken(root: str) -> Checker:
    """空包 / 全非图片 / 不是 zip：抛 CbzError，信息是人话。"""
    check = Checker()
    print()
    print("── 7. 空包 / 全非图片 / 不是 zip ──")
    empty = os.path.join(root, "empty.cbz")
    build_empty(empty)
    empty_message = ""
    try:
        CbzExtractor({}).extract(empty, output_dir=None)
    except CbzError as exc:
        empty_message = str(exc)
    except Exception:  # 抛了别的类型也算不合格：上层只会看到 traceback 文字
        empty_message = ""
    check.ok(bool(empty_message), "空包抛出了 CbzError（不是裸异常）")
    check.ok("没有图片条目" in empty_message, "错误信息说了「没有图片条目」", empty_message)
    check.ok("CBR/CB7" in empty_message, "错误信息给了可能的原因（CBR/CB7）", empty_message)

    not_zip = os.path.join(root, "not-a-zip.cbz")
    build_not_zip(not_zip)
    not_zip_message = ""
    try:
        CbzExtractor({}).extract(not_zip, output_dir=None)
    except CbzError as exc:
        not_zip_message = str(exc)
    except Exception:
        not_zip_message = ""
    check.ok(bool(not_zip_message), "不是 zip 时抛出 CbzError")
    check.ok("zip" in not_zip_message, "错误信息说了 zip", not_zip_message)
    return check


def case_zero_byte(root: str) -> Checker:
    """0 字节图片：warning + 跳过该页，其余页照常出。"""
    check = Checker()
    print()
    print("── 8. 0 字节图片 ──")
    source = os.path.join(root, "zero.cbz")
    out_dir = os.path.join(root, "out_zero")
    build_zero_byte(source)
    stem = stem_of(source)

    result = CbzExtractor({}).extract(source, output_dir=out_dir)
    check.ok(any("0 字节" in warning for warning in result.warnings),
             "warning 说了 0 字节", str(result.warnings))
    check.ok("page2.jpg" in " ".join(result.warnings), "warning 指了是哪一页",
             str(result.warnings))
    check.ok(len(image_refs(result.markdown)) == 2, "正文只留两页引用",
             str(image_refs(result.markdown)))
    check.ok(result.metadata.get("pageCount") == 2, "pageCount 按能解出来的页算",
             str(result.metadata.get("pageCount")))
    check.ok(media_files(out_dir, stem) == ["image_001.jpg", "image_002.jpg"],
             "只落盘两页，编号仍然连续", str(media_files(out_dir, stem)))
    check.ok(read_media(out_dir, stem, "image_002.jpg") == page_bytes("p3"),
             "跳过的页没让后面的页错位")
    check.ok("docintake-media-" not in rewrite_like_save_result(
        result.markdown, result.metadata["mediaMap"], stem), "没有残留占位符")
    return check


def self_test() -> int:
    print("CBZ 提取器自测（现场造样本）")

    def run(root: str) -> int:
        total = Checker()
        for case in (case_natural_order, case_noise, case_subdirs, case_metadata,
                     case_page_count_mismatch, case_no_images, case_broken, case_zero_byte):
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
    print("用法：python test/selftest_v8_cbz.py")
