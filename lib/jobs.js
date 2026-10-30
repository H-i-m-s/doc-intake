// 作业表：一次异步解析任务在进程内的进度视图，带一份落盘副本。
//
// 为什么需要落盘：卡片是聊天流里的一条历史，用户切走会话再回来时卡片还在，
// 而记录只在内存里时进程一死那张卡片就是一具尸体。
// 所以内存是当前真相，磁盘是「进程死后还能把同一批记录认回来」的备份。
// 保留期仍然决定哪些作业值得留：过期的既不进内存也不进磁盘。

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 终态作业的保留时长。超过它就只可能是没人再看的残留。 */
const JOB_RETENTION_MS = 30 * 60 * 1000;

/** 落盘文件名。目录由宿主给的 dataDir 决定，这里不猜任何绝对路径。 */
const JOBS_FILE_NAME = "jobs.json";

/** 合并写的窗口。卡片一秒轮询一次，写入比这更快只会白烧磁盘。 */
const FLUSH_DELAY_MS = 200;

/** jobId -> 作业对象。所有读写都必须经过下面几个导出函数，外部拿不到原始引用。 */
const jobs = new Map();

const TERMINAL_STATES = new Set(["done", "failed"]);
const FILE_STATES = new Set(["pending", "running", "done", "failed"]);

/** 落盘目标。null 表示退化成纯内存模式，所有写盘动作直接跳过。 */
let storeFilePath = null;
let pendingFlush = null;
let dirty = false;
/** App 侧注入的 logger；没注入时退回 stderr，持久化故障不能静默。 */
let storeLogger = null;

function createFileEntry(file) {
  return {
    source: file?.source ?? null,
    name: file?.name ?? null,
    status: "pending",
    // 进度卡按「这个文件自己跑了多久」估进度，所以要一个自己的起点。
    // 它不是入参：由 updateFile 在状态第一次转 running 时补上。
    startedAt: null,
    backend: null,
    stage: null,
    attempt: 0,
    pages: null,
    durationMs: 0,
    error: null,
    triedBackends: [],
    // 落盘后才有：卡片完成态那个「打开文件夹」要知道文件到底在哪儿。
    mdPath: null,
  };
}

function countDone(job) {
  return job.files.filter((file) => file.status === "done").length;
}

function newJobId() {
  // 12 位小写十六进制：短到能塞进卡片 id，随机量大到进程内不会撞。
  return `dj_${randomBytes(6).toString("hex")}`;
}

export function createJob({ files } = {}) {
  const jobId = newJobId();
  const job = {
    jobId,
    createdAt: Date.now(),
    state: "running",
    doneCount: 0,
    error: null,
    files: (Array.isArray(files) ? files : []).map(createFileEntry),
  };
  jobs.set(jobId, job);
  markDirty();
  return jobId;
}

export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job || !patch || typeof patch !== "object") return null;
  Object.assign(job, patch);
  job.doneCount = countDone(job);
  markDirty();
  return job;
}

export function updateFile(jobId, index, patch) {
  const job = jobs.get(jobId);
  if (!job || !patch || typeof patch !== "object") return null;
  const file = job.files[index];
  if (!file) return null;
  Object.assign(file, patch);
  // 第一次真正开跑的时刻只记一次：降级重试会再报 running，重记就等于把进度从头算，
  // 卡片上的条子会往回缩。
  if (file.startedAt == null && file.status === "running") file.startedAt = Date.now();
  job.doneCount = countDone(job);
  markDirty();
  return file;
}

/**
 * jobId → 宿主卡片身份。
 * 公式是契约：宿主按 ^a_[0-9a-f]{20}$ 认这张卡，会话重新投影时靠同一个值认出是同一张，
 * 所以这里必须是全 App 唯一的写法，改一次所有算过的地方一起失效。
 */
export function cardInstanceIdFor(jobId) {
  const hex = createHash("sha256").update(`doc-intake:${jobId}`).digest("hex").slice(0, 20);
  return `a_${hex}`;
}

/**
 * 卡片身份 → 作业。
 * 哈希不可逆，只能逐条比：作业表里就是在跑的解析数，条数个位数，算哈希没有成本问题。
 * 超出保留期的作业直接跳过：那些卡片早就没人看了。
 */
