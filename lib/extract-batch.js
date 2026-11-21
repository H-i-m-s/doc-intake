// 解析批处理：一条 source 列表进去，一批「每文件结果」出来。
//
// 工具、卡片、服务三个入口都从这里发起解析，所以路径展开、后端归类、跑批闸门
// 只能有一份实现：三份各自演化，迟早会出现「卡片和工具选的后端不一样」这种事。
// 这里不认识宿主，也不认识作业表，纯粹是 source -> 结果。

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, isAbsolute, join, normalize, parse, resolve } from "node:path";

import { extractDocument } from "./service.js";
import { runWithLimit } from "./concurrency.js";
import { DEFAULT_PDF_BACKEND_CHAIN } from "./settings.js";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

// v2 App 的 JS 进程跑在 Node Permission Model 下，裸 fs 读许可根以外的路径会被拒。
// 路径展开（目录枚举、存在性、后缀过滤）交给被 spawn 的 Python 子进程完成；
// 语义与 v1 的 expandPaths 一致：无效路径与不支持的后缀静默跳过。
export function expandSourcesWithPython(pythonExe, paths) {
  const scriptPath = join(CURRENT_DIR, "..", "python", "list_sources.py");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
      timeout: 60000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      reject(new Error(`展开路径失败: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`展开路径失败(退出码 ${code}): ${(stderr || stdout).slice(0, 300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed?.sources) ? parsed.sources : []);
      } catch {
        reject(new Error(`展开路径输出解析失败: ${stdout.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(Array.isArray(paths) ? paths : []));
  });
}

// 旧格式（二进制 Office）要过 LibreOffice 转换，并发档位和别的后端不是一回事，
// 所以「哪些后缀算 legacy」必须和后端归类放在一起，不能各自维护一份。
export const LEGACY_OFFICE_EXTS = new Set([".doc", ".xls", ".ppt"]);

export function entryBackendKind(source, input, settings) {
  const explicit = input?.backend;
  const ext = extname(source).toLowerCase();
  if (explicit && explicit !== "auto") {
    if (explicit === "local" && LEGACY_OFFICE_EXTS.has(ext)) return "legacy";
    return explicit === "local" ? "local" : "api";
  }

  if (LEGACY_OFFICE_EXTS.has(ext)) {
    return "legacy";
  }
  if (ext === ".pdf") {
    // 留空按自动档理解：mineru > paddleocr > local
  const chain = settings?.pdfBackendChain?.length
    ? settings.pdfBackendChain
    : DEFAULT_PDF_BACKEND_CHAIN;
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

export async function processFiles(sources, input, ctx, settings) {
  // 三档闸门在 lib/concurrency.js 里是进程级单例：同一个进程里工具、卡片、服务
  // 分的是同一批后端配额，各建一份等于把上限乘以入口数。上限仍然每次按 settings
  // 传进来，改设置立刻生效，只是不再每次调用各建一套。
  const tasks = sources.map((source) => {
    const kind = entryBackendKind(source, input, settings);
    const max = kind === "api"
      ? (input._apiConcurrency ?? 4)
      : kind === "legacy"
        ? (input._legacyConversionConcurrency ?? 1)
        : (input._localConcurrency ?? 8);
    return runWithLimit(kind, max, () => runOne(source, input, ctx));
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

// 单次解析结果 -> 出去的那份文件描述（卡片、作业、同步返回都读这一份）。
// 放在批处理这一层：它要认的字段全部来自 extractDocument 的返回值，
// 谁调 processFiles 谁就用同一套解读，别在入口侧另写一遍。
export function toFileOutput(item) {
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
  const conversionFailed = metadata.conversionStatus === "failed";
  const warnings = Array.isArray(result.warnings)
    ? [...result.warnings]
    : (Array.isArray(metadata.warnings) ? [...metadata.warnings] : []);
  if (unresolvedMediaCount > 0) {
    warnings.push("部分媒体路径缺少可用的绝对路径基准，未返回这些媒体的路径");
  }
  const saveError = saveFailed
    ? warnings.find((warning) => String(warning).startsWith("保存失败")) ?? "保存失败"
    : null;
  const conversionError = conversionFailed
    ? warnings.at(-1) ?? metadata.conversionErrorCode ?? "旧格式转换失败"
    : null;
  return {
    name: item.source,
    status: saveFailed || conversionFailed ? "failed" : "success",
    ...((saveError || conversionError)
      ? { error: saveError ?? conversionError }
      : {}),
    outputDir: absolutePath(result.outputDir),
    mdPath: absolutePath(metadata.mdPath),
    mediaDir,
    jsonPath: absolutePath(metadata.jsonPath),
    mediaPaths,
    unresolvedMediaCount,
    format: metadata.format ?? null,
    reader: metadata.reader ?? null,
    backendChain: metadata.backendChain ?? null,
    originalFormat: metadata.originalFormat ?? null,
    convertedFormat: metadata.convertedFormat ?? null,
    conversionProvider: metadata.conversionProvider ?? null,
    conversionStatus: metadata.conversionStatus ?? null,
    conversionErrorCode: metadata.conversionErrorCode ?? null,
    conversionWarnings: metadata.conversionWarnings ?? [],
    conversionDurationMs: metadata.conversionDurationMs ?? null,
    warnings,
    usedBackendInChain: metadata.usedBackendInChain ?? null,
    usedBackend: metadata.usedBackend ?? null,
    usedBackends: metadata.usedBackends ?? [],
    // 码内容属于提取结果，不是路径；空数组表示没扫到或不适用。
    barcodeCodes: Array.isArray(metadata.barcodeCodes) ? metadata.barcodeCodes : [],
    barcodeOnlyDocument: metadata.barcodeOnlyDocument === true,
    markdown: result.markdown ?? "",
  };
}
