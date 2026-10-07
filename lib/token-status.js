// Token 健康状态：存、读、判、说，四处口径都收在这里。
//
// 为什么要有这一层：同一件事实有三个消费者 —— 设置页顶部那条横幅、返回给 agent 的
// 提示、以及"现在该不该去探一次"的节拍判断。三处各写一遍迟早会不一致，所以判定收成
// 一组纯函数，界面和工具都调它。
//
// 为什么不申请定时任务：这个 App 是按需唤醒的进程，它没有自己的作息。真正的定时探测
// 要向宿主多要一个能力（app/tasks.manage），为一个配置健康检查多要一次授权确认不划算。
// 改成挂在三个已有的触点上：真实提取留下的证据、打开设置页、以及每次工具调用时顺手看
// 一眼距上次探测多久了。用户没在用的那段时间，本来也不需要有人给他报信。
//
// 一条纪律：没证据时不说"失效"。这个文件里所有"失效"都来自一次真实的探测或一次真实
// 的鉴权拒绝，不做推测。

import { createHash } from "node:crypto";

import { DEFAULT_PDF_BACKEND_CHAIN, parseCredentials, parseTokens } from "./settings.js";
import { validateMineruToken, validatePaddleToken, validateTokenList } from "./validate.js";

// 存储键与两个时间窗。
// GREEN_TTL_MS：绿灯的保质期。三周前测出来"有效"不能当今天的有效用。
// PROBE_INTERVAL_MS：距上次真实探测超过这个时间，下次工具调用顺手补探一次。
export const STORAGE_KEY = "tokenStatus";
export const GREEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROBE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// 两把 Token 字段。missingLevel 是"一把都没配"时的轻重，两者并不等价：
// MinerU 没 Token 还能走 Flash（受限但可用），PaddleOCR 没 Token 是整档不可用。
export const TOKEN_FIELDS = [
  {
    field: "mineruCredentials",
    provider: "mineru",
    name: "MinerU",
    missingLevel: "yellow",
    missingDetail: "没配也能用，但只走 Flash 模式（10MB / 20 页以内），超过就掉到后面的档位。",
  },
  {
    field: "paddleTokens",
    provider: "paddleocr",
    name: "PaddleOCR",
    missingLevel: "red",
    missingDetail: "这一档必须有 Token 才能用，等于整档缺了。",
  },
];

const LEVEL_WEIGHT = { red: 2, yellow: 1 };

function emptyStatus() {
  return { version: 1, lastProbeAt: 0, fields: {}, mutedFor: null };
}

// 读到的东西可能是老版本写的、也可能被别的键塞过东西，统一捏成已知形状再用。
export function normalizeStatus(value) {
  const base = emptyStatus();
  if (!value || typeof value !== "object") return base;
  const out = {
    version: 1,
    lastProbeAt: Number.isFinite(value.lastProbeAt) ? value.lastProbeAt : 0,
    fields: {},
    mutedFor: typeof value.mutedFor === "string" && value.mutedFor ? value.mutedFor : null,
  };
  const fields = value.fields && typeof value.fields === "object" ? value.fields : {};
  for (const spec of TOKEN_FIELDS) {
    const entry = fields[spec.field];
    if (!entry || typeof entry !== "object") continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    out.fields[spec.field] = {
      fingerprint: typeof entry.fingerprint === "string" ? entry.fingerprint : "",
      checkedAt: Number.isFinite(entry.checkedAt) ? entry.checkedAt : 0,
      items: items
        .filter((item) => item && Number.isFinite(Number(item.index)))
        .map((item) => ({
          index: Number(item.index),
          label: typeof item.label === "string" ? item.label : null,
          ok: item.ok === true,
          message: typeof item.message === "string" ? item.message : "",
          source: item.source === "usage" ? "usage" : "probe",
          at: Number.isFinite(item.at) ? item.at : 0,
        })),
    };
  }
  return out;
}

export function readStatus(storage) {
  try {
    return normalizeStatus(storage?.global?.get?.(STORAGE_KEY, null));
  } catch {
    return emptyStatus();
  }
}

// 存不进去不该让调用方崩：拿不到状态最多是"这次不提示"，比整个工具报错强。
export function writeStatus(storage, status) {
  try {
    storage?.global?.set?.(STORAGE_KEY, normalizeStatus(status));
    return true;
  } catch {
    return false;
  }
}

