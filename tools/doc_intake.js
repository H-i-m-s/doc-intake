import { cardInstanceIdFor, getJob } from "../lib/jobs.js";
import {
  entryBackendKind,
  expandSourcesWithPython,
  LEGACY_OFFICE_EXTS,
  processFiles,
  toFileOutput,
} from "../lib/extract-batch.js";
import { startJob } from "../lib/job-runner.js";
import { toToolError, toToolResult, toToolResultWithContent } from "../lib/tool-output.js";
import { getSettings } from "../lib/settings.js";
import { scheduleAutoCleanup } from "../lib/cleanup.js";
import { DocIntakeError } from "../lib/errors.js";
import {
  buildTokenNotice,
  evaluateTokenStatus,
  probeTokenFields,
  readStatus,
  readTokenConfig,
  recordAuthFailures,
  shouldBackgroundProbe,
  writeStatus,
} from "../lib/token-status.js";
import { basename, extname } from "node:path";

/** 进度卡在宿主里显示的名字，与 manifest 的 id 一起构成卡片身份。 */
const CARD_TITLE = "文档解析";

function isLegacyOfficeSource(source) {
  return LEGACY_OFFICE_EXTS.has(extname(source).toLowerCase());
}

const DEFAULT_MEDIA_PATH_RETURN_LIMIT = 20;

function normalizeMediaPathReturnLimit(settings = {}) {
  const configured = Number(settings.mediaPathReturnLimit);
  if (!Number.isFinite(configured)) return DEFAULT_MEDIA_PATH_RETURN_LIMIT;
  return Math.max(0, Math.floor(configured));
}

// ── 异步作业：云端后端可能跑几分钟，宿主 RPC 只有 30 秒 ────────────────────
//
// 分叉点就在后端类别：只要有一个文件走云端，整批就转后台，因为同一个工具调用里
// 同步等一个云端文件也照样超时。全是本地后端时保持原样同步返回。
//
// 卡片身份的推导（cardInstanceIdFor）与反查都在 lib/jobs.js：卡片 iframe 里只有
// cardInstanceId，生成与反查必须同一个公式，分两处写迟早会对不上。

function jobLabel(sources) {
  if (sources.length === 1) return `解析 ${basename(sources[0])}`;
  return `解析 ${sources.length} 个文件`;
}

function cardDescription(sources) {
  return sources.length === 1 ? basename(sources[0]) : `${sources.length} 个文件`;
}

async function startAsyncJob({ sources, input, ctx, settings, enrichedInput }) {
  const sdk = ctx?.sdk ?? null;
  const callToken = ctx?.invocation?.callToken ?? null;

  // 宿主任务必须在这次 execute 里建好并在返回前拿到 taskId：callToken 只在本次
  // 调用窗口内有效，等后台跑完再 create 就再也建不出来，结果只能闷在作业表里。
  // 顺序上先建任务再建作业：作业一落地就开始跑，回执要拿 taskId 认人。
  let taskId = null;
  if (callToken && typeof sdk?.tasks?.create === "function") {
    try {
      const task = await sdk.tasks.create({
        callToken,
        label: jobLabel(sources),
        delivery: "next-step",
      });
      taskId = task?.taskId ?? null;
    } catch (error) {
      await ctx?.logger?.error?.(`创建宿主任务失败，本次只跑后台：${error?.message || error}`);
    }
  }

  // 作业本身（建、跑、逐文件落状态、收尾、清理）全在 lib/job-runner.js。
  // 这里只留着宿主任务那一段：建已在上头，回执在这里。
  const { jobId } = await startJob({
    sources,
    input: enrichedInput,
    ctx,
    settings,
    runBatch: processFiles,
    onFinish: async ({ state, text }) => {
      if (!taskId) return;
      try {
        if (state === "done") {
          await sdk.tasks.complete(taskId, { text });
        } else {
          await sdk.tasks.fail(taskId, text);
        }
      } catch (error) {
        await ctx?.logger?.error?.(`宿主任务回执失败：${error?.message || error}`);
      }
    },
  });

  const text = [
    `已开始后台解析：${cardDescription(sources)}`,
    `任务 ID：${jobId}`,
    // 三种情形分开说：建成了、有凭据但建失败、压根没有凭据。
    // 混成一句会让排查时看不出到底卡在哪一步。
    taskId
      ? "完成后会把结果自动投回本会话，聊天流里已挂进度卡片。"
      : callToken
        ? "宿主任务没建成，结果只写进作业表（/job-status?id= 可查），不会自动回投。"
        : "本次没拿到宿主调用凭据，结果只写进作业表（/job-status?id= 可查）。",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    details: {
      bridgedTool: { name, server: "doc-intake" },
      card: {
        pluginId: "doc-intake",
        cardId: `di-${jobId}`,
        cardInstanceId: cardInstanceIdFor(jobId),
        // jobId 必须写进 route：宿主重新挂载卡片时不保证及时注入 cardInstanceId，
        // 卡片自己读 URL 就能拿到作业身份，不必跟宿主的注入时序赌气。
        route: `/card.html?job=${encodeURIComponent(jobId)}`,
        title: CARD_TITLE,
        description: cardDescription(sources),
        aspectRatio: "8:1",
        cardForm: "flush",
        preferredWidthPx: 460,
        titlebar: null,
      },
      job: getJob(jobId),
    },
  };
}

