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

/** 一个词是否「精确」命中：只认同为归一化后的子串。
 *  设置搜索里精确与模糊要分开：精确的才算数（计数、高亮、箭头跳转），
 *  模糊的只让人看得见，不参与这三件事。 */
export function tokenMatchesExact(hay, token) {
  if (!token) return true;
  return hay.includes(token);
}

/** 所有词都精确命中（AND）。 */
export function matchesTokensExact(hay, tokens) {
  if (!tokens || tokens.length === 0) return true;
  return tokens.every((token) => tokenMatchesExact(hay, token));
}

/** 一个词是否命中一段归一化文本（子串优先，两个字以上再退到子序列）。 */
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

// ---------------------------------------------------------------- 高亮

/**
 * 把原文折成「可搜索串」并记下每个字符在原文里的下标。
 * 高亮要把归一化后的命中位置映回原文，所以不能直接用 normalizeText——它会把
 * 长度改掉。这里逐字符折叠，标点与空白不产生字符，但映射表照样跳过去。
 */
export function foldText(text) {
  const src = String(text == null ? "" : text);
  let folded = "";
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    const piece = src[i].normalize("NFKC").toLowerCase().replace(NOISE, "");
    for (const ch of piece) {
      folded += ch;
      map.push(i);
    }
  }
  return { folded, map };
}

// 子序列命中跨度超过这个长度就不画成一整段——那会把半个句子涂上颜色，
// 看起来像选中而不是命中。改成把命中的字各点一个，退一步但读得懂。
const MAX_SPAN = 12;
const MAX_RANGES = 8;

function pushRange(out, start, end) {
  if (end <= start) return;
  if (out.length >= MAX_RANGES) return;
  out.push([start, end]);
}

/** range 跨 token 时会乱序，画之前必须先排序合开——
 *  DOM 切口要求升序且互不重叠，否则 slice 会把文字切丢。 */
function sortRanges(out) {
  const sorted = out.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.slice(0, MAX_RANGES);
}

/**
 * 一段原文里要被高亮的下标区间（左闭右开，按原文下标）。
 * 规则与 tokenMatches 一致：先子串，不成再子序列；单字不走子序列。
 */
export function highlightRanges(original, tokens) {
  const src = String(original == null ? "" : original);
  if (!src || !tokens || tokens.length === 0) return [];
  const { folded, map } = foldText(src);
  if (!folded) return [];

  const out = [];
  for (const token of tokens) {
    if (!token) continue;
    let hit = folded.indexOf(token);
    if (hit !== -1) {
      while (hit !== -1) {
        pushRange(out, map[hit], map[hit + token.length - 1] + 1);
        hit = folded.indexOf(token, hit + token.length);
        if (out.length >= MAX_RANGES) break;
      }
      continue;
    }
    if (token.length < 2) continue;

    const pos = [];
    let at = 0;
    let ok = true;
    for (const ch of token) {
      at = folded.indexOf(ch, at);
      if (at === -1) { ok = false; break; }
      pos.push(at);
      at += 1;
    }
    if (!ok || pos.length === 0) continue;

    const span = map[pos[pos.length - 1]] + 1 - map[pos[0]];
    if (span <= MAX_SPAN) {
      pushRange(out, map[pos[0]], map[pos[pos.length - 1]] + 1);
      continue;
    }
    // 跨度太大：把连续的字合并成短段，落单的字各自标一个
    let runStart = pos[0];
    let runEnd = pos[0];
    for (let i = 1; i < pos.length; i += 1) {
      if (pos[i] === runEnd + 1) {
        runEnd = pos[i];
        continue;
      }
      pushRange(out, map[runStart], map[runEnd] + 1);
      runStart = pos[i];
      runEnd = pos[i];
    }
    pushRange(out, map[runStart], map[runEnd] + 1);
    if (out.length >= MAX_RANGES) break;
  }
  return sortRanges(out);
}