// 把用户配置里的 Token 拆成一把一把，index 是它在配置里的真实序号（从 1 起），
// 空行不算。这个序号是三个系统之间唯一的对账方式：设置页按行号展示、Python 侧
// 按 credential 位置上报、这里按位置存取。
export function tokenListOf(field, rawValue) {
  if (field === "mineruCredentials") {
    return parseCredentials(rawValue)
      .map((cred, i) => ({ index: i + 1, token: String(cred?.accessKey || cred?.secretKey || "").trim() }))
      .filter((item) => Boolean(item.token));
  }
  return parseTokens(rawValue)
    .map((token, i) => ({ index: i + 1, token: String(token).trim() }))
    .filter((item) => Boolean(item.token));
}

// 指纹 = 某个字段当前内容的摘要。结论挂在指纹上，Token 一改指纹就变，
// 老结论自动失效 —— 这就是"改动 Token 前不再提示"这四个字的实现方式。
//
// 未设置（undefined / null）与空字符串归一成同一个值：设置页读到的是 SPEC 补齐后的
// ""，而工具侧读的是原始值（可能是 undefined），两边必须算出同一个指纹。
export function fingerprint(field, rawValue) {
  const text = typeof rawValue === "string"
    ? rawValue
    : (Array.isArray(rawValue) ? JSON.stringify(rawValue) : "");
  return createHash("sha256").update(`${field}\u0000${text}`, "utf8").digest("hex").slice(0, 16);
}

// 工具侧读的那几个键。设置页走 SPEC 补齐默认值，工具侧拿的是原始值，
// 所以两边都只依赖上面那个指纹归一化，不各自补默认值。
export function readTokenConfig(ctx) {
  const get = (key) => {
    try {
      return ctx?.config?.get?.(key);
    } catch {
      return undefined;
    }
  };
  return {
    mineruCredentials: get("mineruCredentials"),
    paddleTokens: get("paddleTokens"),
    defaultBackend: get("defaultBackend"),
    pdfBackendChain: get("pdfBackendChain"),
  };
}

export function combinedFingerprint(config = {}) {
  const parts = TOKEN_FIELDS.map((spec) => fingerprint(spec.field, config?.[spec.field]));
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 16);
}

// 与 python/main.py 的 select_backend_chain 对齐：显式后端就是它自己，
// auto 才读降级链。这里用 PDF 那条链 —— Token 只在这条链上有位置。
export function reachableBackends(config = {}) {
  const explicit = String(config?.defaultBackend ?? "auto").trim() || "auto";
  if (explicit !== "auto") return [explicit];
  const raw = config?.pdfBackendChain;
  const list = Array.isArray(raw)
    ? raw.map((v) => String(v).trim()).filter(Boolean)
    : String(raw ?? "").split(/[;,>\n]+/).map((v) => v.trim()).filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_PDF_BACKEND_CHAIN];
}

function isFreshGreen(item, fieldCheckedAt, now) {
  const at = Number.isFinite(item.at) && item.at > 0 ? item.at : fieldCheckedAt;
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at <= GREEN_TTL_MS;
}

// 「无法判定」不是失败：没网、出网被拒、云端返回了认不出的码，都归这一档。
// 探测侧统一用这个词开头（见 lib/validate.js），这里照同一个口径读。
// 把它们当成失效就是假精确 —— 说"失效"要有证据，没证据就说不知道。
function isUndetermined(item) {
  return String(item?.message || "").startsWith("无法判定");
}

function describeItem(item) {
  const label = item.label ? ` ${item.label}` : "";
  const message = item.message ? `（${item.message}）` : "";
  return `第 ${item.index} 个${label}${message}`;
}

function describeItems(items, limit = 3) {
  const head = items.slice(0, limit).map(describeItem).join("；");
  const rest = items.length - limit;
  return rest > 0 ? `${head}，等 ${items.length} 把` : head;
}

