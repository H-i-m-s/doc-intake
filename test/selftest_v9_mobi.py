"""v9 MOBI 提取器自测：手造 PalmDB 头 + 真样本（可选），跑完删干净。

用法：python test/selftest_v9_mobi.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. PalmDB 头两道门槛：type/creator 在文件偏移 0x3C，encryption type 在 record 0 的
     PalmDOC 头（+0x0C）。type/creator 不是 BOOKMOBI → 报「不是 Kindle 电子书」；
     encryption=1/2 → 报 DRM 且信息里带类型号；encryption=0 → 判为可解析。
     另外从 extract() 端到端再走一遍 DRM=2：证明它死在 import 与解包之前。
     顺带覆盖两个残包：头不完整、记录表指向文件外面。
  2. 依赖缺失：合法头 + 把 `mobi` 从 import 路径上挡掉 → 抛的是「需要安装 mobi」这类
     可读错误，不是 ImportError 原文。
  3. 文件过大：500 MB 门槛（假 size，不真造大文件）。
  4. 解出 .epub 的转交与改名：库给的是 `book.epub`，得改成 `{原文件 stem}.epub` ——
     用落盘目录名（`{stem}_media` 而不是 `book_media`）反推改名做没做。
  5. 真实解析：装了 `mobi` 且给了 DOC_INTAKE_MOBI_SAMPLE 就跑一遍；没给就打印跳过，
     退出码仍为 0（这是允许的跳过，不是失败）。
"""

from __future__ import annotations

import os
import shutil
import struct
import sys
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

from extractors.mobi_extractor import (  # noqa: E402
    MAX_SOURCE_BYTES,
    MobiError,
    MobiExtractor,
    _check_kindle_type,
    _check_no_drm,
    _ensure_size_within_limit,
    _read_encryption,
    _read_type_creator,
)

PDB_HEADER_BYTES = 78
TYPE_CREATOR_OFFSET = 0x3C
RECORD_COUNT_OFFSET = 0x4C
ENTRY_BYTES = 8
PALMDOC_HEADER_BYTES = 16

# `sys.modules` 里没有这个键时的哨兵值（None 是「被挡住了」的意思，两者不能混）
_MISSING = object()


# ── 造样本 ──────────────────────────────────────────────────────────

def make_pdb(
    path: str,
    *,
    encryption: int = 0,
    type_creator: bytes = b"BOOKMOBI",
    record0_offset: int | None = None,
    record_count: int = 1,
    payload: bytes = b"",
) -> None:
    """造一个布局正确的 palm 数据库：78 字节头 + 记录表 + 带 PalmDOC 头的 record 0。

    只保证偏移对得上（0x3C 的 type/creator、0x4C 的记录数、紧随其后的记录表、
    record0+0x0C 的 encryption），够让两道门槛走完；它不打算能被 `mobi` 解开——
    真解析那条路用真样本测。type/creator 写 8 字节，写短了按尾部补零。
    """
    header = bytearray(PDB_HEADER_BYTES)
    header[0:8] = b"selftest"                       # 数据库名（最多 32 字节）
    header[TYPE_CREATOR_OFFSET:TYPE_CREATOR_OFFSET + 8] = type_creator.ljust(8, b"\x00")[:8]
    # 记录数是 78 字节头的末尾两个字节（0x4C），记录表紧跟头之后（与真文件一致）。
    struct.pack_into(">H", header, RECORD_COUNT_OFFSET, record_count)

    data_offset = PDB_HEADER_BYTES + ENTRY_BYTES * record_count
    # PalmDOC 头：压缩=1(不压缩) 未用 正文长度 记录数 记录大小 encryption，再跟 MOBI 魔数。
    record0 = struct.pack(">HHIHHH", 1, 0, 32, 1, 4096, encryption) + b"MOBI" + b"\x00" * 8

    table = b""
    for index in range(record_count):
        offset = data_offset if index else (data_offset if record0_offset is None else record0_offset)
        table += struct.pack(">I", offset) + b"\x00\x00\x00\x00"   # 偏移 + 属性 + uniqueID

    with open(path, "wb") as handle:
        handle.write(bytes(header))
        handle.write(table)
        handle.write(record0)
        handle.write(payload)


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


