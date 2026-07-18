import { extractDocument } from "../lib/service.js";
import { toToolError, toToolResult } from "../lib/tool-output.js";
import { getSettings } from "../lib/settings.js";
import { Semaphore } from "../lib/semaphore.js";
import { appendImageGuide } from "../lib/doc-intake-helpers.js";
import { spawn } from "node:child_process";
import { statSync, readdirSync, rmSync } from "node:fs";
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
    for (const p of splitPaths) {
      chunks.push({ source: p, parentStem: stem, parentSource: src });
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
    const r = await extractDocument({ ...input, source: chunk.source }, ctx);
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
  const imgPaths = result.metadata?.imagePaths;
  const imgCount = Array.isArray(imgPaths) ? imgPaths.length : 0;
  if (imgCount > 0) {
    result.markdown = appendImageGuide(result.markdown, imgCount);
  }
  return result;
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

function buildResult(chunks, results, settings = {}) {
  // 同 parentStem 的 chunks 合并输出：按 chunk index 排序拼 markdown + 拼 images
  const bySource = new Map();
  for (const r of results) {
    bySource.set(r.source, r);
  }

  // 合并后的"虚拟 file list"：每个 parentSource 出现一次（如果它有 chunks），原 file 也算
  const fileOrder = [];
  const seen = new Set();
  for (const c of chunks) {
    const key = c.parentSource ?? c.source;
    if (!seen.has(key)) {
      seen.add(key);
      fileOrder.push(key);
    }
  }

  // 对每个 parent source：合并 chunks markdown、按顺序串 images
  const mergedByFile = new Map();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const r = results[i];
    const key = c.parentSource ?? c.source;
    if (!mergedByFile.has(key)) {
      mergedByFile.set(key, { chunks: [], results: [] });
    }
    const e = mergedByFile.get(key);
    e.chunks.push(c);
    e.results.push(r);
  }

  const summaryThreshold = settings.summaryThreshold ?? 3;
  const isBatch = fileOrder.length >= summaryThreshold;
  const filesOut = [];
  for (const f of fileOrder) {
    const grp = mergedByFile.get(f);
    if (grp.chunks.length === 1 && !grp.chunks[0].parentStem) {
      // 单文件，无 split
      const r = grp.results[0];
      if (r.ok) {
        const m = r.result.metadata ?? {};
        const r2 = addGuideText(r.result);
        filesOut.push({
          name: f,
          outputDir: r.result.outputDir ?? null,
          mdPath: m.mdPath ?? null,
          imagesDir: m.imagesDir ?? null,
          imagePaths: m.imagePaths ?? [],
          format: m.format ?? null,
          reader: m.reader ?? null,
          backendChain: m.backendChain ?? null,
          warnings: m.warnings ?? [],
          usedBackendInChain: m.usedBackendInChain ?? null,
          markdown: r2.markdown ?? "",
        });
      } else {
        const errMsg = r.error?.message ?? "未知错误";
        filesOut.push({
          name: f,
          status: "failed",
          error: errMsg,
          warnings: [errMsg],
          markdown: `❌ 解析失败: ${errMsg}`,
        });
      }
    } else {
      // 多 chunk 合并
      const mk = [];
      const ws = [];
      let meta = null;
      let chunkOutputDir = null;
      let chunkMdPath = null;
      let chunkImagesDir = null;
      for (const r of grp.results) {
        if (r.ok) {
          mk.push(r.result.markdown ?? "");
          const rm = r.result.metadata ?? {};
          ws.push(...(rm.warnings ?? []));
          meta = r.result.metadata ?? meta;
          if (!chunkOutputDir) chunkOutputDir = r.result.outputDir ?? null;
          if (!chunkMdPath) chunkMdPath = rm.mdPath ?? null;
          if (!chunkImagesDir) chunkImagesDir = rm.imagesDir ?? null;
        } else {
          ws.push(`chunk ${r.source}: ${r.error?.message ?? "未知错误"}`);
        }
      }
      const mergedMarkdown = mk.filter(Boolean).join("\n\n---\n\n");
      const m = meta ?? {};
      filesOut.push({
        name: f,
        outputDir: chunkOutputDir,
        mdPath: chunkMdPath,
        imagesDir: chunkImagesDir,
        imagePaths: m.imagePaths ?? [],
        format: m.format ?? null,
        reader: m.reader ?? null,
        backendChain: m.backendChain ?? null,
        warnings: ws,
        usedBackendInChain: m.usedBackendInChain ?? null,
        markdown: mergedMarkdown,
      });
    }
  }

  if (!isBatch) {
    // 单文件 / <summaryThreshold：每项含 markdown + chain metadata，无 mdPath/imagesDir。
    const detailFiles = filesOut.map(f => {
      const m = {
        imagePaths: f.imagePaths ?? [],
        outputDir: f.outputDir,
        format: f.format,
        reader: f.reader,
        backendChain: f.backendChain,
        warnings: f.warnings,
        usedBackendInChain: f.usedBackendInChain,
      };
      return { name: f.name, markdown: f.markdown ?? "", metadata: m };
    });
    // 单文件：顶层直接是 object（不走 array 包装，与本地 JSON 形式对齐）
    if (detailFiles.length === 1) {
      return toToolResult(detailFiles[0]);
    }
    // 多文件 (<summaryThreshold)：顶层 array，每项同单文件结构
    return toToolResult(detailFiles);
  }

  // 批量 (>=summaryThreshold)：顶层 array，每项去掉 markdown/imagePaths，加 mdPath/imagesDir（有图时），省 context。
  const summary = [];
  for (const f of filesOut) {
    const ok = !f.warnings || f.warnings.length === 0;
    summary.push(
      `${ok ? "✅" : "❌"} ${f.name}${ok ? "" : " — " + (f.warnings[0] ?? "失败")}`,
    );
  }
  const successCount = filesOut.filter((f) => !f.warnings || f.warnings.length === 0).length;
  const summaryMarkdown = [
    `处理完成：${successCount}/${filesOut.length} 个文件成功`,
    "",
    ...summary,
  ].join("\n");
  const summaryFiles = filesOut.map(f => {
    const m = {
      outputDir: f.outputDir,
      mdPath: f.mdPath,
      format: f.format,
      reader: f.reader,
      backendChain: f.backendChain,
      warnings: f.warnings,
      usedBackendInChain: f.usedBackendInChain,
    };
    if (f.imagesDir) m.imagesDir = f.imagesDir;
    return { name: f.name, metadata: m };
  });
  return toToolResult({
    markdown: summaryMarkdown,
    metadata: {
      batch: true,
      count: filesOut.length,
      success: successCount,
      preflightSplit: chunks.some((c) => c.parentStem) ? true : false,
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
    includeImages: {
      type: "boolean",
      description: "是否提取图片（可选）",
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
    let builtResult;
    try {
      builtResult = buildResult(chunks, results, settings);
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