// 单个字段的判定。返回 { state, level, title, detail, bad }，state 为 ok / missing /
// all-failed / partial-failed / unknown / not-in-chain。
function evaluateField(spec, config, status, now, chain) {
  if (!chain.includes(spec.provider)) return { state: "not-in-chain" };

  const raw = config?.[spec.field];
  const list = tokenListOf(spec.field, raw);
  const total = list.length;

  if (total === 0) {
    return {
      state: "missing",
      level: spec.missingLevel,
      title: `${spec.name} 未配置 Token`,
      detail: spec.missingDetail,
      bad: [],
      total: 0,
    };
  }

  const entry = status.fields[spec.field];
  const matches = entry && entry.fingerprint === fingerprint(spec.field, raw) ? entry : null;
  const items = matches ? matches.items : [];
  // 结论覆盖不到全部 Token（比如只留下了某几次提取的证据）时，不作"全绿"判断，
  // 但已知失效的那几把照样算数 —— 失效是事实，不需要覆盖率背书。
  const bad = items
    .filter((item) => !item.ok && !isUndetermined(item) && item.index <= total)
    .sort((a, b) => a.index - b.index);
  const knownOk = items.filter((item) => item.ok && item.index <= total && isFreshGreen(item, matches?.checkedAt, now));

  if (bad.length >= total) {
    return {
      state: "all-failed",
      level: "red",
      title: `${spec.name} ${total} 把 Token 全部失效`,
      detail: `${describeItems(bad)}。这一档会被一直跳过，直接用后面的档位。`,
      bad,
      total,
    };
  }
  if (bad.length > 0) {
    return {
      state: "partial-failed",
      level: "yellow",
      title: `${spec.name} ${total} 把里有 ${bad.length} 把 Token 失效`,
      detail: `${describeItems(bad)}。其余仍可用，解析不受影响；失效的那把留着只是每次都白试一次。`,
      bad,
      total,
    };
  }
  if (knownOk.length >= total) return { state: "ok", level: null, bad: [], total };

  // 剩下的情况都是"没有结论"：没探过、Token 改过、绿灯过期了，或者上一轮探测根本
  // 没问出结果（无法判定）。不猜、不提示，也不谎报有效。
  return { state: "unknown", level: null, bad: [], total };
}

// 算出现在该不该提示、提示什么。界面和 agent 都读这一份。
export function evaluateTokenStatus(config = {}, status = null, { now = Date.now() } = {}) {
  const state = normalizeStatus(status);
  const muted = Boolean(state.mutedFor) && state.mutedFor === combinedFingerprint(config);
  const chain = reachableBackends(config);

  const fields = {};
  const problems = [];
  for (const spec of TOKEN_FIELDS) {
    const result = evaluateField(spec, config, state, now, chain);
    fields[spec.field] = result;
    if (result.level) problems.push({ ...result, provider: spec.provider, field: spec.field, name: spec.name });
  }

  problems.sort((a, b) => (LEVEL_WEIGHT[b.level] || 0) - (LEVEL_WEIGHT[a.level] || 0));
  const top = problems.length > 0 ? problems[0].level : null;
  // 静音了就整条不显示。它只压"提示"，不改变事实 —— 结论照旧存在，改 Token 会重新出现。
  const level = muted ? null : top;

  return {
    muted,
    level,
    // 原始轻重：静音时界面仍然知道本来该报什么，便于文案里说明"已被静音"。
    rawLevel: top,
    title: problems.map((p) => p.title).join("；"),
    detail: problems.map((p) => p.detail).join(" "),
    problems,
    fields,
    checkedAt: state.lastProbeAt || null,
  };
}

// 给 agent 的那句话。要能直接被转述给用户，所以写成人话 + 明确的下一步，
// 顺带交代"不想再看到"的出口在哪。
export function buildTokenNotice(evaluated) {
  if (!evaluated || !evaluated.level || evaluated.muted) return null;
  const parts = evaluated.problems.map((problem) => {
    if (problem.state === "missing") {
      return `${problem.title}。${problem.detail}可以提醒用户去 doc-intake 设置页填上；如果他本来就不打算用云端解析，忽略即可。`;
    }
    if (problem.state === "all-failed") {
      return `${problem.title}：${problem.detail}请在回复里提醒用户去 doc-intake 设置页更新 Token。`;
    }
    return `${problem.title}：${problem.detail}不影响本次使用，可以顺口提醒用户去 doc-intake 设置页清理。`;
  });
  parts.push("不想再看到这类提示的话，用户可以在 doc-intake 设置页顶部点「改动 Token 前不再提示」。");

  return {
    level: evaluated.level,
    text: `[Token 提示] ${parts.join(" ")}`,
    items: evaluated.problems.flatMap((problem) => problem.bad.map((item) => ({
      provider: problem.provider,
      field: problem.field,
      index: item.index,
      label: item.label,
      reason: item.message,
      source: item.source,
    }))),
  };
}