def expect_error(fn, kinds=(MobiError,)) -> str:
    """跑 fn，把它抛出来的消息交回来；没抛或抛了别的类型都返回空串（判为不合格）。"""
    try:
        fn()
    except kinds as exc:
        return str(exc)
    except Exception:
        return ""
    return ""


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-mobi-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082"
)

_EPUB_CONTAINER = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/content.opf" '
    'media-type="application/oebps-package+xml"/></rootfiles></container>'
)

_EPUB_OPF = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">'
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    '<dc:title>Renamed Book</dc:title><dc:creator>Someone</dc:creator>'
    '<dc:language>zh</dc:language></metadata>'
    '<manifest>'
    '<item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>'
    '<item id="pic" href="images/pic.png" media-type="image/png"/>'
    '</manifest><spine><itemref idref="ch1"/></spine></package>'
)

_EPUB_XHTML = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>ch1</title></head>'
    '<body><h2>第一章</h2><p>正文一段。</p>'
    '<p><img src="../images/pic.png" alt="图"/></p></body></html>'
)


def build_minimal_epub(path: str) -> None:
    """造一份最小 EPUB：一章正文 + 一张图。守的是转交与改名这条路，不追求全。"""
    with zipfile.ZipFile(path, "w") as zf:
        info = zipfile.ZipInfo("mimetype")
        info.compress_type = zipfile.ZIP_STORED
        zf.writestr(info, "application/epub+zip")
        zf.writestr("META-INF/container.xml", _EPUB_CONTAINER)
        zf.writestr("OEBPS/content.opf", _EPUB_OPF)
        zf.writestr("OEBPS/text/ch1.xhtml", _EPUB_XHTML)
        zf.writestr("OEBPS/images/pic.png", _PNG)


# ── 场景 ────────────────────────────────────────────────────────────
def case_header_gate(root: str) -> Checker:
    """PalmDB 头：先认是不是 Kindle 书，再认有没有 DRM。"""
    check = Checker()
    print()
    print("── 1. PalmDB 头（type/creator + DRM）──")

    clean = os.path.join(root, "clean.mobi")
    make_pdb(clean)
    check.ok(_read_type_creator(Path(clean)) == b"BOOKMOBI", "0x3C 读到 BOOKMOBI")
    check.ok(_read_encryption(Path(clean)) == 0, "record0+0x0C 读到 encryption=0",
             str(_read_encryption(Path(clean))))
    check.ok(expect_error(lambda: _check_kindle_type(b"BOOKMOBI", "clean.mobi")) == "",
             "BOOKMOBI：判为 Kindle 电子书")
    check.ok(expect_error(lambda: _check_no_drm(0, "clean.mobi")) == "",
             "encryption=0：判为可解析")

    for level in (1, 2):
        path = os.path.join(root, f"drm{level}.mobi")
        make_pdb(path, encryption=level)
        read_back = _read_encryption(Path(path))
        check.ok(read_back == level, f"encryption={level}：从 record0 读得回来", str(read_back))
        message = expect_error(lambda level=level: _check_no_drm(level, "x.mobi"))
        check.ok("DRM" in message, f"encryption={level}：错误信息说了 DRM", message)
        check.ok(str(level) in message, f"encryption={level}：错误信息带类型号", message)

    other = os.path.join(root, "palmdoc.prc")
    make_pdb(other, type_creator=b"TEXtREAd")
    message = expect_error(lambda: _check_kindle_type(_read_type_creator(Path(other)), "x.prc"))
    check.ok(bool(message), "TEXtREAd：抛了 MobiError", message)
    check.ok("不是 Kindle 电子书" in message, "TEXtREAd：报「不是 Kindle 电子书」", message)
    check.ok("TEXtREAd" in message, "TEXtREAd：错误信息带实际 type/creator", message)

    # 端到端：extract() 也得死在 import 之前（这一步不管环境里装没装 mobi）
    drm_path = os.path.join(root, "e2e_drm.mobi")
    make_pdb(drm_path, encryption=2)
    message = expect_error(lambda: MobiExtractor({}).extract(drm_path, output_dir=None))
    check.ok("DRM" in message and "2" in message,
             "extract() 端到端：encryption=2 直接报 DRM", message)

    # 残包：头不够 78 字节、记录表被截断、记录表指到文件外面
    short = os.path.join(root, "short.mobi")
    with open(short, "wb") as handle:
        handle.write(b"MOBI")
    message = expect_error(lambda: MobiExtractor({}).extract(short, output_dir=None))
    check.ok("PalmDB 头" in message, "不足 78 字节：报头都不够", message)

    truncated = os.path.join(root, "truncated.mobi")
    table_missing = bytearray(PDB_HEADER_BYTES)
    table_missing[TYPE_CREATOR_OFFSET:TYPE_CREATOR_OFFSET + 8] = b"BOOKMOBI"
    struct.pack_into(">H", table_missing, RECORD_COUNT_OFFSET, 1)   # 说有 1 条，但记录表一个字没有
    with open(truncated, "wb") as handle:
        handle.write(bytes(table_missing))
    message = expect_error(lambda: MobiExtractor({}).extract(truncated, output_dir=None))
    check.ok("记录表" in message, "记录表被截断：说得清是记录表的问题", message)

    outside = os.path.join(root, "outside.mobi")
    make_pdb(outside, record0_offset=10 ** 6)
    message = expect_error(lambda: MobiExtractor({}).extract(outside, output_dir=None))
    check.ok("文件外面" in message, "记录表指到文件外面：说得清越界", message)
    return check


