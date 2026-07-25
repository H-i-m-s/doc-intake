import { extractDocument } from "../lib/service.js";
import { toToolError, toToolResult } from "../lib/tool-output.js";
import { getSettings } from "../lib/settings.js";
import { Semaphore } from "../lib/semaphore.js";
import { appendMediaGuide } from "../lib/doc-intake-helpers.js";
import { statSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

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

function addGuideText(result) {
  const mediaPaths = result.metadata?.mediaPaths;
  const count = Array.isArray(mediaPaths) ? mediaPaths.length : 0;
  if (count === 0) return result;

  const kindCounts = { image: 0, video: 0, audio: 0, other: 0 };
  for (const mediaPath of mediaPaths) {
    const ext = String(mediaPath).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
    const kind = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "tif", "tiff", "emf", "wmf", "wdp"].includes(ext)
      ? "image"
      : ["mp4", "mov", "webm", "m4v", "avi", "wmv"].includes(ext)
        ? "video"
        : ["mp3", "wav", "m4a", "ogg", "flac", "aac"].includes(ext)
          ? "audio"
          : "other";
    kindCounts[kind] += 1;
  }
  result.markdown = appendMediaGuide(
    result.markdown,
    count,
    kindCounts,
    Boolean(result.outputDir),
  );
  return result;
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

  const result = addGuideText(item.result);
  const metadata = result.metadata ?? {};
  return {
    name: item.source,
    outputDir: result.outputDir ?? null,
    mdPath: metadata.mdPath ?? null,
    imagesDir: metadata.imagesDir ?? null,
    jsonPath: metadata.jsonPath ?? null,
    mediaPaths: metadata.mediaPaths ?? [],
    format: metadata.format ?? null,
    reader: metadata.reader ?? null,
    backendChain: metadata.backendChain ?? null,
    warnings: metadata.warnings ?? [],
    usedBackendInChain: metadata.usedBackendInChain ?? null,
    usedBackend: metadata.usedBackend ?? null,
    usedBackends: metadata.usedBackends ?? [],
    markdown: result.markdown ?? "",
  };
}

function buildResult(sources, results, settings = {}) {
  const filesOut = results.map(toFileOutput);
  const summaryThreshold = settings.summaryThreshold ?? 3;
  const isBatch = sources.length >= summaryThreshold;

  if (!isBatch) {
    const detailFiles = filesOut.map((file) => {
      const metadata = {
        mediaPaths: file.mediaPaths ?? [],
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
      if (file.imagesDir) metadata.imagesDir = file.imagesDir;
      if (file.jsonPath) metadata.jsonPath = file.jsonPath;
      return {
        name: file.name,
        markdown: file.markdown ?? "",
        metadata,
      };
    });
    return detailFiles.length === 1
      ? toToolResult(detailFiles[0])
      : toToolResult(detailFiles);
  }

  const successCount = filesOut.filter((file) => !file.warnings || file.warnings.length === 0).length;
  const summary = filesOut.map((file) => {
    const ok = !file.warnings || file.warnings.length === 0;
    return `${ok ? "✅" : "❌"} ${file.name}${ok ? "" : " — " + (file.warnings[0] ?? "失败")}`;
  });
  const summaryFiles = filesOut.map((file) => {
    const metadata = {
      outputDir: file.outputDir ?? null,
      mdPath: file.mdPath ?? null,
      format: file.format ?? null,
      reader: file.reader ?? null,
      backendChain: file.backendChain ?? null,
      warnings: file.warnings ?? [],
      usedBackendInChain: file.usedBackendInChain ?? null,
      usedBackend: file.usedBackend ?? null,
      usedBackends: file.usedBackends ?? [],
    };
    if (file.imagesDir) metadata.imagesDir = file.imagesDir;
    if (file.jsonPath) metadata.jsonPath = file.jsonPath;
    return { name: file.name, metadata };
  });

  return toToolResult({
    markdown: [`处理完成：${successCount}/${filesOut.length} 个文件成功`, "", ...summary].join("\n"),
    metadata: {
      batch: true,
      count: filesOut.length,
      success: successCount,
      summaryThreshold,
    },
    files: summaryFiles,
  });
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
      description: "是否提取媒体(图片/视频/音频,可选)",
    },
    saveJson: {
      type: "boolean",
      description: "是否保存 JSON（可选）",
    },
    splitOnly: {
      type: "boolean",
      description: "仅做图片分割测试，不调用后端（可选）",
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
    return buildResult(sources, results, settings);
  } catch (error) {
    return toToolError(error, {
      action: name,
      source: input.source ? input.source.join(", ") : null,
    });
  }
}
