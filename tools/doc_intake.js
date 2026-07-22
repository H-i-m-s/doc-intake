import { extractDocument } from "../lib/service.js";
import { toToolError, toToolResult } from "../lib/tool-output.js";
import { getSettings } from "../lib/settings.js";
import { Semaphore } from "../lib/semaphore.js";
import { appendMediaGuide } from "../lib/doc-intake-helpers.js";
import { spawn } from "node:child_process";
import { statSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, dirname } from "node:path";

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
  // 并发池分类：基于 chain 第一档是不是 API 后端。
  // - PDF：看 settings.pdfBackendChain[0]，默认 ["mineru", ...] → api 池
  // - 图片：chain 永远是 ["paddleocr"]，→ api 池
  // - office/html/ppt：chain ["local"] → local 池
  // 不看 backend 显式值的 ：那个只在 single file 模式下影响 chain，不是 batch 分类的根据。
  const ext = extname(source).toLowerCase();
  if (ext === ".pdf") {
    const chain = settings?.pdfBackendChain || ["mineru", "paddleocr", "local"];
    return chain[0] === "local" ? "local" : "api";
  }
  if ([".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"].includes(ext)) {
    return "api";  // 图片 chain 硬编码 paddleocr
  }
  return "local";  // office / html / 其它
}

/**
 * Preflight：对超阈值的 PDF 用 Python side split，结果展平成 flat chunk 列表。
 * 返回 { chunks: [{ source: 绝对路径, parentStem, parentSource }], splitInvoked: bool }
 * non-PDF 文件直接通过。
 */
async function preflightSplit(sources, settings, ctx) {
  const pagesPerChunk = settings.splitChunkPages || 180;
  const autoSplit = settings.autoSplitLargePDF !== false;
  if (!autoSplit || pagesPerChunk <= 0) {
    return {
      chunks: sources.map((s) => ({ source: s, parentStem: null, parentSource: s })),
      splitInvoked: false,
    };
  }

  // 仅 PDF 进入 split。其它文件直接通过。
  const pdfSources = sources.filter((s) => extname(s).toLowerCase() === ".pdf");
  const nonPdfSources = sources.filter((s) => extname(s).toLowerCase() !== ".pdf");

  if (pdfSources.length === 0) {
    return {
      chunks: sources.map((s) => ({ source: s, parentStem: null, parentSource: s })),
      splitInvoked: false,
    };
  }

  // spawn split_cli.py
  let splitMap;
  try {
    splitMap = await runSplitCli(pdfSources, pagesPerChunk, settings);
  } catch (e) {
    // split 失败不阻塞 batch，回退到不切
    return {
      chunks: sources.map((s) => ({ source: s, parentStem: null, parentSource: s })),
      splitInvoked: false,
    };
  }

  const chunks = [];
  for (const src of sources) {
    const ext = extname(src).toLowerCase();
    if (ext !== ".pdf") {
      chunks.push({ source: src, parentStem: null, parentSource: src });
      continue;
    }
    const splitPaths = splitMap[src];
    if (!splitPaths || splitPaths.length === 0) {
      chunks.push({ source: src, parentStem: null, parentSource: src });
      continue;
    }
    if (splitPaths.length === 1 && splitPaths[0] === src) {
      // 没切，返回原文件
      chunks.push({ source: src, parentStem: null, parentSource: src });
      continue;
    }
    const stem = src.replace(/\\/g, "/").split("/").pop().replace(/\.pdf$/i, "");
    for (let i = 0; i < splitPaths.length; i++) {
      const p = splitPaths[i];
      chunks.push({
        source: p,
        parentStem: stem,
        parentSource: src,
        deferSave: true,
        outputStem: stem,
        mediaPrefix: `chunk_${String(i + 1).padStart(3, "0")}_`,
      });
    }
  }
  return { chunks, splitInvoked: true };
}

function cleanupSplitChunks(chunkPaths) {
  // 删除 PDF preflight split 出来的整个 chunks 目录，force 不管里面有什么。
  if (!chunkPaths || chunkPaths.length === 0) return;
  const dirs = new Set();
  for (const p of chunkPaths) {
    dirs.add(dirname(p));
  }
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }
}

function runSplitCli(pdfSources, pagesPerChunk, settings) {
  return new Promise((resolve, reject) => {
    const pythonExe = settings.pythonPath;
    if (!pythonExe) {
      reject(new Error("split_cli 需要 pythonPath 配置"));
      return;
    }
    const args = [
      "-m", "split_cli",
      "--sources", JSON.stringify(pdfSources),
      "--pages", String(pagesPerChunk),
    ];
    const cwd = join(import.meta.dirname || "", "..", "python");
    const child = spawn(pythonExe, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
      windowsHide: true,
      timeout: 60000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => reject(new Error(`split_cli spawn 失败: ${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`split_cli 退出码 ${code}, stderr=${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`split_cli stdout 解析失败: ${e.message}, raw=${stdout.slice(0, 200)}`));
      }
    });
  });
}

