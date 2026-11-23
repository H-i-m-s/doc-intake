// lib/service-api.js — 对外开放的四个服务方法。
//
// 别的 App 可以直接调这四个方法（走宿主总线 app:doc-intake/<方法名>），不经过模型、
// 不建宿主任务、不往会话里投任何东西、不写全局存储。这里只做三件事：
// 校验参数与路径准入、按和面板同一套流程发起作业、把作业结果整理成纯 JSON。
//
// 为什么和面板（routes/panel.js）流程一致却各写一份：那边是 HTTP 处理器，要顾及
// 状态码与请求体解析；这边是总线处理器，要顾及「等一小段再回」与 JSON-safe。
// 共用的部分在 lib 里（extract-batch / job-runner / cleanup），这里只做搬运，
// 所以两边的差异只在于出入口，而不在于提取本身。
//
// 路径准入只管一件事：必须是绝对路径。服务入口没有确定的工作目录，相对路径代表什么全靠猜。
// 「读哪些目录」不做限制 —— 这是使用者的明确取舍：边界放在两道授权上（本 App 被授权
// 对外提供服务、调用方被授权调用别的 App），而不是放在路径前缀上。卡片与工具同理。

import { basename, isAbsolute, resolve } from "node:path";

import { scheduleAutoCleanup } from "./cleanup.js";
import { expandSourcesWithPython, processFiles } from "./extract-batch.js";
import { FORMATS } from "./formats.js";
import { getJob } from "./jobs.js";
import { startJob } from "./job-runner.js";

export const SERVICE_APP_ID = "doc-intake";
/** 缺省等待：短到调用方不会因为一次调用等太久，长到本地小文件基本都在这之内跑完。 */
export const DEFAULT_WAIT_MS = 20000;
/** 等待上限。再长就该走 status/result 轮询，而不是挂着一个调用等。 */
export const MAX_WAIT_MS = 600000;
/** 等作业时看快照的间隔。作业快照本来就是秒级推进，200ms 已经比它密。 */
const POLL_MS = 200;
/** 结果留档的保留时长，跟 lib/jobs.js 里作业表的保留期对齐。 */
const RECORD_TTL_MS = 30 * 60 * 1000;

/** 后端档位，和设置 schema 的 enum 一致。 */
const BACKENDS = ["auto", "mineru", "oxr", "paddleocr", "mineru-local", "local"];

/**
 * 本服务发起的作业留档：jobId -> { state, files, at }。
 * 为什么需要：jobs 表里的快照只存进度与路径，不存正文；服务答应「默认返回全文」，
 * 那份正文只能在收尾回调里接住。别的入口（工具、面板）起的作业没有这份留档，
 * 查它们的 result 时正文就真的拿不出来 —— 这是事实，不编。
 */
const outputs = new Map();

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorText(error) {
  return error?.message || String(error ?? "");
}

function fail(code, error) {
  return { ok: false, code, error };
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, Math.max(0, ms)));
}