function buildFileMetadata(file, settings = {}) {
  const metadata = {
    outputDir: file.outputDir ?? null,
    format: file.format ?? null,
    reader: file.reader ?? null,
    backendChain: file.backendChain ?? null,
    warnings: file.warnings ?? [],
    usedBackendInChain: file.usedBackendInChain ?? null,
    usedBackend: file.usedBackend ?? null,
    usedBackends: file.usedBackends ?? [],
  };
  if (file.mdPath) metadata.mdPath = file.mdPath;
  if (file.originalFormat) metadata.originalFormat = file.originalFormat;
  if (file.convertedFormat) metadata.convertedFormat = file.convertedFormat;
  if (file.conversionProvider) metadata.conversionProvider = file.conversionProvider;
  if (file.conversionStatus) metadata.conversionStatus = file.conversionStatus;
  if (file.conversionErrorCode) metadata.conversionErrorCode = file.conversionErrorCode;
  if (Array.isArray(file.conversionWarnings) && file.conversionWarnings.length > 0) {
    metadata.conversionWarnings = file.conversionWarnings;
  }
  if (file.conversionDurationMs !== null && file.conversionDurationMs !== undefined) {
    metadata.conversionDurationMs = file.conversionDurationMs;
  }
  if (file.mediaDir) {
    metadata.mediaDir = file.mediaDir;
    const limit = normalizeMediaPathReturnLimit(settings);
    if (file.unresolvedMediaCount > 0) {
      metadata.mediaCount = file.mediaPaths.length + file.unresolvedMediaCount;
    } else if (file.mediaPaths.length <= limit) {
      metadata.mediaPaths = file.mediaPaths;
    } else {
      metadata.mediaCount = file.mediaPaths.length;
    }
  } else if (file.unresolvedMediaCount > 0) {
    metadata.mediaCount = file.unresolvedMediaCount;
  }
  if (file.jsonPath) metadata.jsonPath = file.jsonPath;
  if (Array.isArray(file.barcodeCodes) && file.barcodeCodes.length > 0) {
    metadata.barcodeCodes = file.barcodeCodes;
  }
  if (file.barcodeOnlyDocument === true) {
    metadata.barcodeOnlyDocument = true;
  }
  return metadata;
}

function buildAgentPathContent(filesOut, settings = {}) {
  const files = filesOut
    .map((file) => {
      const metadata = buildFileMetadata(file, settings);
      const paths = {};
      for (const key of ["mdPath", "mediaDir", "mediaPaths", "mediaCount", "jsonPath", "originalFormat", "convertedFormat", "conversionProvider", "conversionStatus", "conversionErrorCode", "conversionWarnings", "conversionDurationMs"]) {
        if (metadata[key] !== undefined) paths[key] = metadata[key];
      }
      if (Object.keys(paths).length === 0 && !file.error) return null;
      return {
        name: file.name,
        status: file.status,
        ...(file.error ? { error: file.error } : {}),
        ...paths,
      };
    })
    .filter(Boolean);

  if (files.length === 0) return [];
  return [{
    type: "text",
    text: JSON.stringify({ doc_intake_paths: files }),
  }];
}

function buildStatusSummary(filesOut, reason = "summary_only", settings = {}) {
  const successCount = filesOut.filter((file) => file.status === "success").length;
  const failedCount = filesOut.length - successCount;
  const summary = filesOut.map((file) => {
    const ok = file.status === "success";
    const detail = ok ? "" : ` — ${file.error ?? file.warnings?.[0] ?? "解析失败"}`;
    return `${ok ? "✅" : "❌"} ${file.name}${detail}`;
  });
  return {
    markdown: [`处理完成：${successCount}/${filesOut.length} 个文件成功`, "", ...summary].join("\n"),
    metadata: {
      summaryOnly: reason === "summary_only",
      contentOmitted: true,
      returnReason: reason,
      count: filesOut.length,
      success: successCount,
      failed: failedCount,
    },
    files: filesOut.map((file) => ({
      name: file.name,
      status: file.status,
      ...(file.error ? { error: file.error } : {}),
      metadata: buildFileMetadata(file, settings),
    })),
  };
}

