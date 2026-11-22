"""TXT 提取器（纯文本：编码未知，正文一字不改，判不准就明说）

这条路存在的唯一理由是**判定编码**。Hana 自带的 read 工具实测：UTF-8 / GBK / GB18030
都对，Big5 解出来是另一套「看着像中文」的字而且不报错，UTF-16 带 BOM 也乱。所以这里的
重点不在解析，而在「这段字节到底该按哪个编码念」。

判定顺序（前面的命中就不往后走）：

  1. BOM。utf-32 的 BOM 以 utf-16 的 BOM 为前缀（`FF FE 00 00` 的前两字节就是 `FF FE`），
     所以必须先判 utf-32，否则每个 UTF-32LE 文件都会被当成 UTF-16LE 解出一串带 NUL 的字符。
  2. NUL 字节。占比超过 1% 就不像文本了，但无 BOM 的 UTF-16 恰好满篇 NUL（ASCII 与
     换行都是一半字节为零），所以这时不直接报二进制，而是只让 utf-16 两档去试：解出来
     自洽就用它，一个都不自洽才报「不是文本文件」。
  3. UTF-8 严格解码。能过就是 utf-8；纯 ASCII 也报 utf-8，不硬造一个 ascii 出来。
  4. charset-normalizer（有就用在它给结论且结论自洽的时候，没有就跳过，不是硬依赖）。
  5. 自建打分。候选逐个 `errors="strict"` 解，解不开的直接淘汰；解开的按分数取最高。
     分数由四类信号构成：常用汉字命中（正）、控制符/替换符/私用区（重负）、
     CJK 扩展 A/B 与全角符号（负）、可打印 ASCII 与拉丁字母（正）。
  6. 都不自洽（全解不开，或最高分低于阈值，或常用汉字占比低得不像话）：取分数最高者用
     `errors="replace"` 解，**照常返回正文**，warnings 里说清楚，confidence 记 0。

第 5 步里「常用汉字占比」是这套东西的关键。Big5 的字节几乎总能被 GB18030 解开（GBK 的
尾字节范围覆盖了 Big5 的尾字节），解出来是一堆生僻字，例如 `獴眖衬碞⊿氨筁`。这些字全在
U+4E00-9FFF 里，光看「是不是汉字」判不出来；但它们在三百字常用表里一个都不在，占比会从
正常中文的 0.6 以上掉到 0.05 以下。所以常用表是**双份**的：简体高频字一份，繁体高频字
一份（繁体文本的「這、來、個、們」在简体表里查不到，只留简体表会把 Big5 文本判成低分）。

正文只做三件不改字的事：去 BOM、`CRLF`/`CR` 统一成 `LF`、剥行尾空白（空格与制表符）。
不加标题、不合并段落、不去缩进、不压空行——用户要的是原文，不是一份排版。
"""
from __future__ import annotations

import codecs
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .base import BaseExtractor, ExtractionResult

#: 打分候选（顺序即并列时的优先级）。utf-16 两档放在最后：没有 BOM 时它们只能靠「解出来
#: 像不像话」和分数取胜，而中文写成的 UTF-16 里一个 NUL 都没有，不放进候选就永远认不出。
CANDIDATES = ("gb18030", "big5", "shift_jis", "euc_kr", "cp1252", "utf-16-le", "utf-16-be")

#: utf-16 两档要求字节数为偶数：奇数长度的字节流不可能是 UTF-16。
_UTF16_CANDIDATES = frozenset({"utf-16-le", "utf-16-be"})

#: BOM -> 编码。**顺序有意义**：utf-32 的 BOM 以 utf-16 的 BOM 为前缀，长的必须排前面。
BOM_TABLE = (
    (b"\x00\x00\xfe\xff", "utf-32-be"),
    (b"\xff\xfe\x00\x00", "utf-32-le"),
    (b"\xef\xbb\xbf", "utf-8-sig"),
    (b"\xff\xfe", "utf-16-le"),
    (b"\xfe\xff", "utf-16-be"),
)

#: NUL 占比超过这个数就当二进制（UTF-16 的判定在这个门之前完成，见模块头）。
NUL_RATIO_LIMIT = 0.01

#: 打分阈值：最高分低于它就不是「判出来了」，而是「挑了个最不坏的」。
MIN_SCORE = 0.15