export function findJobByCardId(cardInstanceId) {
  if (typeof cardInstanceId !== "string" || !cardInstanceId) return null;
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (now - job.createdAt > JOB_RETENTION_MS) continue;
    if (cardInstanceIdFor(jobId) !== cardInstanceId) continue;
    return { ...structuredClone(job), cardInstanceId };
  }
  return null;
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  // 深拷贝：卡片轮询和调用方拿到的必须是死快照，否则后续更新会改写已经读走的数据。
  return structuredClone(job);
}

export function finishJob(jobId, { state, error } = {}) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.state = TERMINAL_STATES.has(state) ? state : "failed";
  job.error = error ?? null;
  job.doneCount = countDone(job);
  markDirty();
  return job;
}

/**
 * 这个路径是不是某次解析真实落下来的产物。
 *
 * /reveal 会起 explorer.exe，不能变成「传什么就开什么」的口子。
 * 路径归一化后逐条比对作业表，只认自己写过的那个文件。
 */
export function hasSavedPath(target) {
  if (typeof target !== "string" || !target) return false;
  let normalized;
  try { normalized = path.resolve(target).toLowerCase(); } catch { return false; }
  for (const job of jobs.values()) {
    for (const file of job.files) {
      if (typeof file.mdPath !== "string" || !file.mdPath) continue;
      try {
        if (path.resolve(file.mdPath).toLowerCase() === normalized) return true;
      } catch { /* 记录里的路径坏了就跳过，不影响别的 */ }
    }
  }
  return false;
}

export function pruneJobs() {
  const now = Date.now();
  let removed = 0;
  for (const [jobId, job] of jobs) {
    if (now - job.createdAt <= JOB_RETENTION_MS) continue;
    if (!TERMINAL_STATES.has(job.state)) continue;
    jobs.delete(jobId);
    removed += 1;
  }
  // 内存里删了，磁盘上也该跟着小下去，否则文件只增不减。
  if (removed > 0) markDirty();
  return removed;
}

// ── 落盘 ──────────────────────────────────────────────────────────────────
// 磁盘只是内存的副本，任何时候都以内存为准：读坏了、写失败、目录不可用，
// 都只影响「进程死后能不能认回记录」，不能让正在跑的解析跟着抖。

/**
 * 绑定落盘位置。
 * 目录必须由宿主传入（context.dataDir）：App 自己猜路径会写入奇怪的地方，
 * 也会在宿主换存储布局后静默写丢。拿不到目录就明确退成纯内存并留一条日志。
 */
export function configureJobsStore({ dataDir, logger } = {}) {
  storeLogger = logger && typeof logger === "object" ? logger : null;
  if (pendingFlush) {
    clearTimeout(pendingFlush);
    pendingFlush = null;
  }
  dirty = false;
  const dir = typeof dataDir === "string" ? dataDir.trim() : "";
  if (!dir) {
    storeFilePath = null;
    logStore("作业表持久化停用：没有可用的 dataDir，记录只留在内存，进程重启后卡片会查不到作业");
    return { enabled: false, file: null };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    storeFilePath = null;
    logStore(`作业表持久化停用：dataDir 不可用（${error?.message || error}），记录只留在内存`);
    return { enabled: false, file: null };
  }
  storeFilePath = path.join(dir, JOBS_FILE_NAME);
  return { enabled: true, file: storeFilePath };
}

/**
 * 从磁盘读回作业表，返回真正收下的条数。
 * 读不出来一律当空表：一张卡片显示「记录已失效」比 App 启动失败要轻得多。
 * 超过保留期的直接丢：那些卡片早就没人看了，留着只会让文件越来越肥。
 */
export function loadJobs() {
  if (!storeFilePath) return 0;
  let raw = "";
  try {
    raw = fs.readFileSync(storeFilePath, "utf8");
  } catch (error) {
    // 第一次启动时文件不存在是正常情形，不是故障。
    if (error?.code !== "ENOENT") logStore(`作业表读取失败，按空表启动：${error?.message || error}`);
    return 0;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.jobs)) {
    logStore("作业表内容读不出作业列表，按空表启动");
    return 0;
  }
  const now = Date.now();
  let loaded = 0;
  for (const item of parsed.jobs) {
    const job = restoreJob(item, now);
    if (!job) continue;
    jobs.set(job.jobId, job);
    loaded += 1;
  }
  return loaded;
}