// 把这次提取实际撞到的鉴权拒绝并进状态。这是最硬的一手证据：不是探测推出来的，
// 是云端当场拒的。它可能只覆盖池子里的某几把，所以允许结论不完整。
export function recordAuthFailures(status, config, failures, { now = Date.now() } = {}) {
  const next = normalizeStatus(status);
  let touched = false;

  for (const raw of Array.isArray(failures) ? failures : []) {
    const provider = String(raw?.provider || "").trim().toLowerCase();
    const spec = TOKEN_FIELDS.find((item) => item.provider === provider);
    const index = Number(raw?.index);
    if (!spec || !Number.isFinite(index) || index < 1) continue;

    const fp = fingerprint(spec.field, config?.[spec.field]);
    const entry = next.fields[spec.field];
    const same = entry && entry.fingerprint === fp;
    const items = same ? [...entry.items] : [];
    const item = {
      index,
      label: String(raw?.label || "").trim() || null,
      ok: false,
      message: String(raw?.reason || "").trim() || "鉴权失败",
      source: "usage",
      at: now,
    };
    const at = items.findIndex((existing) => existing.index === index);
    if (at >= 0) items[at] = { ...items[at], ...item };
    else items.push(item);
    items.sort((a, b) => a.index - b.index);

    next.fields[spec.field] = { fingerprint: fp, checkedAt: same ? entry.checkedAt : now, items };
    touched = true;
  }

  return touched ? next : next;
}

// 真的去探一遍，并把结果落盘。设置页打开时、以及工具调用顺手补探时都走这里。
// 只探已保存的值 —— 输入框里的草稿不探，免得用户还在打字就发请求。
export async function probeTokenFields({ config = {}, status = null, fetchImpl = null, fields = null, storage = null, now = Date.now() } = {}) {
  const targets = Array.isArray(fields) && fields.length > 0 ? fields : TOKEN_FIELDS.map((spec) => spec.field);
  const next = normalizeStatus(status);
  const probed = [];

  for (const spec of TOKEN_FIELDS) {
    if (!targets.includes(spec.field)) continue;
    const raw = config?.[spec.field];
    const list = tokenListOf(spec.field, raw);
    const probe = spec.provider === "mineru" ? validateMineruToken : validatePaddleToken;

    if (list.length === 0) {
      // 没 Token 可探：清掉这个字段的旧结论，免得留着上一个 Token 的判断。
      next.fields[spec.field] = { fingerprint: fingerprint(spec.field, raw), checkedAt: now, items: [] };
      continue;
    }

    const rows = await validateTokenList(list.map((item) => item.token), (token) => probe(token, fetchImpl));
    next.fields[spec.field] = {
      fingerprint: fingerprint(spec.field, raw),
      checkedAt: now,
      // validateTokenList 的 index 按传入顺序从 1 起，这里换成配置里的真实行号。
      items: rows.map((row, i) => ({
        index: list[i]?.index ?? i + 1,
        label: row?.label || null,
        ok: row?.ok === true,
        message: String(row?.message || ""),
        source: "probe",
        at: now,
      })),
    };
    probed.push(spec.field);
  }

  const updated = { ...next, lastProbeAt: now };
  if (storage) writeStatus(storage, updated);
  return { status: updated, probed };
}

// 把已经拿到的逐把结果（设置页那个「检测」按钮探的是输入框里的草稿值，不一定是
// 已保存的值）存进状态。指纹按探的那串内容算，所以草稿的结论只有在内容真被保存
// 之后才会跟已保存的指纹对上、才会显示出来。
export function recordProbeRows(status, { field, raw, rows, now = Date.now() } = {}) {
  const next = normalizeStatus(status);
  if (!TOKEN_FIELDS.some((spec) => spec.field === field)) return next;
  next.fields[field] = {
    fingerprint: fingerprint(field, raw),
    checkedAt: now,
    items: (Array.isArray(rows) ? rows : []).map((row, i) => ({
      index: Number.isFinite(Number(row?.index)) ? Number(row.index) : i + 1,
      label: row?.label ? String(row.label) : null,
      ok: row?.ok === true,
      message: String(row?.message || ""),
      source: "probe",
      at: now,
    })),
  };
  next.lastProbeAt = now;
  return next;
}

// 要不要顺手补探一次。条件：有 Token 可探、距上次探测超过窗口（或从没探过）。
export function shouldBackgroundProbe(config = {}, status = null, { now = Date.now() } = {}) {
  const state = normalizeStatus(status);
  const hasToken = TOKEN_FIELDS.some((spec) => tokenListOf(spec.field, config?.[spec.field]).length > 0);
  if (!hasToken) return false;
  if (!state.lastProbeAt) return true;
  return now - state.lastProbeAt > PROBE_INTERVAL_MS;
}