async function runOne(chunk, input, ctx) {
  try {
    const r = await extractDocument({
      ...input,
      source: chunk.source,
      _deferSave: chunk.deferSave,
      _outputStem: chunk.outputStem,
      _mediaPrefix: chunk.mediaPrefix,
    }, ctx);
    return {
      ok: true,
      source: chunk.source,
      parentStem: chunk.parentStem,
      parentSource: chunk.parentSource,
      result: r,
    };
  } catch (e) {
    return {
      ok: false,
      source: chunk.source,
      parentStem: chunk.parentStem,
      parentSource: chunk.parentSource,
      error: e,
    };
  }
}

function addGuideText(result) {
  const mediaPaths = Array.isArray(result.mediaPaths)
    ? result.mediaPaths
    : result.metadata?.mediaPaths;
  const count = Array.isArray(mediaPaths) ? mediaPaths.length : 0;
  if (count > 0) {
    // 按文件扩展名推断 kind — 不依赖上游传 kind 字段
    const kindCounts = { image: 0, video: 0, audio: 0, other: 0 };
    for (const p of mediaPaths) {
      const k = classifyByExt(p);
      kindCounts[k] += 1;
    }
    result.markdown = appendMediaGuide(result.markdown, count, kindCounts);
  }
  return result;
}

const _IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg",
  "tif", "tiff", "emf", "wmf", "wdp",
]);
const _VIDEO_EXT = new Set([
  "mp4", "mov", "webm", "m4v", "avi", "wmv",
]);
const _AUDIO_EXT = new Set([
  "mp3", "wav", "m4a", "ogg", "flac", "aac",
]);

function classifyByExt(path) {
  const m = String(path).toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : "";
  if (_IMAGE_EXT.has(ext)) return "image";
  if (_VIDEO_EXT.has(ext)) return "video";
  if (_AUDIO_EXT.has(ext)) return "audio";
  return "other";
}

function replaceChunkSource(markdown, chunkSource, parentSource) {
  if (!markdown || !chunkSource || !parentSource) return markdown;
  const variants = new Set([
    String(chunkSource),
    String(chunkSource).replace(/\\/g, "/"),
  ]);
  let rewritten = markdown;
  for (const variant of variants) {
    rewritten = rewritten.split(variant).join(parentSource);
  }
  return rewritten;
}

function persistMergedOutput(file, saveJson) {
  if (!file.outputDir || !file.markdown) return;

  const outputDir = file.outputDir;
  const filename = String(file.name).replace(/\\/g, "/").split("/").pop();
  const stem = filename.replace(/\.[^.]+$/, "");
  const mdPath = join(outputDir, `${filename}.md`);
  const imagesDir = file.mediaPaths?.length > 0
    ? join(outputDir, `${stem}_media`)
    : null;

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(mdPath, file.markdown, "utf8");

  file.mdPath = mdPath;
  file.imagesDir = imagesDir;

  if (saveJson) {
    const jsonPath = join(outputDir, `${filename}.json`);
    const jsonData = {
      content: file.markdown,
      metadata: {
        mediaPaths: file.mediaPaths ?? [],
        format: file.format ?? null,
        reader: file.reader ?? null,
        backendChain: file.backendChain ?? null,
        warnings: file.warnings ?? [],
        usedBackendInChain: file.usedBackendInChain ?? null,
        mdPath,
        imagesDir,
        chunkCount: file.chunkCount ?? null,
      },
    };
    writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), "utf8");
    file.jsonPath = jsonPath;
  }
}

async function processFiles(chunks, input, ctx, settings) {
  // 双池并发：API 池 + Local 池，按 entryBackendKind 分类
  const apiSem = new Semaphore(input._apiConcurrency ?? 4);
  const localSem = new Semaphore(input._localConcurrency ?? 8);

  const tasks = chunks.map((chunk) => {
    const kind = entryBackendKind(chunk.source, input, settings);
    const sem = kind === "api" ? apiSem : localSem;
    return sem.run(() => runOne(chunk, input, ctx));
  });

  const settled = await Promise.allSettled(tasks);
  return settled.map((s) => {
    if (s.status === "fulfilled") return s.value;
    return { ok: false, error: new Error("Promise rejected"), source: null };
  });
}

