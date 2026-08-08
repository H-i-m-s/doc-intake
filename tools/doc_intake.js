import { extractDocument } from "../lib/service.js";
import { toToolError, toToolResult, toToolResultWithContent } from "../lib/tool-output.js";
import { getSettings } from "../lib/settings.js";
import { Semaphore } from "../lib/semaphore.js";
import { statSync, readdirSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, parse, resolve } from "node:path";

const SUPPORTED_EXTS = new Set([
  ".pdf", ".docx", ".pptx", ".ppt", ".xlsx", ".xlsm",
  ".html", ".htm",
  ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif",
]);

function isSupported(filePath) {
  return SUPPORTED_EXTS.has(extname(filePath).toLowerCase());
}

function expandPaths(paths) {
  const result = [];
  for (const p of paths) {
    try {
      const stat = statSync(p);
      if (stat.isDirectory()) {
        for (const f of readdirSync(p)) {
          const fullPath = join(p, f);
          if (statSync(fullPath).isFile() && isSupported(fullPath)) {
            result.push(fullPath);
          }
        }
      } else if (stat.isFile() && isSupported(p)) {
        result.push(p);
      }
    } catch {
      // 路径无效则跳过
    }
  }
  return result;
}

function entryBackendKind(source, input, settings) {
  const explicit = input?.backend;
  if (explicit && explicit !== "auto") {
    return explicit === "local" ? "local" : "api";
  }

  const ext = extname(source).toLowerCase();
  if (ext === ".pdf") {
    const chain = settings?.pdfBackendChain || ["local"];
    return chain[0] === "local" ? "local" : "api";
  }
  if ([".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"].includes(ext)) {
    return "api";
  }
  return "local";
}

async function runOne(source, input, ctx) {
  try {
    const result = await extractDocument({ ...input, source }, ctx);
    return { ok: true, source, result };
  } catch (error) {
    return { ok: false, source, error };
  }
}

const DEFAULT_MEDIA_PATH_RETURN_LIMIT = 20;

function normalizeMediaPathReturnLimit(settings = {}) {
  const configured = Number(settings.mediaPathReturnLimit);
  if (!Number.isFinite(configured)) return DEFAULT_MEDIA_PATH_RETURN_LIMIT;
  return Math.max(0, Math.floor(configured));
}

function absolutePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = normalize(value);
  return isAbsolute(normalized) ? normalized : resolve(normalized);
}

function normalizeMediaPaths(paths, mediaDir) {
  if (!Array.isArray(paths)) return [];
  const absoluteDir = absolutePath(mediaDir);
  return paths
    .map((value) => {
      if (typeof value !== "string" || !value.trim()) return null;
      const normalized = normalize(value);
      if (isAbsolute(normalized)) return normalized;
      return absoluteDir ? join(absoluteDir, basename(normalized)) : null;
    })
    .filter(Boolean);
}

function inferMediaDir(mediaPaths) {
  const firstAbsolutePath = mediaPaths.find((value) => isAbsolute(value));
  return firstAbsolutePath ? dirname(firstAbsolutePath) : null;
}

function deriveMediaDir({ outputDir, mdPath, source }) {
  const absoluteMarkdownPath = absolutePath(mdPath);
  if (absoluteMarkdownPath) {
    const markdownName = basename(absoluteMarkdownPath);
    const sourceFilename = markdownName.endsWith(".md")
      ? markdownName.slice(0, -3)
      : markdownName;
    const stem = parse(sourceFilename).name;
    if (stem) return join(dirname(absoluteMarkdownPath), `${stem}_media`);
  }

  const absoluteOutputDir = absolutePath(outputDir);
  const sourceStem = typeof source === "string" ? parse(basename(source)).name : "";
  if (absoluteOutputDir && sourceStem) {
    return join(absoluteOutputDir, `${sourceStem}_media`);
  }
  return null;
}

async function processFiles(sources, input, ctx, settings) {
  const apiSem = new Semaphore(input._apiConcurrency ?? 4);
  const localSem = new Semaphore(input._localConcurrency ?? 8);

  const tasks = sources.map((source) => {
    const kind = entryBackendKind(source, input, settings);
    const sem = kind === "api" ? apiSem : localSem;
    return sem.run(() => runOne(source, input, ctx));
  });

  const settled = await Promise.allSettled(tasks);
  return settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    return {
      ok: false,
      source: sources[index],
      error: item.reason instanceof Error ? item.reason : new Error(String(item.reason)),
    };
  });
}