def case_missing_dep(root: str) -> Checker:
    """没装 mobi：要的是安装指引，不是 ImportError 原文。"""
    check = Checker()
    print()
    print("── 2. 依赖缺失 ──")

    path = os.path.join(root, "nodep.mobi")
    make_pdb(path)

    previous = sys.modules.get("mobi", _MISSING)
    sys.modules["mobi"] = None  # 挡住 import：`import mobi` 会抛 ImportError
    try:
        message = expect_error(lambda: MobiExtractor({}).extract(path, output_dir=None))
    finally:
        if previous is _MISSING:
            sys.modules.pop("mobi", None)
        else:
            sys.modules["mobi"] = previous

    check.ok(bool(message), "抛了 MobiError", message)
    check.ok("pip install mobi" in message, "错误信息给了 pip install mobi", message)
    check.ok("GPL-3.0" in message, "错误信息说了它的许可证", message)
    check.ok("ImportError" not in message and "Traceback" not in message,
             "没有把 ImportError 原文冒出来", message)
    return check


def case_size_limit(root: str) -> Checker:
    """500 MB 门槛：用假 size 验，不真造大文件。"""
    check = Checker()
    print()
    print("── 3. 文件过大 ──")

    check.ok(expect_error(lambda: _ensure_size_within_limit(MAX_SOURCE_BYTES, "ok.mobi")) == "",
             "正好 500 MB：放行")
    message = expect_error(lambda: _ensure_size_within_limit(MAX_SOURCE_BYTES + 1, "big.mobi"))
    check.ok("500 MB" in message, "超过上限：报错里写了 500 MB", message)

    path = os.path.join(root, "huge.mobi")
    make_pdb(path)
    original_stat = Path.stat

    def fake_stat(self, *args, **kwargs):
        stat = original_stat(self, *args, **kwargs)
        if os.path.abspath(str(self)) == os.path.abspath(path):
            return SimpleNamespace(st_size=MAX_SOURCE_BYTES + 1, st_mtime=stat.st_mtime)
        return stat

    Path.stat = fake_stat
    try:
        message = expect_error(lambda: MobiExtractor({}).extract(path, output_dir=None))
    finally:
        Path.stat = original_stat

    check.ok("500 MB" in message, "extract() 里这道门也拦得住", message)
    return check


