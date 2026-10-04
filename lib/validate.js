/**
 * Token 有效性探测 —— 设置页「检测」按钮的数据面。
 *
 * 请求由调用方注入的 fetch 发出，不在这里直连网络：
 * v2 App 跑在 Node 权限模型下（没有 --allow-net），本体解析不了域名，
 * 直接 fetch 会得到 getaddrinfo ERR_ACCESS_DENIED。设置页路由传进来的
 * 是宿主的 ctx.network.fetch —— 那个出口才通，且受 manifest 的 network 白名单约束。
 *
 * 探测口径只回答一件事：这把 Token 能不能通过鉴权。不发真实解析任务。
 *   MinerU     GET  /api/v4/extract-results/batch/<不存在的批次 id>
 *              好 Token 回 200（业务码 -60012 task not found），坏 Token 回 401 + msgCode。
 *              查一个不存在的批次不会创建任何东西，也不占解析额度。
 *   PaddleOCR  POST /api/v2/ocr/jobs，故意不带文件
 *              鉴权排在参数校验之前，所以好 Token 回 400「空文件」，坏 Token 回 401/403。
 *
 * 两个端点都是云端既有接口，行为若变化，宁可报「无法判定」也不谎报有效/无效。
 */

const MINERU_PROBE_URL =
  "https://mineru.net/api/v4/extract-results/batch/00000000-0000-0000-0000-000000000000";
const PADDLE_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const PROBE_TIMEOUT_MS = 15000;

const NO_FETCH_MESSAGE =
  "无法判定：宿主未授予网络访问（manifest 缺少顶层 network 声明）";

/**
 * 掩码：够区分是哪一把，又不把凭证写进页面和日志。
 * @param {string} token
 */
export function maskToken(token) {
  const value = String(token ?? "");
  if (value.length < 10) return value ? "***" : "";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * 从 MinerU 的错误响应里取一句人话。
 * 注意 msgCode：MinerU 把错误码放在这里，历史实现读的是 code，
 * 于是「Token 已过期」这条分支从来没机会命中，全被 401 兜成「无效」。
 */
function mineruFailureMessage(status, body) {
  const code = String(body?.msgCode || body?.code || "").trim();
  const raw = String(body?.msg || body?.error?.message || "").trim();
  if (code === "A0211") return "Token 已过期";
  if (code === "A0202") return "Token 无效";
  if (raw) return raw;
  return `HTTP ${status}`;
}

function isUsableFetch(fetchImpl) {
  return typeof fetchImpl === "function";
}

/**
 * 探测单个 MinerU Token。
 * @param {string} token
 * @param {Function} fetchImpl 由调用方注入的 fetch（通常来自 ctx.network.fetch）
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function validateMineruToken(token, fetchImpl) {
  if (!token) return { ok: false, message: "空的 Token" };
  if (!isUsableFetch(fetchImpl)) return { ok: false, message: NO_FETCH_MESSAGE };

  let result;
  try {
    result = await request(fetchImpl, MINERU_PROBE_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return { ok: false, message: `无法判定：${describeNetworkError(error)}` };
  }

  if (result.status >= 200 && result.status < 300) {
    return { ok: true, message: "Token 有效" };
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, message: mineruFailureMessage(result.status, result.json) };
  }
  const detail = String(result.json?.msg || result.statusText || "").trim();
  return { ok: false, message: `无法判定：HTTP ${result.status}${detail ? ` ${detail}` : ""}` };
}

/**
 * 探测单个 PaddleOCR Token。
 * @param {string} token
 * @param {Function} fetchImpl
 * @returns {Promise<{ok: boolean, message: string}>}
 */
export async function validatePaddleToken(token, fetchImpl) {
  if (!token) return { ok: false, message: "空的 Token" };
  if (!isUsableFetch(fetchImpl)) return { ok: false, message: NO_FETCH_MESSAGE };

  let result;
  try {
    result = await request(fetchImpl, PADDLE_JOB_URL, {
      method: "POST",
      headers: { Authorization: `bearer ${token}` },
      body: JSON.stringify({ model: "PaddleOCR-VL-1.6", optionalPayload: "{}" }),
    });
  } catch (error) {
    return { ok: false, message: `无法判定：${describeNetworkError(error)}` };
  }

  // 鉴权通过但参数不全 —— 这正是我们要的信号：Token 是认的。
  if (result.status === 400) return { ok: true, message: "Token 有效" };
  if (result.status >= 200 && result.status < 300) return { ok: true, message: "Token 有效" };
  if (result.status === 401 || result.status === 403) return { ok: false, message: "Token 无效" };

  const detail = String(result.json?.msg || result.statusText || "").trim();
  return { ok: false, message: `无法判定：HTTP ${result.status}${detail ? ` ${detail}` : ""}` };
}

/**
 * 逐把探测，保持与输入框相同的顺序，好让页面能指出「第几个失效」。
 * @param {Array<string>} tokens
 * @param {(token: string, index: number) => Promise<{ok: boolean, message: string}>} probe
 * @returns {Promise<Array<{index: number, label: string, ok: boolean, message: string}>>}
 */
export async function validateTokenList(tokens, probe) {
  const items = Array.isArray(tokens) ? tokens : [];
  const settled = await Promise.allSettled(items.map((token, i) => probe(token, i)));
  return items.map((token, i) => {
    const outcome = settled[i];
    const value = outcome.status === "fulfilled"
      ? outcome.value
      : { ok: false, message: `无法判定：${outcome.reason?.message || outcome.reason}` };
    return { index: i + 1, label: maskToken(token), ok: value.ok === true, message: value.message };
  });
}

function describeNetworkError(error) {
  const text = String(error?.message || error || "");
  const code = error?.code || "";
  // 权限模型拒绝：不是网络问题，是这个进程根本没被允许出网。
  if (code === "ERR_ACCESS_DENIED" || /ERR_ACCESS_DENIED/.test(text)) {
    return "宿主拒绝了网络访问（App 进程无网络权限）";
  }
  if (code === "ETIMEDOUT" || /timeout|timed out|aborted/i.test(text)) return "请求超时";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "域名解析失败";
  if (code === "ECONNRESET" || code === "ECONNREFUSED") return "连接被拒绝";
  return text ? text.slice(0, 160) : "网络错误";
}

async function request(fetchImpl, url, { method, headers, body }) {
  const init = {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body } : {}),
    // 宿主出口认 timeoutMs；AbortSignal 是给普通 fetch 兜底的，两条都带上。
    timeoutMs: PROBE_TIMEOUT_MS,
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(PROBE_TIMEOUT_MS) : undefined,
  };
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 就留着原文 */ }
  return { status: response.status, statusText: response.statusText, text, json };
}