function toFileOutput(item) {
  if (!item.ok) {
    const errorMessage = item.error?.message ?? "未知错误";
    return {
      name: item.source,
      status: "failed",
      error: errorMessage,
      warnings: [errorMessage],
      markdown: `❌ 解析失败: ${errorMessage}`,
    };
  }

  const result = item.result;
  const metadata = result.metadata ?? {};
  const rawMediaPaths = Array.isArray(metadata.mediaPaths) ? metadata.mediaPaths : [];
  let mediaDir = absolutePath(metadata.mediaDir);
  let mediaPaths = normalizeMediaPaths(rawMediaPaths, mediaDir);
  if (!mediaDir && mediaPaths.length > 0) {
    mediaDir = inferMediaDir(mediaPaths);
  }
  if (!mediaDir && rawMediaPaths.length > 0) {
    mediaDir = deriveMediaDir({
      outputDir: result.outputDir,
      mdPath: metadata.mdPath,
      source: item.source,
    });
  }
  if (mediaDir) {
    mediaPaths = normalizeMediaPaths(rawMediaPaths, mediaDir);
  }
  const rawMediaCount = rawMediaPaths.filter((value) => {
    if (typeof value === "string") return Boolean(value.trim());
    return value !== null && value !== undefined;
  }).length;
  const unresolvedMediaCount = Math.max(0, rawMediaCount - mediaPaths.length);
  const saveFailed = metadata.saveStatus === "failed";
  const warnings = Array.isArray(result.warnings)
    ? [...result.warnings]
    : (Array.isArray(metadata.warnings) ? [...metadata.warnings] : []);
  if (unresolvedMediaCount > 0) {
    warnings.push("部分媒体路径缺少可用的绝对路径基准，未返回这些媒体的路径");
  }
  const saveError = saveFailed
    ? warnings.find((warning) => String(warning).startsWith("保存失败")) ?? "保存失败"
    : null;
  return {
    name: item.source,
    status: saveFailed ? "failed" : "success",
    ...(saveError ? { error: saveError } : {}),
    outputDir: absolutePath(result.outputDir),
    mdPath: absolutePath(metadata.mdPath),
    mediaDir,
    jsonPath: absolutePath(metadata.jsonPath),
    mediaPaths,
    unresolvedMediaCount,
    format: metadata.format ?? null,
    reader: metadata.reader ?? null,
    backendChain: metadata.backendChain ?? null,
    warnings,
    usedBackendInChain: metadata.usedBackendInChain ?? null,
    usedBackend: metadata.usedBackend ?? null,
    usedBackends: metadata.usedBackends ?? [],
    markdown: result.markdown ?? "",
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
  return metadata;
}

function buildAgentPathContent(filesOut, settings = {}) {
  const files = filesOut
    .map((file) => {
      const metadata = buildFileMetadata(file, settings);
      const paths = {};
      for (const key of ["mdPath", "mediaDir", "mediaPaths", "mediaCount", "jsonPath"]) {
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
  "提取文档/图片内容，输出 Markdown。支持 PDF（MinerU）、图片（PaddleOCR）、Office 文档（本地解析）。";

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
      enum: ["auto", "mineru", "paddleocr", "local"],
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
    const sources = expandPaths(input.source || []);
    if (sources.length === 0) {
      throw new Error("没有找到可解析的文件，或路径无效");
    }

    const settings = getSettings(ctx);
    const enrichedInput = {
      ...input,
      _apiConcurrency: settings.maxConcurrent ?? 4,
      _localConcurrency: settings.maxConcurrentLocal ?? 8,
    };
    const results = await processFiles(sources, enrichedInput, ctx, settings);
    return buildResult(sources, results, settings, {
      summaryOnly: input.summaryOnly === true,
    });
  } catch (error) {
    return toToolError(error, {
      action: name,
      source: input.source ? input.source.join(", ") : null,
    });
  }
}