#: 汉字文本里，常用字的占比低于这个数就不像正常文本（Big5 被当 GB18030 解时约 0.01–0.07）。
COMMON_RATIO_FLOOR = 0.25

#: 汉字密度到这个数以上，才拿常用字占比去要求它（纯英文/代码不需要过这一关）。
HANZI_DENSITY_FLOOR = 0.10

#: 假名密度到这个数以上就按日文看，不再拿中文常用字表要求它。
KANA_DENSITY_CEILING = 0.05

#: 替换符 + 控制符 + 私用区合起来的占比上限。
MALFORMED_CEILING = 0.02

#: 打分只看前这么多字符：编码在整个文件里是同一套，按文件大小线性变慢没有意义。
SCORE_SAMPLE_CHARS = 200_000

#: 简体的高频常用字（约 300）。按使用频率排，靠前的覆盖率高得多。
COMMON_HANZI = frozenset(
    "的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自"
    "之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其"
    "些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关"
    "点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月"
    "话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几"
    "口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期"
    "市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难"
)

#: 繁体的高频常用字。简体表里的「的、是、一」在繁体文本里同样高频，但「這、來、個、們、
#: 為、國」这些在简体表里查不到；不补这一份，一份正常的 Big5 文本会被判成「常用字太少」。
TRADITIONAL_COMMON = frozenset(
    "這個們來為國時說會對後點電實現經濟學體發樣問間關頭長門東車馬鳥魚雲書畫筆見讓認識語讀寫"
    "聽開麼進還運動員將無與萬廣歡嚴靈願場兩從導層屬歲師帶幫幾張強歸當盡監盤確種稱穩窮節範"
)

_COMMON = COMMON_HANZI | TRADITIONAL_COMMON

#: 每个字符类别的分值。正分是「正常文本该有的」，负分是「念错了才会冒出来的」。
WEIGHTS = {
    "common": 1.0,        # 常用汉字：区分 GB18030 / Big5 的主力
    "cjk": 0.12,          # 其余 U+4E00-9FFF：是汉字，但不足以证明念对了
    "kana": 0.6,          # 假名：日文就这样
    "hangul": 0.5,        # 谚文：韩文就这样
    "punct": 0.05,        # 中文标点与通用标点：正常但不加分的事
    "ascii": 0.18,        # 可打印 ASCII：英文、代码、数字
    "latin": 0.15,        # 拉丁补充区：西欧文本
    "ext_a": -0.6,        # CJK 扩展 A：念错了才会成片出现
    "ext_b": -0.8,        # 扩展 B 及以上
    "fullwidth": -0.6,    # 全角符号区
    "pua": -1.5,          # 私用区：几乎只出现在「字节对不上码表」的时候
    "replacement": -2.0,  # 替换符
    "control": -3.0,      # 控制符（\t \n \r 之外的）
    "symbol": -0.35,      # 数学/其它符号：`⊿` 这类念错的痕迹
}


class TxtError(RuntimeError):
    """TXT 读不成时抛这个：main.py 会把它折进结构化错误，不会吐 traceback。"""


@dataclass
class _Guess:
    """一次判定结果。warnings 是这条判定要补进 result.warnings 的话。"""

    encoding: str
    text: str
    source: str
    confidence: float
    warnings: list[str] = field(default_factory=list)


# ── 字节层 ──────────────────────────────────────────────────────────────


def _detect_bom(data: bytes) -> tuple[str, int] | None:
    """认 BOM，返回 (编码, BOM 字节数)。长的排前面由 BOM_TABLE 保证。"""
    for bom, encoding in BOM_TABLE:
        if data.startswith(bom):
            return encoding, len(bom)
    return None


def _nul_ratio(data: bytes) -> float:
    return data.count(0) / len(data) if data else 0.0


# ── 字符层 ──────────────────────────────────────────────────────────────


def _sample(text: str) -> str:
    """打分用的样本：开头那一段。编码在文件里是同一套，不必整篇过一遍。"""
    return text if len(text) <= SCORE_SAMPLE_CHARS else text[:SCORE_SAMPLE_CHARS]