def case_epub_handoff(root: str) -> Checker:
    """解出 .epub：交给 EpubExtractor，且先改名成 {原文件 stem}.epub。改名报错的话，
    媒体目录会跟着库的临时名走（book_media/），所以用落盘目录名反推改名做没做。"""
    check = Checker()
    print()
    print("── 4. 解出 epub：转交与改名 ──")

    source = os.path.join(root, "original-name.mobi")
    make_pdb(source)

    fake_temp = os.path.join(root, "mobitemp")
    epub_dir = os.path.join(fake_temp, "mobi8")
    os.makedirs(epub_dir, exist_ok=True)
    unpacked = os.path.join(epub_dir, "book.epub")   # 库给的临时文件名与原书不同名
    build_minimal_epub(unpacked)

    previous = sys.modules.get("mobi", _MISSING)
    sys.modules["mobi"] = SimpleNamespace(extract=lambda _source: (fake_temp, unpacked))
    try:
        out_dir = os.path.join(root, "epub_out")
        result = MobiExtractor({}).extract(source, output_dir=out_dir)
    finally:
        if previous is _MISSING:
            sys.modules.pop("mobi", None)
        else:
            sys.modules["mobi"] = previous

    check.ok(result.metadata.get("containerFormat") == "epub", "containerFormat 记成 epub",
             str(result.metadata.get("containerFormat")))
    check.ok(result.metadata.get("format") == "mobi"
             and result.metadata.get("reader") == "mobi-local",
             "format / reader 被覆写成 mobi / mobi-local")
    check.ok(result.metadata.get("title") == "Renamed Book", "元数据从转交结果继承",
             str(result.metadata.get("title")))
    check.ok("第一章" in result.markdown, "正文转出来了")
    check.ok(os.path.isdir(os.path.join(out_dir, "original-name_media")),
             "媒体目录叫 {原文件 stem}_media", str(os.listdir(out_dir)))
    check.ok(not os.path.isdir(os.path.join(out_dir, "book_media")),
             "没有跟着库的临时名留下 book_media/")
    check.ok(not os.path.exists(fake_temp), "临时目录已删干净")
    return check


def case_real_sample(root: str) -> Checker:
    """真样本：装了 mobi 且有样本才跑，否则明文跳过。"""
    check = Checker()
    print()
    print("── 5. 真实解析 ──")

    sample = os.environ.get("DOC_INTAKE_MOBI_SAMPLE", "").strip()
    try:
        import mobi  # noqa: F401
        have_dep = True
    except ImportError:
        have_dep = False

    if not have_dep or not sample or not os.path.isfile(sample):
        reason = "未装 mobi" if not have_dep else "未提供样本（DOC_INTAKE_MOBI_SAMPLE）"
        print(f"  跳过真实解析：{reason}")
        return check

    out_dir = os.path.join(root, "real_out")
    result = MobiExtractor({}).extract(sample, output_dir=out_dir)

    check.ok(bool(result.markdown.strip()), "markdown 非空", f"{len(result.markdown)} 字符")
    check.ok(result.metadata.get("format") == "mobi", "metadata.format == mobi",
             str(result.metadata.get("format")))
    check.ok(result.metadata.get("reader") == "mobi-local", "metadata.reader == mobi-local",
             str(result.metadata.get("reader")))
    check.ok(result.metadata.get("containerFormat") in ("epub", "html"),
             "containerFormat 是 epub/html 之一",
             str(result.metadata.get("containerFormat")))
    check.ok("docintake-media-" not in result.markdown, "正文里没有残留占位符")
    check.ok("mobi7" not in result.markdown and "mobi8" not in result.markdown
             and "Images/" not in result.markdown, "正文里没有残留解包临时路径")
    print(f"  · 容器格式 {result.metadata.get('containerFormat')}，"
          f"{len(result.markdown)} 字符，{len(result.images)} 个媒体文件")
    return check



def self_test() -> int:
    print("MOBI 提取器自测（手造 PalmDB 头 + 可选真样本）")

    def run(root: str) -> int:
        total = Checker()
        for case in (case_header_gate, case_missing_dep, case_size_limit,
                     case_epub_handoff, case_real_sample):
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
    print("用法：python test/selftest_v9_mobi.py")
