// 自动清理：把保存目录里超过保留时长的提取产出移到系统回收站。
//
// 分工是这么切的：
//
//   扫目录、认产出、算过期  →  被 spawn 的 Python 子进程（python/cleanup_scan.py）
//   删除                    →  python/recycle.py 调 shell32 的 SHFileOperationW
//
// 为什么这么切：JS 进程跑在 Node Permission Model 下，读许可根以外的路径会被拒，
// 而保存目录是用户自己填的，基本都在许可根外。删除交给同一个 Python 子进程顺手做：
// 宿主那条 resources.trash 在 Windows 上是 rename 进 ~/.hanako/trash，保存目录在别的盘
// （D:）时会直接 EXDEV 失败——回收站是按卷存的，跨卷 rename 本来就不允许。
// SHFileOperationW + FOF_ALLOWUNDO 交给系统自己的回收站，跨卷由系统处理，
// 而且仍然是可撤销的「删除」，不是直接抹掉。宿主的 resources.trash 留作非 Windows 的退路。
//
// 为什么删之前要有这么多条件：保存路径可以填任意目录，用户完全可能填成手上有别的
// 文件的文件夹。认不出是插件产出的东西一律不动，宁可漏删。

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendCleanupLog } from "./cleanup-log.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

/** 单位换算。设置里存的是「数值 + 单位」两格，这里把它们折成毫秒。 */
export const CLEANUP_UNITS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/**
 * 任何条目至少存在这么久才允许删。
 *
 * 保留时长可以设到 1 分钟。一个批量任务里先完成的文件，到任务收尾时
 * 已经算「过期」了，这条兜底让它不会被自己的清理顺手带走。
 */
export const MIN_AGE_MS = 60 * 1000;

export function retentionMs(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const multiplier = CLEANUP_UNITS[String(unit)] ?? CLEANUP_UNITS.day;
  return Math.round(n * multiplier);
}

/**
 * 保存路径是否落在「一类位置」上。
 *
 * 这类目录里混着用户别的东西，按时间挑文件等于拿别人的数据冒险。
 * 只做字符串比较，不碰文件系统：JS 侧在这儿也 stat 不了目标目录。
 */
export function unsafeRootReason(dir) {
  const resolved = resolve(dir);
  if (parse(resolved).root === resolved) return "这是盘符根目录";
  const home = homedir();
  const banned = [
    home,
    join(home, "Desktop"),
    join(home, "Documents"),
    join(home, "Downloads"),
  ];
  for (const candidate of banned) {
    if (resolve(candidate) === resolved) return "这是桌面、文档或下载这类根目录";
  }
  return "";
}

function scanWithPython(pythonExe, payload) {
  return runPythonScript(pythonExe, "cleanup_scan.py", payload, "扫描保存目录失败");
}

/** 把一个列表里的东西交给系统回收站（Windows）。非 Windows 或 Python 不可用时抛。 */
function trashWithPython(pythonExe, paths) {
  return runPythonScript(pythonExe, "recycle.py", { paths }, "移入回收站失败");
}