def _char_class(ch: str) -> Optional[str]:
    """这个字属于哪个打分类别；不给分也不扣分的返回 None。"""
    if ch in _COMMON:
        return "common"
    code = ord(ch)
    if 0x4E00 <= code <= 0x9FFF:
        return "cjk"
    if 0x3040 <= code <= 0x30FF:
        return "kana"
    if 0xAC00 <= code <= 0xD7A3:
        return "hangul"
    if 0x3400 <= code <= 0x4DBF:
        return "ext_a"
    if 0xE000 <= code <= 0xF8FF or code >= 0xF0000:
        return "pua"
    if code >= 0x20000:
        return "ext_b"
    if 0xFF00 <= code <= 0xFFEF:
        return "fullwidth"
    if ch == "\ufffd":
        return "replacement"
    if code < 0x20 and ch not in "\t\n\r":
        return "control"
    if 0x20 <= code <= 0x7E:
        return "ascii"
    if 0xA0 <= code <= 0xFF:
        return "latin"
    if 0x3000 <= code <= 0x303F or 0x2000 <= code <= 0x206F:
        return "punct"
    if unicodedata.category(ch) in ("Sm", "So", "Sk"):
        return "symbol"
    return None


def _analyse(text: str) -> dict:
    """数一遍各类字符，给出分数与两个比例。空文本给一个「什么都不是」的零分结果。"""
    counts = dict.fromkeys(WEIGHTS, 0)
    for ch in text:
        cls = _char_class(ch)
        if cls:
            counts[cls] += 1
    length = len(text)
    if length == 0:
        return {
            "length": 0, "score": 0.0, "hanziDensity": 0.0, "kanaDensity": 0.0,
            "commonRatio": 0.0, "malformedRatio": 0.0, **counts,
        }
    hanzi = counts["common"] + counts["cjk"] + counts["ext_a"] + counts["ext_b"]
    malformed = counts["replacement"] + counts["control"] + counts["pua"]
    return {
        "length": length,
        "score": sum(WEIGHTS[key] * value for key, value in counts.items()) / length,
        "hanziDensity": hanzi / length,
        "kanaDensity": counts["kana"] / length,
        "commonRatio": counts["common"] / hanzi if hanzi else 0.0,
        "malformedRatio": malformed / length,
        **counts,
    }


def _problems(metrics: dict) -> list[str]:
    """这段文本为什么不像「正常地念出来了」。空列表就是没问题。"""
    reasons: list[str] = []
    if metrics["malformedRatio"] > MALFORMED_CEILING:
        reasons.append(
            f"替换符/控制符/私用区占 {metrics['malformedRatio']:.2f}，高于 {MALFORMED_CEILING}"
        )
    hanzi_text = (
        metrics["hanziDensity"] >= HANZI_DENSITY_FLOOR
        and metrics["kanaDensity"] < KANA_DENSITY_CEILING
    )
    if hanzi_text and metrics["commonRatio"] < COMMON_RATIO_FLOOR:
        reasons.append(
            f"常用汉字占比 {metrics['commonRatio']:.2f}，低于 {COMMON_RATIO_FLOOR}"
        )
    return reasons


def _is_plausible(metrics: dict) -> bool:
    return not _problems(metrics) and metrics["score"] >= MIN_SCORE


def _confidence_from_score(score: float) -> float:
    """打分路径的置信度：0.45 起，随分数涨，封顶 0.9（它是启发式，不给满分）。"""
    return round(min(0.9, max(0.0, 0.45 + score)), 3)


# ── 编码判定 ────────────────────────────────────────────────────────────


def _charset_normalizer_guess(data: bytes) -> Optional[_Guess]:
    """问 charset-normalizer。没装、给不出结论、或者结论自相矛盾时返回 None。

    第三条是关键：它是 8 位编码的猜测器，对 GB18030 / Big5 这一对偶尔会认错。认错的表现
    就是解出一片生僻字——那正好是 _problems() 能认出来的形状。所以它给的结论要过一遍
    同一把尺子，过不了就让位给自建打分，而不是照抄一个错答案。
    """
    try:
        from charset_normalizer import from_bytes
    except ImportError:
        return None
    try:
        best = from_bytes(data).best()
        if best is None or not getattr(best, "encoding", None):
            return None
        encoding = codecs.lookup(best.encoding).name
        text = str(best)
    except (LookupError, UnicodeError, ValueError):
        return None
    if not text or not _is_plausible(_analyse(_sample(text))):
        return None

    # 报个规范名：某个候选编码解出来跟它一字不差时，就报那个名字。cp1250 与 cp1252 在纯
    # 拉丁文本上解出来完全一样（欧元/引号/é 都一样），报哪个都不算错；报候选表里的那个，
    # metadata 的名词就仍然是有限的几个，而不是随第三方库的偏好漂。
    for candidate in CANDIDATES:
        if candidate in _UTF16_CANDIDATES and len(data) % 2:
            continue
        try:
            if data.decode(candidate) == text:
                encoding = candidate
                break
        except UnicodeDecodeError:
            continue

    chaos = min(max(float(getattr(best, "chaos", 0.0) or 0.0), 0.0), 1.0)
    coherence = min(max(float(getattr(best, "coherence", 0.0) or 0.0), 0.0), 1.0)
    return _Guess(
        encoding=encoding,
        text=text,
        source="charset-normalizer",
        confidence=round((1.0 - chaos) * (0.5 + 0.5 * coherence), 3),
    )