/** 只标脏，真正写盘由一次 200ms 后的合并写完成。 */
function markDirty() {
  if (!storeFilePath) return;
  dirty = true;
  if (pendingFlush) return;
  pendingFlush = setTimeout(flushNow, FLUSH_DELAY_MS);
  // 挂起的那次合并写不拦进程退出：丢最后 200ms 的进度不影响卡片正确性。
  if (typeof pendingFlush.unref === "function") pendingFlush.unref();
}

function flushNow() {
  pendingFlush = null;
  if (!storeFilePath || !dirty) return;
  dirty = false;
  const now = Date.now();
  const alive = [];
  for (const job of jobs.values()) {
    if (now - job.createdAt > JOB_RETENTION_MS) continue;
    alive.push(job);
  }
  const payload = JSON.stringify({ version: 1, savedAt: now, jobs: alive });
  const tmpPath = `${storeFilePath}.tmp`;
  try {
    // 先写临时文件再改名：读的一方（卡片轮询、下一个进程）不能看到写一半的表。
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, storeFilePath);
  } catch (error) {
    // 不在这里自旋重试：下一次标脏会再试一次，而卡片的正确性不依赖磁盘。
    logStore(`作业表落盘失败：${error?.message || error}`);
  }
}

function restoreJob(rawJob, now) {
  if (!rawJob || typeof rawJob !== "object") return null;
  const jobId = typeof rawJob.jobId === "string" ? rawJob.jobId.trim() : "";
  const createdAt = asFiniteNumber(rawJob.createdAt);
  // 没有标识或时间的条目无法参与反查和保留期判断，留着就是垃圾。
  if (!jobId || createdAt == null || createdAt <= 0) return null;
  if (now - createdAt > JOB_RETENTION_MS) return null;
  const job = {
    jobId,
    createdAt,
    state: rawJob.state === "running" || TERMINAL_STATES.has(rawJob.state) ? rawJob.state : "failed",
    doneCount: 0,
    error: asTrimmedString(rawJob.error),
    files: (Array.isArray(rawJob.files) ? rawJob.files : []).map(restoreFile),
  };
  // doneCount 是派生值，一律重算：存储里那个数不值得信任，错了会让卡片总数对不上。
  job.doneCount = countDone(job);
  return job;
}

function restoreFile(rawFile) {
  const entry = createFileEntry(rawFile);
  if (!rawFile || typeof rawFile !== "object") return entry;
  if (FILE_STATES.has(rawFile.status)) entry.status = rawFile.status;
  const startedAt = asFiniteNumber(rawFile.startedAt);
  if (startedAt != null && startedAt > 0) entry.startedAt = startedAt;
  entry.backend = asTrimmedString(rawFile.backend);
  entry.stage = asTrimmedString(rawFile.stage);
  entry.error = asTrimmedString(rawFile.error);
  entry.mdPath = asTrimmedString(rawFile.mdPath);
  const attempt = asFiniteNumber(rawFile.attempt);
  if (attempt != null && attempt >= 0) entry.attempt = attempt;
  const pages = asFiniteNumber(rawFile.pages);
  if (pages != null && pages > 0) entry.pages = pages;
  const durationMs = asFiniteNumber(rawFile.durationMs);
  if (durationMs != null && durationMs >= 0) entry.durationMs = durationMs;
  if (Array.isArray(rawFile.triedBackends)) {
    entry.triedBackends = rawFile.triedBackends.filter((name) => typeof name === "string");
  }
  return entry;
}

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * 持久化相关的告警必顶上顶。
 * 两个来源的 logger 级别名不同（lib/logger 用 warning，宿主 sdk.logger 用 warn），
 * 所以逐级探；都没有就直接写 stderr，不能让降级悄无声息。
 */
function logStore(message) {
  const logger = storeLogger;
  const fn = (typeof logger?.warning === "function" && logger.warning)
    || (typeof logger?.warn === "function" && logger.warn)
    || (typeof logger?.error === "function" && logger.error)
    || null;
  if (fn) {
    try {
      const out = fn.call(logger, message);
      if (out && typeof out.catch === "function") out.catch(() => {});
      return;
    } catch { /* 日志自己坏了不能反过来打断作业 */ }
  }
  console.error(`[doc-intake][jobs] ${message}`);
}