function buildSavedSummary(filesOut, settings = {}) {
  return buildStatusSummary(filesOut, "inline_return_limit_exceeded", settings);
}

function truncateWithoutBreakingUtf8(text, maxBytes) {
  const buffer = Buffer.from(String(text ?? ""), "utf8");
  if (buffer.length <= maxBytes) return String(text ?? "");
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}

const DEFAULT_INLINE_BLOCK_BYTES = 28 * 1024;
const MIN_INLINE_BLOCK_BYTES = 4 * 1024;
const MAX_INLINE_BLOCK_BYTES = 30 * 1024;
const DEFAULT_INLINE_BLOCK_COUNT = 4;
const MAX_INLINE_BLOCK_COUNT = 8;

function normalizeInlineSettings(settings = {}) {
  const configuredBytes = Number(settings.inlineBlockBytes);
  const configuredCount = Number(settings.inlineBlockCount);
  const blockBytes = Math.min(
    MAX_INLINE_BLOCK_BYTES,
    Math.max(
      MIN_INLINE_BLOCK_BYTES,
      Number.isFinite(configuredBytes) ? Math.floor(configuredBytes) : DEFAULT_INLINE_BLOCK_BYTES,
    ),
  );
  const blockCount = Math.min(
    MAX_INLINE_BLOCK_COUNT,
    Math.max(
      1,
      Number.isFinite(configuredCount) ? Math.floor(configuredCount) : DEFAULT_INLINE_BLOCK_COUNT,
    ),
  );
  return { blockBytes, blockCount };
}

function splitUtf8Text(text, maxBytes, maxBlocks) {
  const source = String(text ?? "");
  const buffer = Buffer.from(source, "utf8");
  if (buffer.length <= maxBytes) return { blocks: [source], complete: true };

  const blocks = [];
  let offset = 0;
  while (offset < buffer.length && blocks.length < maxBlocks) {
    const limit = Math.min(offset + maxBytes, buffer.length);
    let end = limit;
    let nextOffset = limit;
    if (limit < buffer.length) {
      const newline = buffer.lastIndexOf(0x0a, limit - 1);
      if (newline >= offset) {
        end = newline + 1;
        nextOffset = end;
      }
    }
    while (end > offset && (buffer[end] & 0xc0) === 0x80) end -= 1;
    if (end <= offset) {
      // 当前配置下不会触发（最小块大小远大于最长 UTF-8 字符），但保证 helper 在异常参数下仍然推进。
      end = Math.min(offset + 1, buffer.length);
    }
    nextOffset = end;
    blocks.push(buffer.subarray(offset, end).toString("utf8"));
    offset = nextOffset;
  }
  return { blocks, complete: offset >= buffer.length };
}

function buildReadableText(filesOut) {
  if (filesOut.length === 1) return filesOut[0].markdown ?? "";
  return filesOut
    .map((file) => `## ${file.name}\n\n${file.markdown ?? ""}`)
    .join("\n\n");
}

function buildInlineContent(text, settings) {
  const { blockBytes, blockCount } = normalizeInlineSettings(settings);
  const split = splitUtf8Text(text, blockBytes, blockCount);
  return {
    content: split.blocks.map((block) => ({ type: "text", text: block })),
    complete: split.complete,
    blockBytes,
    blockCount,
  };
}

function fitHeadTailToInline(text, settings, suffix = "") {
  const { blockBytes, blockCount } = normalizeInlineSettings(settings);
  const capacity = blockBytes * blockCount;
  const source = String(text ?? "");
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  let low = 0;
  let high = Math.max(0, capacity - suffixBytes);
  let best = suffix;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = headTailText(source, mid) + suffix;
    const split = splitUtf8Text(candidate, blockBytes, blockCount);
    if (split.complete) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function headTailText(text, maxBytes) {
  const source = String(text ?? "");
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes <= maxBytes) return source;

  const marker = "\n\n[中间内容已省略]\n\n";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (maxBytes <= markerBytes) return truncateWithoutBreakingUtf8(source, maxBytes);

  const contentBytes = maxBytes - markerBytes;
  const headBytes = Math.ceil(contentBytes * 0.4);
  const tailBytes = contentBytes - headBytes;
  const head = truncateWithoutBreakingUtf8(source, headBytes);
  const tailBuffer = Buffer.from(source, "utf8");
  let tailStart = Math.max(0, tailBuffer.length - tailBytes);
  while (tailStart < tailBuffer.length && (tailBuffer[tailStart] & 0xc0) === 0x80) tailStart += 1;
  const tail = tailBuffer.subarray(tailStart).toString("utf8");
  return head + marker + tail;
}

