// 内存作业表：一次异步解析任务在进程内的进度视图。
//
// 为什么只放在内存、不做持久化：作业是给进度卡和宿主任务回执用的过程快照，
// App 一重启，进度卡就没有可追踪的对象了，留一份僵死记录只会让人以为还在跑。
// 这里唯一的长期成本是作业数增长，靠 pruneJobs 按终态和时间回收。

import { randomBytes } from "node:crypto";

/** 终态作业的保留时长。超过它就只可能是没人再看的残留。 */
const JOB_RETENTION_MS = 30 * 60 * 1000;

/** jobId -> 作业对象。所有读写都必须经过下面几个导出函数，外部拿不到原始引用。 */
const jobs = new Map();

const TERMINAL_STATES = new Set(["done", "failed"]);

function createFileEntry(file) {
  return {
    source: file?.source ?? null,
    name: file?.name ?? null,
    status: "pending",
    backend: null,
    stage: null,
    attempt: 0,
    pages: null,
    durationMs: 0,
    error: null,
    triedBackends: [],
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
  return jobId;
}

export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job || !patch || typeof patch !== "object") return null;
  Object.assign(job, patch);
  job.doneCount = countDone(job);
  return job;
}

export function updateFile(jobId, index, patch) {
  const job = jobs.get(jobId);
  if (!job || !patch || typeof patch !== "object") return null;
  const file = job.files[index];
  if (!file) return null;
  Object.assign(file, patch);
  job.doneCount = countDone(job);
  return file;
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
  return job;
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
  return removed;
}