/** 规整 sources：去空、去首尾空白、去重（小写比，Windows 上大小写不敏感）。 */
function normalizeSources(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? [raw] : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const value = trimmedString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * waitMs 归一：缺省给 DEFAULT_WAIT_MS，负数按 0，超过上限按上限。
 * 非数字（字符串 "abc"、对象）一律当没填，不猜调用方的意思。
 */
function normalizeWaitMs(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  return Math.min(MAX_WAIT_MS, Math.floor(n));
}

/**
 * 路径准入：每个 source 都必须是绝对路径。
 * 前缀白名单在 2026-11 被使用者明确拆掉：调用方本来就是被授权的 App，再拿目录前缀
 * 卡它只会逼人去设置里填一堆根目录。
 */
export function checkSourcePaths(sources) {
  for (const source of sources) {
    if (!isAbsolute(source)) {
      return fail("PATH_NOT_ALLOWED", `只接受绝对路径：${source}`);
    }
  }
  return { ok: true };
}

/** 提取用的 ctx：只要 logger 与一份同步取值的配置壳（extractDocument 会再读一次配置）。 */
function extractionContext(settings, logger) {
  return {
    logger,
    // 服务入口拿不到原始配置对象（readSettings 只给规范化后的 settings），
    // 就把它当配置源喂回去：getSettings 对同一批键再做一次归一是幂等的。
    config: { get: (key) => settings[key] },
  };
}

/** 组装提取参数。留空的项不传（缺项 = 按设置里的规则来），空串不是同一个意思。 */
function buildInput(body, settings) {
  const input = {
    backend: BACKENDS.includes(trimmedString(body?.backend))
      ? trimmedString(body.backend)
      : settings.defaultBackend,
    // 三档并发上限跟着设置走，和工具、面板入口保持一致。
    _apiConcurrency: settings.maxConcurrent ?? 4,
    _localConcurrency: settings.maxConcurrentLocal ?? 8,
    _legacyConversionConcurrency: settings.legacyConversionConcurrency ?? 1,
  };
  // 输出目录由调用方指定，不套读取根的闸：工单只要求卡住「读」，
  // 写到哪里仍然由调用方自己决定（和面板的「保存到」是同一个自由度）。
  const outputDir = trimmedString(body?.outputDir);
  if (outputDir) input.outputDir = outputDir;
  const pageRange = trimmedString(body?.pageRange);
  if (pageRange) input.pageRange = pageRange;
  const language = trimmedString(body?.language);
  if (language) input.language = language;
  if (typeof body?.includeMedia === "boolean") input.includeMedia = body.includeMedia;
  if (typeof body?.saveJson === "boolean") input.saveJson = body.saveJson;
  // 两个改变走哪条路的开关，只认严格布尔：真值字符串不是它，宁可当没传。
  // splitOnly 走图片分割，不调任何后端；summaryOnly 只回状态，但会强推自动落盘。
  if (typeof body?.splitOnly === "boolean") input.splitOnly = body.splitOnly;
  if (typeof body?.summaryOnly === "boolean") input.summaryOnly = body.summaryOnly;
  return input;
}

/** 收尾那次写留档，顺手把过期的清掉：这张表跟着作业表一起老，不能只增不减。 */
function recordOutput(jobId, state, files, extra) {
  if (!jobId) return;
  const now = Date.now();
  outputs.set(jobId, { state, files: Array.isArray(files) ? files : [], at: now, ...(extra || {}) });
  for (const [key, value] of outputs) {
    if (now - value.at > RECORD_TTL_MS) outputs.delete(key);
  }
}

function fileStatusOf(status) {
  return status === "done" ? "success" : "failed";
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 终态产出。extract 成功与 result 共用这一份，形状不会出现两种说法。
 *
 * 字段来源：pages / durationMs / backend / mdPath / error 取作业快照（那是进度侧的事实），
 * markdown / jsonPath / mediaPaths / warnings 取收尾时的产物（快照里没有这些）。
 * 两边按下标对齐 —— 作业表从建表那一刻起就按 sources 顺序固定，不会乱序。
 */
export function buildTerminalOutput(jobId, snapshot, includeMarkdown) {
  const record = outputs.get(jobId) ?? null;
  // 服务层的 summaryOnly 在这里落实。Python 只拿这个开关决定「自动落盘」，正文照旧
  // 会回来；工具那一层是自己把正文裁掉的，服务这一层没人替它裁。不裁的话 describe
  // 里写的「只回状态、不返正文」就是空话，调用方也会意外拿到一大段正文。
  const suppressMarkdown = record?.summaryOnly === true;
  const snapshotFiles = safeArray(snapshot?.files);
  const files = snapshotFiles.map((file, index) => {
    const out = record?.files?.[index] ?? null;
    const markdown = typeof out?.markdown === "string" ? out.markdown : "";
    const pagesValue = Number(file?.pages);
    const durationValue = Number(file?.durationMs);
    const entry = {
      name: basename(String(file?.name || file?.source || "")) || "未命名文件",
      source: typeof file?.source === "string" ? file.source : (typeof out?.name === "string" ? out.name : null),
      status: fileStatusOf(file?.status),
      error: typeof file?.error === "string" ? file.error : (typeof out?.error === "string" ? out.error : null),
      warnings: safeArray(out?.warnings).filter((item) => typeof item === "string"),
      backend: typeof file?.backend === "string" ? file.backend : (out?.usedBackend ?? null),
      pages: Number.isFinite(pagesValue) && pagesValue > 0 ? pagesValue : null,
      durationMs: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 0,
      mdPath: typeof file?.mdPath === "string" && file.mdPath ? file.mdPath : (out?.mdPath ?? null),
      jsonPath: typeof out?.jsonPath === "string" && out.jsonPath ? out.jsonPath : null,
      mediaPaths: safeArray(out?.mediaPaths).filter((item) => typeof item === "string"),
      // 字数按留档正文算，跟给不给正文无关：调用方要摘要时也得知道有多大。
      // summaryOnly 下一律 null —— 这次本来就不给正文，报个字数是自相矛盾。
      charCount: suppressMarkdown ? null : (typeof out?.markdown === "string" ? out.markdown.length : null),
    };
    if (!suppressMarkdown && includeMarkdown && typeof out?.markdown === "string") entry.markdown = markdown;
    return entry;
  });
  return { ok: true, state: snapshot?.state === "failed" ? "failed" : "done", jobId, files };
}

/** 还在跑的那份视图：够调用方算进度，不含正文（正文这时候还不存在）。 */
export function buildRunningOutput(jobId, snapshot) {
  const files = safeArray(snapshot?.files);
  return {
    ok: true,
    state: "running",
    jobId,
    progress: {
      doneCount: files.filter((file) => file?.status === "done").length,
      total: files.length,
      files: files.map((file) => ({
        name: basename(String(file?.name || file?.source || "")) || "未命名文件",
        status: file?.status ?? "pending",
        backend: file?.backend ?? null,
        pages: Number.isFinite(Number(file?.pages)) && Number(file.pages) > 0 ? Number(file.pages) : null,
        durationMs: Number.isFinite(Number(file?.durationMs)) ? Number(file.durationMs) : 0,
      })),
    },
  };
}

function isTerminal(snapshot) {
  return snapshot?.state === "done" || snapshot?.state === "failed";
}

/**
 * 等作业到终态：给了 finished 承诺（自己发起的作业）就等它，
 * 没有就按快照轮询。到点没完就返回，由调用方回「还在跑」。
 */
async function waitForTerminal(jobId, waitMs, finished) {
  if (!(waitMs > 0)) return;
  if (finished) {
    await Promise.race([finished, sleep(waitMs)]);
    return;
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (isTerminal(getJob(jobId))) return;
    await sleep(Math.min(POLL_MS, Math.max(20, deadline - Date.now())));
  }
}

/**
 * 四个处理器。readSettings 由 App 入口包好（读原始配置 + getSettings 归一），
 * 这里不碰 ctx.config，免得出现第二套读配置的写法。
 */
export function createServiceHandlers({ readSettings, logger, resources } = {}) {
  const read = typeof readSettings === "function" ? readSettings : async () => ({});

  async function describe() {
    return {
      ok: true,
      app: SERVICE_APP_ID,
      // 参数表只写键名、类型与一句话说明：调用方要照着组参数，不需要知道内部结构。
      inputs: [
        { key: "sources", type: "string[]", required: true, description: "要解析的文件或目录的绝对路径；目录会被展开" },
        { key: "outputDir", type: "string", required: false, description: "产物保存目录；留空按设置里的规则由解析器决定" },
        { key: "backend", type: "string", enum: [...BACKENDS], required: false, description: "解析后端；缺省用设置里的默认档" },
        { key: "pageRange", type: "string", required: false, description: "页码范围，如 1-20；留空为全部" },
        { key: "language", type: "string", required: false, description: "识别语言，如 zh / en；缺省用设置里的默认语言" },
        { key: "includeMedia", type: "boolean", required: false, description: "是否提取图片与媒体；缺省用设置值" },
        { key: "saveJson", type: "boolean", required: false, description: "是否另存结构化 JSON；缺省用设置值" },
        { key: "splitOnly", type: "boolean", required: false, description: "只做图片分割测试，不调用任何解析后端；只适用于图片，对其它文件会直接失败" },
        { key: "summaryOnly", type: "boolean", required: false, description: "只返回每个文件的状态，不返回正文；它会让解析器自动落盘，所以 mdPath 仍然可用" },
        { key: "waitMs", type: "number", required: false, description: `最多等多久再返回（${DEFAULT_WAIT_MS} 为缺省，上限 ${MAX_WAIT_MS}）；到点没完就回 state=running 并给 jobId` },
      ],
      backends: [...BACKENDS],
      formats: [...FORMATS],
      waits: { defaultMs: DEFAULT_WAIT_MS, maxMs: MAX_WAIT_MS },
      markdown: "默认返回全文",
    };
  }

  async function extract(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const sources = normalizeSources(body.sources);
    if (!sources.length) return fail("NO_SOURCES", "没有可解析的路径");

    let settings;
    try {
      settings = (await read()) || {};
    } catch (error) {
      return fail("START_FAILED", `读取设置失败：${errorText(error)}`);
    }
    if (!settings.pythonPath) {
      return fail("PYTHON_PATH_NOT_CONFIGURED", "还没配置 Python 环境：管理员需要在 App 设置里填写 pythonPath");
    }

    const gate = checkSourcePaths(sources);
    if (gate.ok !== true) return gate;

    let expanded;
    try {
      expanded = await expandSourcesWithPython(settings.pythonPath, sources);
    } catch (error) {
      return fail("EXPAND_FAILED", `展开路径失败：${errorText(error)}`);
    }
    if (!Array.isArray(expanded) || expanded.length === 0) {
      return fail("NO_FILES", "没有找到可解析的文件");
    }

    // 自动清理跟着这次提取一起起个头，不 await（和工具、面板同一处、同一时机）：
    // 这时本次的产物还不存在，扫到的都是上一轮留下的。
    scheduleAutoCleanup({ settings, ctx: { logger }, resources, logger });
    if (typeof logger?.debug === "function") {
      await logger.debug(`服务入口发起解析：${expanded.length} 个文件，等待 ${normalizeWaitMs(body.waitMs, DEFAULT_WAIT_MS)}ms`);
    }

    const waitMs = normalizeWaitMs(body.waitMs, DEFAULT_WAIT_MS);
    // 收尾承诺：onFinish 在 finishJob 之后跑，拿到它比轮询快一步。
    let resolveFinished = () => {};
    const finished = new Promise((done) => { resolveFinished = done; });
    const box = { jobId: "" };

    let jobId = "";
    try {
      const started = await startJob({
        sources: expanded,
        input: buildInput(body, settings),
        ctx: extractionContext(settings, logger),
        settings,
        runBatch: processFiles,
        // 只接结果，不建任务、不投会话：这层不该认识宿主。
        onFinish: async ({ state, files }) => {
          // summaryOnly 记在留档上，产出时才知道该不该给正文。
          recordOutput(box.jobId, state, files, { summaryOnly: body.summaryOnly === true });
          resolveFinished();
        },
      });
      jobId = started?.jobId ?? "";
    } catch (error) {
      return fail("START_FAILED", `发起解析失败：${errorText(error)}`);
    }
    if (!jobId) return fail("START_FAILED", "发起解析失败：没有拿到作业号");
    box.jobId = jobId;

    await waitForTerminal(jobId, waitMs, finished);
    const snapshot = getJob(jobId);
    if (!snapshot) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");
    if (!isTerminal(snapshot)) return buildRunningOutput(jobId, snapshot);
    return buildTerminalOutput(jobId, snapshot, true);
  }

  async function status(payload) {
    const jobId = trimmedString(payload?.jobId);
    if (!jobId) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");
    const snapshot = getJob(jobId);
    if (!snapshot) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");
    const files = safeArray(snapshot.files);
    return {
      ok: true,
      state: snapshot.state,
      jobId,
      doneCount: files.filter((file) => file?.status === "done").length,
      total: files.length,
      files: files.map((file) => ({
        name: basename(String(file?.name || file?.source || "")) || "未命名文件",
        status: file?.status ?? "pending",
        backend: file?.backend ?? null,
        pages: Number.isFinite(Number(file?.pages)) && Number(file.pages) > 0 ? Number(file.pages) : null,
        durationMs: Number.isFinite(Number(file?.durationMs)) ? Number(file.durationMs) : 0,
        error: typeof file?.error === "string" ? file.error : null,
        stage: typeof file?.stage === "string" ? file.stage : null,
      })),
    };
  }

  async function result(payload) {
    const jobId = trimmedString(payload?.jobId);
    if (!jobId) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");
    let snapshot = getJob(jobId);
    if (!snapshot) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");

    // result 的 waitMs 缺省是 0：这个方法天生是「现在有什么给我看」，
    // 要等的人会用 extract 的 waitMs 或者自己轮询 status。
    const waitMs = normalizeWaitMs(payload?.waitMs, 0);
    const includeMarkdown = payload?.includeMarkdown !== false;
    if (!isTerminal(snapshot)) {
      await waitForTerminal(jobId, waitMs, null);
      snapshot = getJob(jobId);
      if (!snapshot) return fail("JOB_NOT_FOUND", "没有这个作业，或已过期");
    }
    if (!isTerminal(snapshot)) return buildRunningOutput(jobId, snapshot);
    return buildTerminalOutput(jobId, snapshot, includeMarkdown);
  }

  return { describe, extract, status, result };
}