def _rank_candidates(data: bytes) -> _Guess:
    """自建打分：先淘汰解不开的，再按分数取最高；都不可信就用最高分强解并报错。"""
    scored: list[tuple[str, str, bool, dict]] = []
    for encoding in CANDIDATES:
        if encoding in _UTF16_CANDIDATES and len(data) % 2:
            continue
        try:
            text = data.decode(encoding)
            strict = True
        except UnicodeDecodeError:
            text = data.decode(encoding, "replace")
            strict = False
        scored.append((encoding, text, strict, _analyse(_sample(text))))

    if not scored:  # 只可能是空文件，调用方先拦了；留着防御
        raise TxtError("没有可用的候选编码")

    survivors = [item for item in scored if item[2]]
    pool = survivors or scored
    # max 在并列时保留先出现的那个，所以 CANDIDATES 的顺序就是并列时的优先级。
    best_encoding, best_text, best_strict, best_metrics = max(pool, key=lambda item: item[3]["score"])
    runner_up = max(
        (item for item in pool if item[0] != best_encoding),
        key=lambda item: item[3]["score"],
        default=None,
    )

    if best_strict and _is_plausible(best_metrics):
        return _Guess(
            encoding=best_encoding,
            text=best_text,
            source="heuristic",
            confidence=_confidence_from_score(best_metrics["score"]),
        )

    # 到这里就是「判不出来」：正文照给，说清楚为什么。
    reasons: list[str] = []
    if not survivors:
        reasons.append("全部候选都解不开（strict 解码失败）")
    else:
        if best_metrics["score"] < MIN_SCORE:
            reasons.append(f"最高分 {best_metrics['score']:.2f}，低于 {MIN_SCORE}")
        reasons.extend(_problems(best_metrics))
    detail = "；".join(reasons) or "候选之间分不出高下"
    # best_text 对解不开的候选本来就是 errors="replace" 的结果，对解得开的就是原文。
    replacements = best_text.count("\ufffd")
    tail = (
        f"正文含 {replacements} 处替换符"
        if replacements
        else "正文没有替换符，但解码结果不像正常文本"
    )
    note = (
        f"无法判定编码：候选 {' / '.join(CANDIDATES)} 都不自洽（{detail}），"
        f"已按 {best_encoding} 尽力解码，{tail}"
    )
    if runner_up is not None:
        note += f"；次高分是 {runner_up[0]}（{runner_up[3]['score']:.2f}）"
    return _Guess(
        encoding=best_encoding,
        text=best_text,
        source="forced",
        confidence=0.0,
        warnings=[note],
    )


def _resolve_auto(data: bytes, name: str) -> _Guess:
    """没有 BOM、也没有指定编码时的完整判定链。"""
    if _nul_ratio(data) > NUL_RATIO_LIMIT:
        # 满篇 NUL 只可能是两件事：UTF-16（ASCII 正文一半字节为零），或者根本不是文本。
        # 候选打分里 utf-16 之外的编码都会把 NUL 数成控制符，落在「不像文本」那一边，
        # 所以直接让打分去分，它自洽就用它，它也说不出所以然就按二进制报错。
        guess = _rank_candidates(data)
        if guess.source == "forced":
            raise TxtError(f"《{name}》不是文本文件（含 NUL 字节）")
        return guess

    try:
        return _Guess("utf-8", data.decode("utf-8"), "utf8", 1.0)
    except UnicodeDecodeError:
        pass

    guess = _charset_normalizer_guess(data)
    if guess is not None:
        return guess

    return _rank_candidates(data)


# ── 正文整理 ────────────────────────────────────────────────────────────


