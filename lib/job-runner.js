// 「发起一次解析」的机器：建作业 → 跑一批 → 逐文件落状态 → 收尾 → 清理。
//
// 工具、卡片、服务三个入口共用这一段，所以这里不碰宿主任务：建任务必须在工具
// 调用的窗口内完成（callToken 只在那一刻有效），回执要不要发、怎么发也是工具
// 自己的事。startJob 只把最终结论通过 onFinish 交回去。
// 批处理本身由调用方以 runBatch 传入（现在是 lib/extract-batch.js 的 processFiles），
// 将来换成别的实现或加前置处理，都不用动作业这一层。

import { basename } from "node:path";

import { createJob, finishJob, getJob, pruneJobs, updateFile } from "./jobs.js";
import { toFileOutput } from "./extract-batch.js";

/** 作业报告里附全文的阈值（字符数）。超过就只给摘要和落盘路径。 */
const INLINE_MARKDOWN_LIMIT = 8000;

/** 进度行按文件名回指到作业里的那一行。同名文件按「还没结束的第一个」认。 */
function resolveJobFileIndex(files, name) {
  if (!name) return -1;
  let fallback = -1;
  for (let index = 0; index < files.length; index += 1) {
    if (files[index].name !== name) continue;
    if (fallback < 0) fallback = index;
    if (files[index].status === "pending" || files[index].status === "running") return index;
  }
  return fallback;
}

function makeJobProgressHandler(jobId) {
  return (event) => {
    if (!event || typeof event !== "object") return;
    const snapshot = getJob(jobId);
    if (!snapshot) return;
    const index = resolveJobFileIndex(snapshot.files, event.file);
    if (index < 0) return;
    const file = snapshot.files[index];
    const patch = { status: "running" };
    if (typeof event.backend === "string" && event.backend) {
      patch.backend = event.backend;
      // 降级链会反复经过同一个后端，记过的就不再追加，否则列表会长成一串重复。
      if (!file.triedBackends.includes(event.backend)) {
        patch.triedBackends = [...file.triedBackends, event.backend];
      }
    }
    if (typeof event.stage === "string") patch.stage = event.stage;
    if (Number.isFinite(event.attempt)) patch.attempt = event.attempt;
    if (Number.isFinite(event.pages)) patch.pages = event.pages;
    if (Number.isFinite(event.durationMs)) patch.durationMs = event.durationMs;
    updateFile(jobId, index, patch);
  };
}

function jobSummaryLine(file) {
  const name = basename(String(file.name ?? "")) || String(file.name ?? "");
  if (file.status !== "success") {
    return `❌ ${name}：${file.error ?? file.warnings?.[0] ?? "解析失败"}`;
  }
  const parts = [`✅ ${name}`];
  if (file.usedBackend) parts.push(`后端 ${file.usedBackend}`);
  if (file.mdPath) parts.push(`已保存：${file.mdPath}`);
  return parts.join(" · ");
}

function buildJobReport(filesOut) {
  const successCount = filesOut.filter((file) => file.status === "success").length;
  const lines = [
    `文档解析完成：${successCount}/${filesOut.length} 个文件成功`,
    "",
    ...filesOut.map(jobSummaryLine),
  ];
  // 全文只在总量不大时附上，否则一条宿主任务消息会被正文撑爆；mdPath 已经能拿到全文。
  const totalChars = filesOut.reduce((sum, file) => sum + String(file.markdown ?? "").length, 0);
  if (totalChars > 0 && totalChars <= INLINE_MARKDOWN_LIMIT) {
    const body = filesOut.length === 1
      ? String(filesOut[0].markdown ?? "")
      : filesOut
        .map((file) => `## ${basename(String(file.name ?? ""))}\n\n${file.markdown ?? ""}`)
        .join("\n\n");
    lines.push("", "---", "", body);
  }
  return lines.join("\n");
}

async function runJob({ jobId, sources, input, ctx, settings, runBatch, onFinish }) {
  const jobCtx = { ...ctx, onProgress: makeJobProgressHandler(jobId) };
  let results;
  try {
    results = await runBatch(sources, input, jobCtx, settings);
  } catch (error) {
    // runBatch 内部已经 allSettled，这里兜的是更外层的意外（比如信号量配置炸了）。
    const failure = error instanceof Error ? error : new Error(String(error));
    results = sources.map((source) => ({ ok: false, source, error: failure }));
  }

  results.forEach((item, index) => {
    const ok = item.ok === true;
    // 卡片的「打开文件夹」靠这个路径。只取落盘后的 mdPath，没保存就没有可开的文件。
    const saved = ok ? toFileOutput(item) : null;
    updateFile(jobId, index, {
      status: ok ? "done" : "failed",
      stage: ok ? "ok" : "fail",
      error: ok ? null : (item.error?.message ?? "未知错误"),
      mdPath: saved?.mdPath ?? null,
    });
  });

  const filesOut = results.map(toFileOutput);
  const firstError = filesOut.find((file) => file.status !== "success")?.error ?? null;
  const state = firstError ? "failed" : "done";
  const text = buildJobReport(filesOut);
  finishJob(jobId, { state, error: firstError });

  if (typeof onFinish === "function") {
    try {
      await onFinish({ state, text, files: filesOut });
    } catch (error) {
      // 回执是调用方的代码，它抛错不能反过来把已经判定的作业状态改掉。
      await ctx?.logger?.error?.(`作业完成回调失败：${error?.message || error}`);
    }
  }
  pruneJobs();
}

/**
 * 发起一次后台解析，立刻返回 { jobId }。
 * 作业本身由这里创建；要回执就在 onFinish 里做，别指望这里认识宿主。
 */
export async function startJob({ sources, input, ctx, settings, runBatch, onFinish }) {
  const jobId = createJob({
    files: sources.map((source) => ({ source, name: basename(source) })),
  });

  // 不 await：调用方要拿 jobId 立刻返回（宿主 RPC 只有 30 秒）。挂 catch 是因为
  // 没有其他人在等这次拒绝。
  runJob({ jobId, sources, input, ctx, settings, runBatch, onFinish })
    .catch((error) => {
      finishJob(jobId, { state: "failed", error: error?.message || String(error) });
      void ctx?.logger?.error?.(`后台解析作业异常：${error?.message || error}`);
    });

  return { jobId };
}
