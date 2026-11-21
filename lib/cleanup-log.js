// 自动清理的记录：固定容量，不随使用时长增长。
//
// 这个文件每完成一次带删除的清理就写一条。如果按普通日志追加，用户开着不关
// 一年，它就长一年。所以改成环形：只留最近 MAX_ENTRIES 条，满了丢最旧的。
// 每条最多列 MAX_FILES_PER_ENTRY 个文件名，多出来的折成一句「另有 N 个」，
// 这样单条体积也有上界。两项叠起来，文件稳定在几十 KB 以内。
//
// 记录本身不是审计底账：文件进了系统回收站，真要找回是去回收站里翻，
// 这里只是让人事后能看出「什么时候清过、大概清了什么」。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE_NAME = "cleanup-log.json";
const MAX_ENTRIES = 50;
const MAX_FILES_PER_ENTRY = 10;

let logFilePath = null;

export function configureCleanupLog({ dataDir }) {
  if (typeof dataDir !== "string" || !dataDir) {
    logFilePath = null;
    return { enabled: false };
  }
  logFilePath = path.join(dataDir, FILE_NAME);
  return { enabled: true, path: logFilePath };
}

function readRaw() {
  if (!logFilePath) return [];
  try {
    const parsed = JSON.parse(readFileSync(logFilePath, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(list)) return [];
    // 读回来的东西也要过一遍上限：文件被手工改大过，不能就此信它。
    return list.filter((e) => e && typeof e === "object").slice(-MAX_ENTRIES);
  } catch {
    // 文件不存在、被删、内容坏掉，都按「没有记录」处理。
    // 记录丢了不影响清理本身，不值得让一次提取因此失败。
    return [];
  }
}

function writeAtomic(entries) {
  if (!logFilePath) return false;
  try {
    mkdirSync(path.dirname(logFilePath), { recursive: true });
    const tmp = `${logFilePath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), "utf8");
    // 先写临时文件再改名：直接覆盖时进程崩在写一半，留下的是半截 JSON。
    renameSync(tmp, logFilePath);
    return true;
  } catch {
    return false;
  }
}

export function readCleanupLog() {
  return readRaw();
}

/**
 * 追加一条清理记录。
 *
 * @param {{ at: number, freedBytes: number, groups: number, removed: number,
 *           failed: number, files: string[], note?: string }} entry
 */
export function appendCleanupLog(entry) {
  const files = Array.isArray(entry?.files) ? entry.files.map(String) : [];
  const record = {
    at: Number(entry?.at) || Date.now(),
    freedBytes: Number(entry?.freedBytes) || 0,
    groups: Number(entry?.groups) || 0,
    removed: Number(entry?.removed) || 0,
    failed: Number(entry?.failed) || 0,
    files: files.slice(0, MAX_FILES_PER_ENTRY),
    moreFiles: Math.max(0, files.length - MAX_FILES_PER_ENTRY),
  };
  if (entry?.note) record.note = String(entry.note);

  const entries = readRaw();
  entries.push(record);
  const kept = entries.slice(-MAX_ENTRIES);
  if (!writeAtomic(kept)) return null;
  return record;
}

export function clearCleanupLog() {
  return writeAtomic([]);
}

export const CLEANUP_LOG_LIMITS = { MAX_ENTRIES, MAX_FILES_PER_ENTRY };