function buildResult(chunks, results, settings = {}, saveJson = false) {
  // 每个 parentSource 只生成一个逻辑文件；chunk 仅参与云端传输和内存结果聚合。
  const fileOrder = [];
  const seen = new Set();
  const mergedByFile = new Map();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const key = chunk.parentSource ?? chunk.source;
    if (!seen.has(key)) {
      seen.add(key);
      fileOrder.push(key);
    }
    if (!mergedByFile.has(key)) {
      mergedByFile.set(key, { chunks: [], results: [] });
    }
    const group = mergedByFile.get(key);
    group.chunks.push(chunk);
    group.results.push(results[i]);
  }

  const filesOut = [];
  for (const source of fileOrder) {
    const group = mergedByFile.get(source);
    const isSplit = group.chunks.some((chunk) => chunk.parentStem);

    if (!isSplit) {
      const item = group.results[0];
      if (!item.ok) {
        const errMsg = item.error?.message ?? "未知错误";
        filesOut.push({
          name: source,
          status: "failed",
          error: errMsg,
          warnings: [errMsg],
          markdown: `❌ 解析失败: ${errMsg}`,
        });
        continue;
      }

      const metadata = item.result.metadata ?? {};
      const result = addGuideText(item.result);
      filesOut.push({
        name: source,
        outputDir: result.outputDir ?? null,
        mdPath: metadata.mdPath ?? null,
        imagesDir: metadata.imagesDir ?? null,
        mediaPaths: metadata.mediaPaths ?? [],
        format: metadata.format ?? null,
        reader: metadata.reader ?? null,
        backendChain: metadata.backendChain ?? null,
        warnings: metadata.warnings ?? [],
        usedBackendInChain: metadata.usedBackendInChain ?? null,
        markdown: result.markdown ?? "",
      });
      continue;
    }

    const markdownParts = [];
    const warnings = [];
    const mediaPaths = [];
    let outputDir = null;
    let format = null;
    let reader = null;
    let backendChain = null;
    let usedBackendInChain = null;

    for (const item of group.results) {
      if (!item.ok) {
        warnings.push(`chunk ${item.source}: ${item.error?.message ?? "未知错误"}`);
        continue;
      }
      const result = item.result;
      const metadata = result.metadata ?? {};
      if (result.markdown) {
        markdownParts.push(
          replaceChunkSource(result.markdown, item.source, source),
        );
      }
      warnings.push(...(metadata.warnings ?? []));
      mediaPaths.push(...(metadata.mediaPaths ?? []));
      outputDir ??= result.outputDir ?? null;
      format ??= metadata.format ?? null;
      reader ??= metadata.reader ?? null;
      backendChain ??= metadata.backendChain ?? null;
      usedBackendInChain ??= metadata.usedBackendInChain ?? null;
    }

    const merged = {
      name: source,
      outputDir,
      format,
      reader,
      backendChain,
      warnings,
      usedBackendInChain,
      mediaPaths,
      chunkCount: group.chunks.length,
      markdown: markdownParts.filter(Boolean).join("\n\n---\n\n"),
    };
    addGuideText(merged);

    // 分块结果在这里才第一次落盘，Python 阶段不会生成 chunk 级 md/json。
    persistMergedOutput(merged, saveJson);
    filesOut.push(merged);
  }

  const summaryThreshold = settings.summaryThreshold ?? 3;
  const isBatch = fileOrder.length >= summaryThreshold;

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
      };
      if (file.mdPath) metadata.mdPath = file.mdPath;
      if (file.imagesDir) metadata.imagesDir = file.imagesDir;
      if (file.jsonPath) metadata.jsonPath = file.jsonPath;
      return { name: file.name, markdown: file.markdown ?? "", metadata };
    });
    return detailFiles.length === 1
      ? toToolResult(detailFiles[0])
      : toToolResult(detailFiles);
  }

  const summary = filesOut.map((file) => {
    const ok = !file.warnings || file.warnings.length === 0;
    return `${ok ? "✅" : "❌"} ${file.name}${ok ? "" : " — " + (file.warnings[0] ?? "失败")}`;
  });
  const successCount = filesOut.filter((file) => !file.warnings || file.warnings.length === 0).length;
  const summaryFiles = filesOut.map((file) => {
    const metadata = {
      outputDir: file.outputDir ?? null,
      mdPath: file.mdPath ?? null,
      format: file.format ?? null,
      reader: file.reader ?? null,
      backendChain: file.backendChain ?? null,
      warnings: file.warnings ?? [],
      usedBackendInChain: file.usedBackendInChain ?? null,
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
      preflightSplit: chunks.some((chunk) => chunk.parentStem),
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

    // 拿 settings（从 ctx.service / 或者 ctx.config 走），拿 maxConcurrent + maxConcurrentLocal
    const settings = getSettings(ctx);
    const enrichedInput = {
      ...input,
      _apiConcurrency: settings.maxConcurrent ?? 4,
      _localConcurrency: settings.maxConcurrentLocal ?? 8,
    };

    // Preflight：检查大 PDF split
    const preflight = await preflightSplit(sources, settings, ctx);
    const chunks = preflight.chunks;

    const results = await processFiles(chunks, enrichedInput, ctx, settings);
    const shouldSaveJson = input.saveJson !== undefined
      ? input.saveJson
      : settings.saveJson;
    let builtResult;
    try {
      builtResult = buildResult(chunks, results, settings, shouldSaveJson);
    } finally {
      // 总是清理 preflight 出去的 chunks（即使 buildResult 抛错）。
      // 只清 chunks（parentStem 非空的），不动用户原始文件。
      const chunkPaths = chunks
        .filter((c) => c.parentStem !== null)
        .map((c) => c.source);
      cleanupSplitChunks(chunkPaths);
    }
    return builtResult;
  } catch (error) {
    return toToolError(error, {
      action: name,
      source: input.source ? input.source.join(", ") : null,
    });
  }
}