export function buildResult(sources, results, settings = {}, options = {}) {
  const filesOut = results.map(toFileOutput);
  if (options.summaryOnly === true) {
    const payload = buildStatusSummary(filesOut, "summary_only", settings);
    const pathContent = buildAgentPathContent(filesOut, settings);
    return toToolResultWithContent(
      payload,
      [{ type: "text", text: payload.markdown }, ...pathContent],
    );
  }
  const fullPayload = filesOut.length === 1
    ? { name: filesOut[0].name, markdown: filesOut[0].markdown ?? "", metadata: buildFileMetadata(filesOut[0], settings) }
    : filesOut.map((file) => ({
      name: file.name,
      markdown: file.markdown ?? "",
      metadata: buildFileMetadata(file, settings),
    }));
  const fullText = buildReadableText(filesOut);
  const inline = buildInlineContent(fullText, settings);

  if (inline.complete) {
    return toToolResultWithContent(
      fullPayload,
      [...inline.content, ...buildAgentPathContent(filesOut, settings)],
    );
  }

  if (filesOut.some((file) => Boolean(file.mdPath))) {
    const payload = buildSavedSummary(filesOut, settings);
    return toToolResultWithContent(payload, buildAgentPathContent(filesOut, settings));
  }

  const { blockBytes, blockCount } = normalizeInlineSettings(settings);
  const limitLabel = `${blockCount} × ${Math.round(blockBytes / 1024)} KiB`;
  const notice = `\n\n⚠️ 返回内容超过 ${limitLabel}，以下仅保留开头和结尾；完整结果未保存到本地，中间内容无法读取。`
    + " 如需完整内容，请指定 outputDir 或开启自动保存。";
  const truncatedText = fitHeadTailToInline(fullText, settings, notice);
  const truncated = buildInlineContent(truncatedText, settings);
  const metadata = filesOut.length === 1
    ? {
      ...buildFileMetadata(filesOut[0], settings),
      contentTruncated: true,
      returnReason: "inline_return_limit_exceeded",
      inlineBlockBytes: blockBytes,
      inlineBlockCount: blockCount,
    }
    : {
      contentTruncated: true,
      returnReason: "inline_return_limit_exceeded",
      count: filesOut.length,
      inlineBlockBytes: blockBytes,
      inlineBlockCount: blockCount,
    };
  const payload = filesOut.length === 1
    ? {
      name: filesOut[0].name,
      markdown: truncatedText,
      metadata,
    }
    : {
      markdown: truncatedText,
      metadata,
      files: filesOut.map((file) => ({
        name: file.name,
        metadata: buildFileMetadata(file, settings),
      })),
    };
  return toToolResultWithContent(
    payload,
    [...truncated.content, ...buildAgentPathContent(filesOut, settings)],
  );
}

export const name = "doc_intake";
export const description =
  "提取文档/图片内容，输出 Markdown。支持 PDF（MinerU）、图片（PaddleOCR）、Office 文档（本地解析，含 DOC/XLS/PPT 旧格式转换）。"
  + "图片和文档里的二维码、条码会随提取一并解出，不需要额外参数或另找工具。"
  + "若返回里带 tokenNotice 字段，说明用户的云端 Token（MinerU / PaddleOCR）有问题，需要按它里面的 text 提醒用户。";

export const parameters = {
  type: "object",
  properties: {
    source: {
      type: "array",
      items: { type: "string" },
      description: "文件路径列表（支持单个或多个文件，也支持文件夹路径）",
    },
    outputDir: {
      type: "string",
      description: "保存目录（可选）",
    },
    backend: {
      type: "string",
      enum: ["auto", "mineru", "paddleocr", "mineru-local", "paddleocr-local", "local"],
      description: "解析后端（可选，默认 auto）",
    },
    pageRange: {
      type: "string",
      description: "PDF 页码范围（可选）",
    },
    language: {
      type: "string",
      description: "语言（可选）",
    },
    includeMedia: {
      type: "boolean",
      default: true,
      description: "默认值为 true。只有用户明确说不要提取、不要保存或不需要图片/视频/音频时才传 false；用户说保存 JSON、正文可省略、只返回摘要或减少正文，不等于不要提取媒体。未明确要求排除媒体时必须省略此字段。",
    },
    saveJson: {
      type: "boolean",
      description: "是否保存 JSON（可选）",
    },
    splitOnly: {
      type: "boolean",
      description: "仅做图片分割测试，不调用后端（可选）",
    },
    summaryOnly: {
      type: "boolean",
      description: "只返回每个文件的成功/失败状态，不返回正文（可选）",
    },
  },
  required: ["source"],
};

