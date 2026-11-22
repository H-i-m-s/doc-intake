"""v10 TXT 提取器自测：造样本真跑，跑完删干净。

用法：python test/selftest_v10_txt.py      （在任何工作目录下都能跑，位置由 __file__ 推出来）

覆盖：
  1. BOM 家族：utf-8-sig / utf-16-le / utf-16-be / utf-32-le / utf-32-be 五份，逐字对回原文。
     utf-32 那两个是重点：它们的 BOM 以 utf-16 的 BOM 为前缀，判错顺序就会解出一串带 NUL 的字。
  2. 自动判定：UTF-8（带与不带 BOM）、纯 ASCII、GBK、GB18030（含四字节区 㐀𠀀𪚥）、Big5、
     无 BOM 的 UTF-16BE、CP1252。每种都断言解出来与原文逐字相等。
  3. 保真：这条路径最重要的断言。markdown 必须等于「原文换行统一为 LF、逐行剥尾空白」的
     结果——它同时证明了没加标题、没合并段落、没去缩进、没压空行。
  4. CRLF 与 CR 两种换行。
  5. Big5 与 GB18030 的区分：把 `獴眖衬碞⊿氨筁` 这类「Big5 被当 GB18030 解」的产物直接喂给
     打分，断言常用汉字占比与分数都掉到不可信那一边，而正确解出来的文本远在其上。
  6. txtEncoding 覆盖：指对了逐字相等，指错了要出替换符 warning，不静默。
  7. 三个错误路径：含 NUL 的二进制、空文件、全是空白。
  8. 全判不出：「部分内容 + 报错」——正文照给，warnings 说清原因，confidence 记 0。
  9. 接线：formats.json 里 .txt 登记为 txt，get_extractor 能拿到 TxtExtractor。

不依赖 charset-normalizer：第 5、6、8 组用例会把查表那一步挡掉，让自建打分单独走一遍。
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_APP_DIR = os.path.dirname(_TEST_DIR)
_PY_DIR = os.path.join(_APP_DIR, "python")
if _PY_DIR not in sys.path:
    sys.path.insert(0, _PY_DIR)

import formats  # noqa: E402
from extractors import get_extractor  # noqa: E402
from extractors import txt_extractor as _MODULE  # noqa: E402
from extractors.txt_extractor import (  # noqa: E402
    COMMON_RATIO_FLOOR,
    MIN_SCORE,
    TxtError,
    TxtExtractor,
    _analyse,
    _is_plausible,
)

# 一份普通中文文本：有标题行、有空行、有全角标点、有阿拉伯数字，够长（>500 字）。
ZH = (
    "第一章 山门\n"
    "\n"
    "这是一本用来测试编码判定的普通中文文本。我们在这里放一些常用的汉字，为的是让打分能够\n"
    "真的生效。他在山中住了三年，每天清晨都要到溪边挑水，那时候没有人知道这件事后来会变成\n"
    "什么样，但是他们都不后悔。1987 年的冬天，雪下得很大，山路封了整整七天。\n"
    "\n"
    "第二段继续写一些平常的话，用来把篇幅撑到五百字以上，方便真跑一遍看看正文有没有被改动。\n"
    "书本上的字一个一个地排在那里，不加标题，也不合并段落，读者看到的就是原文的样子。如果\n"
    "有人在中间插进一句英文 like this one，那么编码判定还得照顾到这一行。\n"
    "\n"
    "最后一段收尾。这个故事没有结尾，因为写字的人把它停在了这里。\n"
) * 3

# 繁体中文（Big5 的真实使用者）：常用字里有一大批是简体表里查不到的形态。
ZH_TRAD = (
    "第一章 山門\n"
    "\n"
    "這是一本用來測試編碼判定的繁體中文文本。我們在這裡放一些常用的漢字，為的是讓打分能夠\n"
    "真的生效。他在山中住了三年，每天清晨都要到溪邊挑水，那時候沒有人知道這件事後來會變成\n"
    "什麼樣，但是他們都不後悔。1987 年的冬天，雪下得很大，山路封了整整七天。\n"
    "\n"
    "第二段繼續寫一些平常的話，用來把篇幅撐到五百字以上，方便真跑一遍看看正文有沒有被改動。\n"
    "書本上的字一個一個地排在那裡，不加標題，也不合併段落，讀者看到的就是原文的樣子。\n"
) * 3

# CP1252 的典型内容：é 与印刷体引号，纯 ASCII 的话会在第 3 步就被 UTF-8 收走。
EN = (
    "Chapter one: the mountain gate.\n"
    "\n"
    "The rain had not stopped since morning, and nobody bothered to ask why. Café owners swept\n"
    "the pavement, “quietly”, while the old clock ticked past noon.\n"
) * 8


# ── 断言小工具（与 v9 同款）──────────────────────────────────────────


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


def expect_error(fn, kinds=(TxtError,)) -> str:
    """跑 fn，把它抛出来的消息交回来；没抛或抛了别的类型都返回空串（判为不合格）。"""
    try:
        fn()
    except kinds as exc:
        return str(exc)
    except Exception:
        return ""
    return ""


def with_temp(fn) -> int:
    root = tempfile.mkdtemp(prefix="docintake-txt-")
    try:
        return fn(root)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def write_txt(root: str, name: str, data: bytes) -> str:
    path = os.path.join(root, name)
    with open(path, "wb") as handle:
        handle.write(data)
    return path


class _NoCharsetNormalizer:
    """临时把 charset-normalizer 那一步挡掉，让自建打分单独走一遍。

    没有它，「Big5 判对了」可能只是第三方库蒙对的，而这套东西的立身之本是自己也判得对。
    """

    def __enter__(self):
        self._saved = _MODULE._charset_normalizer_guess
        _MODULE._charset_normalizer_guess = lambda data: None
        return self

    def __exit__(self, *exc_info):
        _MODULE._charset_normalizer_guess = self._saved
        return False


def extract(path: str, settings: dict | None = None):
    return TxtExtractor(settings or {}).extract(path)


def expected_text(original: str) -> str:
    """原文按规则整理后的样子：换行统一成 LF、逐行剥掉行尾的空格与制表符。

    这条式子是手写的，不是调 extractor 里的 _normalise——用被测代码算期望值等于自己验自己。
    """
    unified = original.replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in unified.split("\n"):
        while line.endswith(" ") or line.endswith("\t"):
            line = line[:-1]
        lines.append(line)
    return "\n".join(lines)


# ── 场景 ────────────────────────────────────────────────────────────
def case_bom(root: str) -> Checker:
    """BOM 五档：命中即定，且 utf-32 必须先于 utf-16 判。"""
    check = Checker()
    print()
    print("── 1. BOM 家族 ──")

    cases = [
        ("bom_utf8.txt", b"\xef\xbb\xbf", "utf-8", "utf-8-sig"),
        ("bom_utf16le.txt", b"\xff\xfe", "utf-16-le", "utf-16-le"),
        ("bom_utf16be.txt", b"\xfe\xff", "utf-16-be", "utf-16-be"),
        ("bom_utf32le.txt", b"\xff\xfe\x00\x00", "utf-32-le", "utf-32-le"),
        ("bom_utf32be.txt", b"\x00\x00\xfe\xff", "utf-32-be", "utf-32-be"),
    ]
    for name, bom, codec, want_encoding in cases:
        path = write_txt(root, name, bom + ZH.encode(codec))
        result = extract(path)
        meta = result.metadata
        check.ok(result.markdown == expected_text(ZH), f"{want_encoding}：正文逐字相等",
                 repr(result.markdown[:20]))
        check.ok(meta["encoding"] == want_encoding,
                 f"{want_encoding}：metadata.encoding 记成 {want_encoding}", str(meta["encoding"]))
        check.ok(meta["encodingSource"] == "bom",
                 f"{want_encoding}：encodingSource == bom", str(meta["encodingSource"]))
        check.ok(meta["hasBom"] is True, f"{want_encoding}：hasBom == True")
        check.ok(not result.markdown.startswith("\ufeff"),
                 f"{want_encoding}：正文开头没有残留 BOM")
        check.ok(not result.warnings, f"{want_encoding}：没有 warning", str(result.warnings))

    # utf-32 的 BOM 以 utf-16 的 BOM 为前缀：判错顺序的后果是解出一串 NUL。
    path = os.path.join(root, "bom_utf32le.txt")
    text = extract(path).markdown
    check.ok("\x00" not in text, "utf-32LE 没有被当成 utf-16LE 解（正文里没有 NUL）")
    return check


def case_autodetect(root: str) -> Checker:
    """没有 BOM 时，六种真实编码各解一遍。"""
    check = Checker()
    print()
    print("── 2. 自动判定（无 BOM）──")

    standard = [
        ("utf8.txt", ZH.encode("utf-8"), ZH),
        ("ascii.txt", b"plain ascii text, nothing fancy.\nsecond line here.\n", None),
        ("gbk.txt", ZH.encode("gbk"), ZH),
        ("gb18030.txt", (ZH + "四字节区：㐀𠀀𪚥\n").encode("gb18030"), ZH + "四字节区：㐀𠀀𪚥\n"),
        ("big5.txt", ZH_TRAD.encode("big5"), ZH_TRAD),
        ("utf16be_nobom.txt", ZH.encode("utf-16-be"), ZH),
        ("cp1252.txt", EN.encode("cp1252"), EN),
    ]
    for name, data, want in standard:
        path = write_txt(root, name, data)
        result = extract(path)
        meta = result.metadata
        if want is None:  # 纯 ASCII：只要求逐字照抄
            want = data.decode("ascii")
        check.ok(result.markdown == expected_text(want), f"{name}：正文逐字相等",
                 repr(result.markdown[:24]))
        # cp1250 与 cp1252 在纯拉丁文本上解出来一字不差，名字归一成候选表里的 cp1252。
        round_trip = True
        try:
            round_trip = result.markdown.encode(meta["encoding"]) == data
        except (LookupError, UnicodeEncodeError):
            round_trip = False
        check.ok(round_trip, f"{name}：正文能用 {meta['encoding']} 原样还原成这串字节")
        check.ok(meta["replacementCount"] == 0, f"{name}：没有替换符",
                 str(meta["replacementCount"]))

    check.ok(extract(os.path.join(root, "ascii.txt")).metadata["encoding"] == "utf-8",
             "纯 ASCII：报 utf-8，不硬造一个 ascii")
    check.ok(extract(os.path.join(root, "utf8.txt")).metadata["encodingSource"] == "utf8",
             "UTF-8：encodingSource == utf8")
    gb = extract(os.path.join(root, "gbk.txt")).metadata
    check.ok(gb["encoding"] in ("gbk", "gb18030"), "GBK：编码名记成 gbk 或 gb18030",
             str(gb["encoding"]))
    check.ok(extract(os.path.join(root, "big5.txt")).metadata["encoding"] == "big5",
             "Big5：编码名记成 big5",
             str(extract(os.path.join(root, "big5.txt")).metadata["encoding"]))
    check.ok(extract(os.path.join(root, "cp1252.txt")).metadata["encoding"] == "cp1252",
             "CP1252：编码名归一成 cp1252",
             str(extract(os.path.join(root, "cp1252.txt")).metadata["encoding"]))
    check.ok(extract(os.path.join(root, "utf16be_nobom.txt")).metadata["encoding"] == "utf-16-be",
             "无 BOM 的 UTF-16BE：认出来了",
             str(extract(os.path.join(root, "utf16be_nobom.txt")).metadata["encoding"]))
    return check


def case_fidelity(root: str) -> Checker:
    """保真：正文除了去 BOM、换行归一、剥行尾空白，一个字都不许动。"""
    check = Checker()
    print()
    print("── 3. 保真（这条路径最重要的断言）──")

    original = (
        "    缩进四个空格的第一行，行尾跟着两个空格  \n"
        "\n"
        "\n"
        "中间隔了两个空行，上面那行不该被压掉\n"
        "行尾有制表符\t\n"
        "    再来一段缩进，行首的空白必须原样留着\n"
        "最后一行没有换行符"
    )
    path = write_txt(root, "fidelity.txt", original.encode("utf-8"))
    result = extract(path)
    check.ok(result.markdown == expected_text(original),
             "markdown == 原文（换行归一 + 逐行剥尾空白）", repr(result.markdown))
    check.ok("\n\n\n" in result.markdown, "连续空行原样保留（没压空行）")
    check.ok(result.markdown.split("\n")[0].startswith("    缩进"),
             "行首缩进原样保留（没去缩进）",
             repr(result.markdown.split("\n")[0]))
    check.ok("\t\n" not in result.markdown, "行尾制表符被剥掉")
    check.ok("  \n" not in result.markdown, "行尾空格被剥掉")
    check.ok(not result.markdown.startswith("#"), "没有加标题")
    check.ok(result.markdown.split("\n")[0] == "    缩进四个空格的第一行，行尾跟着两个空格",
             "第一行就是原文第一行", repr(result.markdown.split("\n")[0]))
    check.ok(result.markdown.split("\n")[5].startswith("    再来一段"),
             "第二处缩进也在", repr(result.markdown.split("\n")[5]))

    meta = result.metadata
    check.ok(meta["charCount"] == len(result.markdown), "charCount 是整理后正文的字符数",
             f"{meta['charCount']} vs {len(result.markdown)}")
    check.ok(meta["lineCount"] == 7, "lineCount 数得对（7 行）", str(meta["lineCount"]))
    check.ok(meta["title"] == "fidelity", "title 是文件名 stem", str(meta["title"]))
    check.ok(meta["author"] == "", "author 是空串", str(meta["author"]))
    check.ok(meta["format"] == "txt" and meta["reader"] == "txt-local",
             "format / reader 记成 txt / txt-local",
             f"{meta.get('format')} / {meta.get('reader')}")

    # 原文里带 BOM 字符时，正文开头也不能留它
    path = write_txt(root, "stray_bom.txt", b"\xef\xbb\xbf" + ZH.encode("utf-8"))
    check.ok(not extract(path).markdown.startswith("\ufeff"), "正文开头的 BOM 被去掉")
    return check


def case_newlines(root: str) -> Checker:
    """CRLF 与 CR 两种换行都归一到 LF。"""
    check = Checker()
    print()
    print("── 4. 换行 ──")

    crlf = ZH.replace("\n", "\r\n")
    path = write_txt(root, "crlf.txt", crlf.encode("utf-8"))
    result = extract(path)
    check.ok(result.markdown == expected_text(crlf), "CRLF：正文归一成 LF 且逐字相等")
    check.ok("\r" not in result.markdown, "CRLF：正文里没有残留 CR")

    cr = ZH.replace("\n", "\r")
    path = write_txt(root, "cr.txt", cr.encode("utf-8"))
    result = extract(path)
    check.ok(result.markdown == expected_text(cr), "CR：正文归一成 LF 且逐字相等")
    check.ok("\r" not in result.markdown, "CR：正文里没有残留 CR")
    return check


def case_big5_discriminator(root: str) -> Checker:
    """Big5 与 GB18030 的区分：这个提取器存在的理由。

    `獴眖衬碞⊿氨筁` 是「雨從傍就沒停過」按 Big5 存、却被当 GB18030 解出来的产物。它在
    U+4E00-9FFF 里，光看「是不是汉字」判不出来；但它在常用字表里一个都不在，占比会崩。
    """
    check = Checker()
    print()
    print("── 5. Big5 / GB18030 的区分 ──")

    truth = "雨從傍就沒停過"
    big5_bytes = truth.encode("big5")
    misread = big5_bytes.decode("gb18030")
    check.ok(misread == "獴眖衬碞⊿氨筁", "工单里那串乱码能复现出来", misread)

    good = _analyse(truth)
    bad = _analyse(misread)
    check.ok(good["commonRatio"] > COMMON_RATIO_FLOOR,
             f"正确解码的常用汉字占比过得了 {COMMON_RATIO_FLOOR} 这条线",
             f"{good['commonRatio']:.2f}")
    check.ok(bad["commonRatio"] == 0.0, "乱码一个常用字都没命中", f"{bad['commonRatio']:.2f}")
    check.ok(bad["commonRatio"] < COMMON_RATIO_FLOOR,
             f"乱码的占比落在 {COMMON_RATIO_FLOOR} 这条线下", f"{bad['commonRatio']:.2f}")
    check.ok(good["score"] > bad["score"], "正确解码的分数远高于乱码",
             f"{good['score']:.2f} vs {bad['score']:.2f}")
    check.ok(bad["score"] < MIN_SCORE, f"乱码的分数低于阈值 {MIN_SCORE}", f"{bad['score']:.2f}")
    check.ok(not _is_plausible(bad), "乱码被判为不可信（这条同时是 charset-normalizer 结论的守门）")

    # 端到端：把 charset-normalizer 挡掉，让自建打分自己判一份 Big5 文件。
    with _NoCharsetNormalizer():
        path = write_txt(root, "big5_heuristic.txt", ZH_TRAD.encode("big5"))
        result = extract(path)
        meta = result.metadata
        check.ok(result.markdown == expected_text(ZH_TRAD), "自建打分：Big5 正文逐字相等")
        check.ok(meta["encoding"] == "big5", "自建打分：判成 big5", str(meta["encoding"]))
        check.ok(meta["encodingSource"] == "heuristic", "自建打分：encodingSource == heuristic",
                 str(meta["encodingSource"]))

        path = write_txt(root, "gbk_heuristic.txt", ZH.encode("gbk"))
        meta = extract(path).metadata
        check.ok(meta["encoding"] in ("gbk", "gb18030"),
                 "自建打分：同一批候选里 GBK 不跟着 Big5 跑", str(meta["encoding"]))

        gbk_as_big5 = ZH.encode("gbk").decode("big5", "replace")
        check.ok(not _is_plausible(_analyse(gbk_as_big5)),
                 "GBK 被当 Big5 解时的产物也过不了这一关",
                 f"{_analyse(gbk_as_big5)['commonRatio']:.2f}")
    return check


def case_override(root: str) -> Checker:
    """txtEncoding 覆盖：指对了不问 BOM，指错了要说话。"""
    check = Checker()
    print()
    print("── 6. 指定编码 ──")

    gbk_path = write_txt(root, "override_src.txt", ZH.encode("gbk"))
    result = extract(gbk_path, {"txtEncoding": "gb18030"})
    meta = result.metadata
    check.ok(result.markdown == expected_text(ZH), "指对了：正文逐字相等")
    check.ok(meta["encodingSource"] == "override", "指对了：encodingSource == override",
             str(meta["encodingSource"]))
    check.ok(meta["encodingConfidence"] == 1.0, "指对了且没有替换符：confidence == 1",
             str(meta["encodingConfidence"]))
    check.ok(not result.warnings, "指对了：没有 warning", str(result.warnings))

    wrong = extract(gbk_path, {"txtEncoding": "utf-8"})
    check.ok(wrong.metadata["replacementCount"] > 0, "指错了：正文里有替换符",
             str(wrong.metadata["replacementCount"]))
    check.ok(any("按指定编码 utf-8 解码" in w and "无法解码" in w for w in wrong.warnings),
             "指错了：warning 说了「按指定编码 utf-8 解码，有 N 处无法解码」", str(wrong.warnings))
    check.ok(wrong.metadata["encodingConfidence"] == 0.0, "指错了：confidence == 0",
             str(wrong.metadata["encodingConfidence"]))

    # 指定 gbk 覆盖到一份带 BOM 的文件上：BOM 不再参与判定，但字节照样解成原文。
    bom_path = write_txt(root, "override_bom.txt", b"\xef\xbb\xbf" + ZH.encode("utf-8"))
    result = extract(bom_path, {"txtEncoding": "utf-8"})
    check.ok(result.markdown == expected_text(ZH), "覆盖模式下 BOM 也不进正文")
    check.ok(result.metadata["hasBom"] is True, "覆盖模式仍然如实记 hasBom")

    message = expect_error(lambda: extract(gbk_path, {"txtEncoding": "no-such-encoding"}))
    check.ok("txtEncoding" in message, "编码名写错：报错点到了 txtEncoding", message)

    check.ok(extract(gbk_path, {"txtEncoding": "auto"}).metadata["encodingSource"] != "override",
             "auto：仍然走自动判定")
    return check


def case_errors(root: str) -> Checker:
    """三个错误路径：二进制、空文件、全空白。"""
    check = Checker()
    print()
    print("── 7. 错误路径 ──")

    binary = write_txt(root, "binary.txt", b"\x00\x01\x02\x03" * 64)
    message = expect_error(lambda: extract(binary))
    check.ok(message != "", "含 NUL 的二进制：抛 TxtError", message)
    check.ok("不是文本文件" in message and "NUL" in message,
             "含 NUL 的二进制：说得清是 NUL 的问题", message)

    empty = write_txt(root, "empty.txt", b"")
    message = expect_error(lambda: extract(empty))
    check.ok("空文件" in message, "0 字节：报「空文件」", message)

    blank = write_txt(root, "blank.txt", "   \n\t\n  \r\n".encode("utf-8"))
    message = expect_error(lambda: extract(blank))
    check.ok("没有可读文字" in message, "全空白：报「没有可读文字」", message)

    # 只有 BOM、别的一个字都没有：解出来是空串，同上
    only_bom = write_txt(root, "only_bom.txt", b"\xef\xbb\xbf\n\n")
    message = expect_error(lambda: extract(only_bom))
    check.ok("没有可读文字" in message, "只有 BOM 与空行：报「没有可读文字」", message)
    return check


def case_forced(root: str) -> Checker:
    """全判不出：正文照给，warnings 说清原因，confidence 记 0。"""
    check = Checker()
    print()
    print("── 8. 判不出来时的「部分内容 + 报错」──")

    # 每个候选都解不开的字节：0x7F 不是任何一个中日韩编码的合法尾字节，0x81/0x8D/0x90
    # 在 cp1252 里没有定义。长度取单数，连 utf-16 两档都进不了候选。
    junk = bytes([0x81, 0x7F, 0x8D, 0xFF, 0x90, 0x1F, 0x81, 0x2E] * 40) + b"\x81"
    path = write_txt(root, "junk.txt", junk)
    result = extract(path)
    meta = result.metadata
    check.ok(bool(result.markdown), "全判不出：仍然返回正文", f"{len(result.markdown)} 字符")
    check.ok(meta["replacementCount"] > 0, "全判不出：正文里有替换符",
             str(meta["replacementCount"]))
    check.ok(meta["encodingSource"] == "forced", "全判不出：encodingSource == forced",
             str(meta["encodingSource"]))
    check.ok(meta["encodingConfidence"] == 0, "全判不出：encodingConfidence == 0",
             str(meta["encodingConfidence"]))
    check.ok(len(result.warnings) == 1, "全判不出：只留一条 warning", str(result.warnings))
    check.ok(any("无法判定编码" in w for w in result.warnings), "全判不出：warning 直说无法判定编码",
             str(result.warnings))
    check.ok(any("尽力解码" in w and str(meta["replacementCount"]) in w for w in result.warnings),
             "全判不出：warning 里写了按谁解、含几处替换符", str(result.warnings))

    # 第二种「判不出」：解得开、但常用汉字占比低得不像话（全篇生僻字）。
    rare = write_txt(root, "rare.txt", "㐀㐁㐂㐃㐄㐅㐆\n".encode("gb18030"))
    result = extract(rare)
    check.ok(result.metadata["encodingSource"] == "forced", "全篇生僻字：也算判不出",
             str(result.metadata["encodingSource"]))
    check.ok(any("常用汉字占比" in w for w in result.warnings),
             "全篇生僻字：warning 点出常用汉字占比过低", str(result.warnings))
    return check


def case_registry(root: str) -> Checker:
    """接线：格式清单与提取器注册表都得认 .txt。"""
    check = Checker()
    print()
    print("── 9. 接线 ──")

    check.ok(formats.TYPE_BY_EXT.get(".txt") == "txt", "formats.json 里 .txt -> txt",
             str(formats.TYPE_BY_EXT.get(".txt")))
    check.ok(formats.category_of(".txt") == "ebook", "粗类是 ebook（本地提取，不走云端）",
             str(formats.category_of(".txt")))
    check.ok(isinstance(get_extractor("txt", {}), TxtExtractor), "get_extractor('txt') 拿到 TxtExtractor")

    # 扩展名大小写：main.py 用小写后缀查清单，这里确认它认 UTf 混写
    path = write_txt(root, "Case.TXT", ZH.encode("utf-8"))
    check.ok(extract(path).markdown == expected_text(ZH), "大写扩展名照样能解")
    check.ok(extract(path).metadata["title"] == "Case", "title 取的是 stem，不带扩展名")
    return check


def self_test() -> int:
    print("TXT 提取器自测（造样本真跑，含 Big5 / GB18030 的区分）")

    def run(root: str) -> int:
        total = Checker()
        for case in (case_bom, case_autodetect, case_fidelity, case_newlines,
                     case_big5_discriminator, case_override, case_errors, case_forced,
                     case_registry):
            check = case(root)
            total.passed += check.passed
            total.failed += check.failed
        return total.summary()

    return with_temp(run)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        sys.argv.append("--selftest")

    if "--selftest" in sys.argv:
        sys.exit(self_test())

    print(__doc__)
    print("用法：python test/selftest_v10_txt.py")
