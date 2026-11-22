// ui/assets/fuzzy.js — 设置页搜索用的模糊匹配。
//
// 纯函数，不碰 DOM：单测可以直接在 node 里 import 这个文件跑（见 test/fuzzy.selftest.mjs）。
//
// 匹配规则，宽松到刚好够用：
//   · 归一化：NFKC、转小写、去掉空白与常见中英标点。中文没有词边界，空格分词由调用方负责。
//   · 单个字符的查询只做子串匹配——一个字做子序列匹配会把整页都命中。
//   · 两个字符以上先试子串，再退到子序列：`pdf切` 能命中「PDF 切割」，
//     `sy` 能命中「saveJson」，`gbk` 能命中「GB18030 / GBK」。
// 不做拼音、不做编排序——顺序由调用方按文档顺序保留，设置项的位置感比相关度更重要。

const NOISE = /[\s\u3000()（）[\]【】「」《》、，,。.:：;；!！?？"'“”‘’·—\-_/\\|@#$%^&*+=~`]+/g;

export function normalizeText(text) {
  return String(text == null ? "" : text).normalize("NFKC").toLowerCase().replace(NOISE, "");
}

/** 「后端 降级」→ ["后端", "降级"]，已归一化。空查询得到空数组。 */
export function parseQuery(raw) {
  return String(raw == null ? "" : raw)
    .split(/[\s\u3000]+/)
    .map(normalizeText)
    .filter(Boolean);
}

export function isSubsequence(hay, needle) {
  if (!needle) return true;
  let at = 0;
  for (const ch of needle) {
    at = hay.indexOf(ch, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** 一个词是否命中一段归一化文本。 */
export function tokenMatches(hay, token) {
  if (!token) return true;
  if (hay.includes(token)) return true;
  if (token.length < 2) return false;
  return isSubsequence(hay, token);
}

/** 所有词都要命中（AND）。空 tokens 视为不过滤。 */
export function matchesTokens(hay, tokens) {
  if (!tokens || tokens.length === 0) return true;
  return tokens.every((token) => tokenMatches(hay, token));
}