export async function execute(input = {}, ctx) {
  try {
    const settings = getSettings(ctx);
    if (!settings.pythonPath) {
      throw new DocIntakeError(
        "未在应用设置中指定 Python 环境 (pythonPath)。请打开 App 设置面板填写。",
        { code: "PYTHON_PATH_NOT_CONFIGURED", details: { configKey: "pythonPath" } },
      );
    }
    const sources = await expandSourcesWithPython(settings.pythonPath, input.source || []);
    if (sources.length === 0) {
      throw new Error("没有找到可解析的文件，或路径无效");
    }

    // 自动清理在提取开头起个头就走，不 await。两个理由：
    // 一是它和本次提取没有依赖，让主流程等它纯属浪费；
    // 二是放在开头而不是收尾，是因为这时本次要产出的文件还不存在，
    // 扫到的都是上一轮留下的，不会把自己刚写的东西当成过期文件带走。
    scheduleAutoCleanup({ settings, ctx, logger: ctx?.logger });

    const enrichedInput = {
      ...input,
      _apiConcurrency: settings.maxConcurrent ?? 4,
      _localConcurrency: settings.maxConcurrentLocal ?? 8,
      _legacyConversionConcurrency: settings.legacyConversionConcurrency ?? 1,
    };

    // 只要有一个文件走云端，整批就转后台：同一个 RPC 里同步等一个云端文件也照样超时。
    // 全本地（含 legacy 转换）输入走下面原样的同步路径。
    const kinds = sources.map((source) => entryBackendKind(source, input, settings));
    if (kinds.some((kind) => kind === "api")) {
      return await startAsyncJob({ sources, input, ctx, settings, enrichedInput });
    }

    const results = await processFiles(sources, enrichedInput, ctx, settings);
    const out = buildResult(sources, results, settings, {
      summaryOnly: input.summaryOnly === true,
    });

    const tokenNotice = await applyTokenStatus(results, ctx);
    if (tokenNotice) {
      // 两个地方都放：content 是模型真正读到的那份，details.data 留给上层程序读。
      out.content = [...(out.content || []), { type: "text", text: tokenNotice.text }];
      out.details = {
        ...(out.details || {}),
        data: { ...(out.details?.data || {}), tokenNotice },
      };
    }
    return out;
  } catch (error) {
    return toToolError(error, {
      action: name,
      source: input.source ? input.source.join(", ") : null,
    });
  }
}

// 更新 Token 健康状态，并给出这次要不要提示。
//
// 次序有讲究，不能反：
//   1) 先把这次提取真实撞到的鉴权拒绝并进状态（最硬的证据，不是猜的）
//   2) 再算要不要提示 —— 读的是刚更新过的状态
//   3) 最后顺手判断该不该后台补探（不 await，结论留给下次）
// 拿不到存储就整段跳过：提示是附加信息，不能因为它把提取结果搞坏。
async function applyTokenStatus(results, ctx) {
  const storage = ctx?.storage;
  if (!storage?.global) return null;
  try {
    const config = readTokenConfig(ctx);

    const failures = [];
    for (const item of Array.isArray(results) ? results : []) {
      const list = item?.ok ? item?.result?.metadata?.authFailures : null;
      if (Array.isArray(list)) failures.push(...list);
    }

    let status = readStatus(storage);
    if (failures.length > 0) {
      status = recordAuthFailures(status, config, failures);
      writeStatus(storage, status);
    }
    const notice = buildTokenNotice(evaluateTokenStatus(config, status));

    // 距上次探测超过窗口就补探一次。不 await：这次提取不为它多等一轮网络。
    if (shouldBackgroundProbe(config, status)) {
      const hostFetch = ctx?.network?.fetch;
      const fetchImpl = typeof hostFetch === "function" ? hostFetch.bind(ctx.network) : null;
      if (fetchImpl) {
        probeTokenFields({ config, status, fetchImpl, storage }).catch((error) => {
          void ctx?.logger?.debug?.(`Token 后台补探失败：${error?.message || error}`);
        });
      }
    }
    return notice;
  } catch {
    return null;
  }
}