function runPythonScript(pythonExe, scriptName, payload, label) {
  const scriptPath = join(CURRENT_DIR, "..", "python", scriptName);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pythonExe, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
      timeout: 120000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => rejectPromise(new Error(`${label}: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`${label}(退出码 ${code}): ${(stderr || stdout).slice(0, 300)}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        rejectPromise(new Error(`${label}: 输出解析失败 ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/**
 * 扫一遍并删掉过期的组，返回摘要供记录与设置页使用。
 *
 * 调用方拿到 Promise 后不要 await：这一步和提取流程没有依赖关系，
 * 让它自己跑完就行。内部的 await 只用于按顺序删完一组再删下一组。
 */
export async function runCleanup({ pythonExe, dir, keepMs, resources, logger, now = Date.now() }) {
  const summary = {
    ok: false,
    scanned: 0,
    groups: 0,
    removed: 0,
    failed: 0,
    freedBytes: 0,
    files: [],
    skippedFresh: 0,
    dir: dir || "",
    reason: "",
  };

  if (!pythonExe) {
    summary.reason = "没有配置 Python 路径";
    return summary;
  }
  if (!keepMs || keepMs <= 0) {
    summary.reason = "保留时长算出来不是正数";
    return summary;
  }

  // 先扫。dir 留空时由 Python 算默认目录，它会把实际用的是哪个目录带回来，
  // 安全判断要用那个真值，不能用这边的空字符串去猜。
  let scan;
  try {
    scan = await scanWithPython(pythonExe, { dir: dir || "", keepMs, minAgeMs: MIN_AGE_MS, now });
  } catch (error) {
    summary.reason = (error && error.message) || String(error);
    if (typeof logger?.warn === "function") await logger.warn(summary.reason);
    return summary;
  }

  const actualDir = typeof scan?.dir === "string" && scan.dir ? scan.dir : dir;
  summary.dir = actualDir;

  const unsafe = actualDir ? unsafeRootReason(actualDir) : "没有保存路径";
  if (unsafe) {
    summary.reason = unsafe;
    return summary;
  }

  summary.ok = true;
  summary.reason = scan?.reason || "";
  summary.scanned = Number(scan?.scanned) || 0;
  summary.skippedFresh = Number(scan?.skippedFresh) || 0;

  const groups = Array.isArray(scan?.groups) ? scan.groups : [];
  const targets = [];
  for (const group of groups) {
    for (const member of Array.isArray(group?.members) ? group.members : []) {
      const path = typeof member?.path === "string" ? member.path : "";
      if (!path) continue;
      targets.push({ path, size: Number(member?.size) || 0 });
    }
  }
  if (targets.length === 0) return summary;

  // 一次把整批交给系统回收站：跨卷由系统按各自卷的 $RECYCLE.BIN 处理。
  // 先走 python/recycle.py（SHFileOperation），失败的再退回宿主的 resources.trash。
  const trashed = new Set();
  const failures = [];
  try {
    const outcome = await trashWithPython(pythonExe, targets.map((item) => item.path));
    for (const path of outcome?.ok || []) trashed.add(path);
    for (const row of outcome?.failed || []) failures.push(row);
  } catch (error) {
    const why = (error && error.message) || String(error);
    if (typeof logger?.warn === "function") await logger.warn(`系统回收站不可用，改用宿主接口：${why}`);
    for (const item of targets) failures.push({ path: item.path, error: why });
  }

  const stillFailing = [];
  for (const row of failures) {
    if (trashed.has(row.path)) continue;
    if (!resources || typeof resources.trash !== "function") {
      stillFailing.push(row);
      continue;
    }
    try {
      await resources.trash({ kind: "local-file", path: row.path });
      trashed.add(row.path);
    } catch (error) {
      stillFailing.push({ path: row.path, error: (error && error.message) || String(error) });
    }
  }

  for (const item of targets) {
    if (!trashed.has(item.path)) continue;
    summary.removed += 1;
    summary.freedBytes += item.size;
    summary.files.push(basename(item.path));
  }
  // 组算删干净了才算一组，免得记录里「删了 2 组」其实还剩半组在盘上。
  for (const group of groups) {
    const members = (Array.isArray(group?.members) ? group.members : [])
      .map((member) => member?.path)
      .filter((path) => typeof path === "string" && path);
    if (members.length && members.every((path) => trashed.has(path))) summary.groups += 1;
  }
  for (const row of stillFailing) {
    summary.failed += 1;
    if (typeof logger?.warn === "function") {
      await logger.warn(`清理失败：${basename(row.path || "")} · ${row.error || "未知原因"}`);
    }
  }
  if (summary.failed > 0 && summary.removed === 0) {
    summary.reason = `${summary.failed} 个文件没能删掉`;
  }

  return summary;
}

/**
 * 按设置跑一次自动清理。返回的 Promise 不要 await。
 *
 * 它和提取流程没有依赖关系：扫描和删除都在独立子进程与宿主侧完成，
 * 调用方丢出去就走，提取该多快还多快。失败只落记录，不影响提取结果。
 */
/**
 * 从调用方的上下文里找能放进回收站的那个接口。
 *
 * ctx.resources 是 App 上下文的正式位置（HanaPluginContextV2 的成员之一）；
 * 工具入口那条路把整个 sdk 也挂了进来，所以 sdk.resources 是同一个东西的另一扇门。
 * 两处都找不到才算「宿主没有提供」——以前只认 ctx.sdk.resources，凡是没走工具
 * 入口的调用（服务入口传的是 { logger }）就一律拿不到，记录里只剩一句没有回收站接口。
 */
function pickTrash(resources, ctx) {
  const candidates = [resources, ctx?.resources, ctx?.sdk?.resources];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.trash === "function") return candidate;
  }
  return null;
}

export function scheduleAutoCleanup({ settings, ctx, resources, logger }) {
  if (settings?.cleanupEnabled !== true) return null;
  const keepMs = retentionMs(settings?.cleanupKeepValue, settings?.cleanupKeepUnit);
  const run = runCleanup({
    pythonExe: settings?.pythonPath || "",
    dir: settings?.savePath || "",
    keepMs,
    resources: pickTrash(resources, ctx),
    logger,
  }).then((summary) => {
    // 只记真的动过手的，或者被拦下来的。什么都没删的那些次不写，
    // 否则每次提取都刷一条，环形的 50 条很快就被「无事发生」占满。
    if (!summary || (summary.removed === 0 && !summary.reason)) return summary;
    appendCleanupLog({
      at: Date.now(),
      freedBytes: summary.freedBytes,
      groups: summary.groups,
      removed: summary.removed,
      failed: summary.failed,
      files: summary.files,
      note: summary.reason || "",
    });
    return summary;
  }).catch(async (error) => {
    const why = (error && error.message) || String(error);
    if (typeof logger?.warn === "function") await logger.warn(`自动清理异常：${why}`);
    return null;
  });
  return run;
}