def _normalise(text: str) -> str:
    """只做三件不改字的事：去 BOM、换行统一成 LF、剥行尾空白。

    行尾只剥空格与制表符：缩进在行首，不受影响；空行原样留着。硬换行也不合并——
    Markdown 的软换行本来就不成段，读者看到的还是通顺的段落。
    """
    if text.startswith("\ufeff"):
        text = text[1:]
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip(" \t") for line in text.split("\n"))


def _count_lines(text: str) -> int:
    """行数：按 LF 数，末尾没有换行时最后一行也算一行。"""
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def _override_codec(settings: Optional[dict]) -> str:
    """读 settings.txtEncoding。auto 或空 → 空串（走自动判定）。"""
    raw = str((settings or {}).get("txtEncoding") or "auto").strip()
    if not raw or raw.lower() == "auto":
        return ""
    try:
        return codecs.lookup(raw).name
    except LookupError as exc:
        raise TxtError(
            f"设置里的 txtEncoding 不是可用的编码名：{raw}"
            f"（可选 auto / utf-8 / gb18030 / gbk / big5 / shift_jis / euc-kr / cp1252 / utf-16-le / utf-16-be）"
        ) from exc


# ── 提取器 ──────────────────────────────────────────────────────────────


class TxtExtractor(BaseExtractor):
    """TXT 提取器：一份纯文本字节流 -> 一份逐字照抄的 Markdown。"""

    name = "txt"

    def extract(
        self,
        source: str,
        output_dir: Optional[str] = None,
        page_range: Optional[str] = None,
        language: str = "zh",
        include_images: bool = True,
        **kwargs,
    ) -> ExtractionResult:
        path = self._check_file_exists(source)
        name = path.name
        result = ExtractionResult()

        data = path.read_bytes()
        if not data:
            raise TxtError(f"《{name}》是空文件")

        override = _override_codec(self.settings)
        bom = _detect_bom(data)
        if override:
            guess = self._decode_override(data, override)
        elif bom:
            guess = self._decode_bom(data, bom, name)
        else:
            guess = _resolve_auto(data, name)

        text = _normalise(guess.text)
        if not text.strip():
            raise TxtError(f"《{name}》里没有可读文字")

        replacements = text.count("\ufffd")
        warnings = list(guess.warnings)
        if guess.source == "override" and replacements:
            warnings.append(f"按指定编码 {guess.encoding} 解码，有 {replacements} 处无法解码")
        if guess.source == "bom" and replacements:
            warnings.append(
                f"BOM 声明的是 {guess.encoding}，按它解码有 {replacements} 处对不上，"
                f"正文里这些位置是替换符"
            )

        result.markdown = text
        result.warnings = warnings
        result.metadata = {
            "format": "txt",
            "reader": "txt-local",
            "title": path.stem,
            "author": "",
            "encoding": guess.encoding,
            "encodingSource": guess.source,
            "encodingConfidence": round(guess.confidence, 3),
            "hasBom": bom is not None,
            "charCount": len(text),
            "lineCount": _count_lines(text),
            "replacementCount": replacements,
        }
        return result

    # ── 两条特殊入口 ────────────────────────────────────────────────────

    @staticmethod
    def _decode_bom(data: bytes, bom: tuple[str, int], name: str) -> _Guess:
        """有 BOM：按 BOM 说的编码解，不再猜。

        BOM 是文件自己写的声明，它比任何启发式都可信。唯一的例外是字节流根本不满足这个
        编码（声明 utf-16 却给了一段奇数长度的字节）：这时按声明强解，并让 confidence 归零，
        因为它已经自相矛盾了。
        """
        encoding, length = bom
        try:
            return _Guess(encoding, data[length:].decode(encoding), "bom", 1.0)
        except UnicodeDecodeError:
            return _Guess(encoding, data[length:].decode(encoding, "replace"), "bom", 0.0)

    @staticmethod
    def _decode_override(data: bytes, codec: str) -> _Guess:
        """用户指定了编码：直接按它解，不再判 BOM 与候选。

        指定编码是用户对字节的担保，所以这里连「NUL 占比超标就是二进制」都不拦——把
        txtEncoding 设成 utf-16-le 的人，手里就是一份带大量 NUL 的 ASCII 正文。
        解出替换符不报错，但要说一句：正文里那些位置真的解不开。
        """
        text = data.decode(codec, "replace")
        return _Guess(codec, text, "override", 1.0 if "\ufffd" not in text else 0.0)
