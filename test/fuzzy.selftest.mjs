// 设置页搜索的模糊匹配自测（纯逻辑，不碰 DOM）。
//
//   node test/fuzzy.selftest.mjs
//
// 只测 ui/assets/fuzzy.js：页面上的显隐、折叠、空态都由人看，这一层保证
// 「什么算命中」不退化成什么都命中或什么都不命中。

import { normalizeText, parseQuery, isSubsequence, tokenMatches, matchesTokens, matchesTokensExact, highlightRanges } from "../ui/assets/fuzzy.js";

let pass = 0;
const fails = [];

function check(name, actual, expected) {
  if (Object.is(actual, expected)) {
    pass += 1;
  } else {
    fails.push(`${name}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
  }
}

// 归一化：全角转半角、去空白、去标点、转小写
check("NFKC 全角转半角", normalizeText("ＧＢＫ"), "gbk");
check("去空白", normalizeText(" PDF  切割 "), "pdf切割");
check("去中文标点", normalizeText("「自动」、GBK；Big5。"), "自动gbkbig5");
check("转小写", normalizeText("SaveJson"), "savejson");
check("空值不炸", normalizeText(null), "");

// 分词：半角空格与全角空格都算分隔符
check("空格分词", JSON.stringify(parseQuery("pdf 切")), JSON.stringify(["pdf", "切"]));
check("全角空格也能分", JSON.stringify(parseQuery("后端\u3000降级")), JSON.stringify(["后端", "降级"]));
check("空查询得到空数组", JSON.stringify(parseQuery("   ")), JSON.stringify([]));

// 子序列
check("子序列命中", isSubsequence("pdf切割", "pdf切"), true);
check("子序列要讲顺序", isSubsequence("pdf切割", "切pdf"), false);
check("空针命中", isSubsequence("abc", ""), true);

// 单词命中：子串优先，两字以上才允许子序列
const enc = normalizeText("纯文本编码 解 .txt 时按它读。保持「自动」会先看 BOM，再按常用字占比猜 GBK / Big5");
check("子串命中中文", tokenMatches(enc, "编码"), true);
check("子串命中编码名", tokenMatches(enc, "big5"), true);
check("子串命中 gb18030 不存在时不该命中", tokenMatches(enc, "gb18030"), false);
check("两字子序列命中", tokenMatches(enc, "文本编"), true);
check("隔字子序列命中", tokenMatches(enc, "纯编"), true);
check("两字允许子序列", tokenMatches(normalizeText("abc"), "ac"), true);
check("单字只走子串", tokenMatches(normalizeText("abc"), "x"), false);
check("单字子串照常命中", tokenMatches(normalizeText("abc"), "b"), true);
check("完全不相干的词不命中", tokenMatches(enc, "并发"), false);

// 多词是 AND
const chain = normalizeText("PDF 后端降级链 勾选要启用的后端 按住任意一行上下拖就能调顺序 云端 本地");
check("多词全中", matchesTokens(chain, parseQuery("pdf 降级")), true);
check("多词有一词不中就不算", matchesTokens(chain, parseQuery("pdf 并发")), false);
check("空查询不过滤", matchesTokens(chain, []), true);

// 真实字段：saveJson 的 key 与标题都能搜到
const save = normalizeText("saveJson 保存 JSON 与 Markdown 同名文件，方便别的程序直接读结构化结果");
check("按 key 搜", matchesTokens(save, parseQuery("savejson")), true);
check("按 key 首字母子序列搜", matchesTokens(save, parseQuery("sj")), true);
check("按中文标题搜", matchesTokens(save, parseQuery("保存")), true);
check("按说明里的词搜", matchesTokens(save, parseQuery("结构化")), true);

// 中文串不该被英文单字误伤
check("中文文本不吃英文单字子序列", matchesTokens(normalizeText("并发与重试 最多同时跑几个"), parseQuery("xy")), false);

// 精确与模糊分两档：精确的算数（计数/高亮/跳转），模糊的只显示
const hints = normalizeText("MinerU 最大文件大小 无 Token 时走 Flash 模式");
check("精确：子串算精确", matchesTokensExact(hints, parseQuery("mineru")), true);
check("精确：子序列不算精确", matchesTokensExact(hints, parseQuery("mru")), false);
check("模糊：子序列仍算命中", matchesTokens(hints, parseQuery("mru")), true);
check("精确：多词都冲才算", matchesTokensExact(hints, parseQuery("mineru token")), true);
check("精确：有一词模糊就不算", matchesTokensExact(hints, parseQuery("mineru mru")), false);
check("精确：空查询不过滤", matchesTokensExact(hints, []), true);

// ── 高亮区间：要把归一化后的命中位置映回原文下标 ──
const rng = (text, query) => JSON.stringify(highlightRanges(text, parseQuery(query)));
check("高亮整段中文", rng("纯文本编码", "编码"), JSON.stringify([[3, 5]]));
check("高亮跳过分词后仍能映回位置", rng("SaveJson", "save"), JSON.stringify([[0, 4]]));
check("高亮跳过标点与空格", rng("PDF 切割", "pdf切"), JSON.stringify([[0, 5]]));
check("高亮认全角字", rng("ＧＢＫ 编码", "gbk"), JSON.stringify([[0, 3]]));
check("两个词各标一段", rng("PDF 后端降级链", "pdf 降级"), JSON.stringify([[0, 3], [6, 8]]));
check("重叠区间合开", rng("文本编码", "编码 码"), JSON.stringify([[2, 4]]));
check("没有命中就没有区间", rng("文本编码", "并发"), JSON.stringify([]));
check("空查询不涂色", rng("文本编码", "  "), JSON.stringify([]));
check(
  "跨度太大的子序列拆成单字",
  rng("abcdefghijklmnopqrstuvwxyz", "az"),
  JSON.stringify([[0, 1], [25, 26]]),
);
check("映回下标不越界", highlightRanges("编码", parseQuery("编码")).every(([, end]) => end <= 2), true);

if (fails.length) {
  console.error(`通过 ${pass} 项，失败 ${fails.length} 项`);
  for (const line of fails) console.error("  ✗ " + line);
  process.exit(1);
}
console.log(`通过 ${pass} 项，失败 0 项`);
