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
import { detectCategory } from "./formats.js";
import { DEFAULT_PDF_BACKEND_CHAIN } from "./settings.js";
import { resolveEndpoint, stop as stopMineruService, touch as touchMineruService } from "./mineru-service.js";

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

// 粗类决定「这文件到底有没有云端可选项」：只有 pdf / image 有。office、html、
// ebook 三类都只能本地解析，电子书尤其如此（云端那几档没有 EPUB 这一路）。
// 归类按 lib/formats.js 的粗类走，不再在这里抄一份扩展名集合。
const CLOUD_CAPABLE_CATEGORIES = new Set(["pdf", "image"]);

export function entryBackendKind(source, input, settings) {
  const explicit = input?.backend;
  const ext = extname(source).toLowerCase();
  const category = detectCategory(source);
  // 认不出的后缀保持旧语义（当作 api 那一档），免得改变未知文件的排队方式。
  const cloudCapable = category === null || CLOUD_CAPABLE_CATEGORIES.has(category);

  // 二进制 Office 一律走转换档：无论显式说了哪档，它都得先过 LibreOffice。
  if (LEGACY_OFFICE_EXTS.has(ext)) return "legacy";

  if (explicit && explicit !== "auto") {
    if (explicit === "local") return "local";
    // 显式指定云端档，但这类文件本地才有路：按本地排进去，别让它占云端的并发档位。
    return cloudCapable ? "api" : "local";
  }

  if (category === "pdf") {
    // 留空按自动档理解：mineru > oxr > paddleocr > mineru-local > paddleocr-local > local
    const chain = settings?.pdfBackendChain?.length
      ? settings.pdfBackendChain
      : DEFAULT_PDF_BACKEND_CHAIN;
    return chain[0] === "local" ? "local" : "api";
  }
  if (category === "image") {
    return "api";
  }
  return "local";
}

async function runOne(source, input, ctx, mineru, settings) {
  try {
    // 每解析一个文件就续一次命：守护脚本按 activity 的 mtime 判空闲，
    // 只在批次开始时 touch 一次，一批大文件跑到一半就会被自己的超时关掉。
    if (mineru?.managed) touchMineruService(settings);
    const result = await extractDocument({ ...input, source }, ctx);
    return { ok: true, source, result };
  } catch (error) {
    return { ok: false, source, error };
  }
}

// 「这一批会不会真的用到 mineru-local」：只看链路，不看设置里有没有人填了地址。
// 电子书永远本地直解（Python 侧对 ebook 一律回 ["local"]），不该为它拉起 MinerU。
export function usesMineruLocal(source, input, settings) {
  const category = detectCategory(source);
  if (category === "ebook") return false;

  const explicit = input?.backend;
  if (explicit && explicit !== "auto") return explicit === "mineru-local";

  const chain = category === "pdf"
    ? (settings?.pdfBackendChain?.length ? settings.pdfBackendChain : DEFAULT_PDF_BACKEND_CHAIN)
    : category === "image"
      ? (Array.isArray(settings?.imageBackendChain) ? settings.imageBackendChain : [])
      : [];
  return chain.includes("mineru-local");
}

/** 跑批前把本地 MinerU 准备好。不需要就一步不做，需要才解析地址。 */
async function prepareMineruLocal(sources, input, settings) {
  const needed = sources.some((source) => usesMineruLocal(source, input, settings));
  if (!needed) return { endpoint: null, managed: false, warning: null, stopAfter: false };

  const resolved = await resolveEndpoint(settings);
  if (!resolved.endpoint) {
    // 不抛：拿不到服务就让链路自己降到下一档，把原因当 warning 带回去。
    return { endpoint: null, managed: false, warning: `本地 MinerU 未就绪：${resolved.reason}`, stopAfter: false };
  }
  // idle=0 的含义是「解析完立刻关」，只对这个插件自己拉起的实例有意义。
  const idleSeconds = Number(settings?.mineruLocalIdleSeconds);
  const stopAfter = resolved.managed && idleSeconds === 0;
  return {
    endpoint: resolved.endpoint,
    managed: resolved.managed,
    warning: null,
    stopAfter,
    idleSeconds: Number.isFinite(idleSeconds) ? idleSeconds : 300,
  };
}

/**
 * 解析进行中的心跳。
 *
 * 守护脚本只认 activity 的 mtime，而「解析前 touch 一次」对长解析是不够的：
 * 实测一份单页 PDF 在 8010 上首次跑要走 193 秒（模型冷加载就占了大半），
 * 默认 idle=300 也在同一量级 —— 碰上一次慢一点的解析，服务会在解析中途被自己关掉，
 * 表现是「远程主机强迫关闭了一个现有的连接」。
 * 批次还在跑，就说明这个服务正在被用，续上活跃时间才对得上「空闲」两个字。
 */
function startHeartbeat(settings, idleSeconds) {
  if (!(idleSeconds > 0)) return null; // idle<=0 时守护脚本不等超时，不需要心跳
  const intervalMs = Math.max(1000, Math.min(60_000, (idleSeconds * 1000) / 3));
  const timer = setInterval(() => touchMineruService(settings), intervalMs);
  // 别让这个定时器把 App 进程钉住。
  if (typeof timer.unref === "function") timer.unref();
  return timer;
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
  // 本地 MinerU 的拉起与归还都在这一层：三处入口（工具 / 卡片 / 服务）都经过这里，
  // 分散到三处迟早出现「卡片起的服务工具没认」。
  const mineru = await prepareMineruLocal(sources, input, settings);
  const effectiveInput = mineru.endpoint
    ? { ...input, _mineruLocalEndpoint: mineru.endpoint }
    : input;
  const heartbeat = mineru.managed ? startHeartbeat(settings, mineru.idleSeconds) : null;

  // 三档闸门在 lib/concurrency.js 里是进程级单例：同一个进程里工具、卡片、服务
  // 分的是同一批后端配额，各建一份等于把上限乘以入口数。上限仍然每次按 settings
  // 传进来，改设置立刻生效，只是不再每次调用各建一套。
  const tasks = sources.map((source) => {
    const kind = entryBackendKind(source, effectiveInput, settings);
    const max = kind === "api"
      ? (effectiveInput._apiConcurrency ?? 4)
      : kind === "legacy"
        ? (effectiveInput._legacyConversionConcurrency ?? 1)
        : (effectiveInput._localConcurrency ?? 8);
    return runWithLimit(kind, max, () => runOne(source, effectiveInput, ctx, mineru, settings));
  });

  const settled = await Promise.allSettled(tasks);
  if (heartbeat) clearInterval(heartbeat);
  const files = settled.map((item, index) => {
    if (item.status === "fulfilled") return item.value;
    return {
      ok: false,
      source: sources[index],
      error: item.reason instanceof Error ? item.reason : new Error(String(item.reason)),
    };
  });

  if (mineru.warning) {
    // 服务没就绪不是这批文件的错：链路会自己降档，把原因挂成 warning 让人看得见。
    for (const item of files) {
      if (!item.ok || !item.result) continue;
      const warnings = Array.isArray(item.result.warnings) ? item.result.warnings : [];
      item.result.warnings = [...warnings, mineru.warning];
    }
  }

  if (mineru.stopAfter) {
    // idle=0：解析完就还回去，不占着显存/内存等下一次。
    try {
      await stopMineruService(settings);
    } catch (error) {
      // 停不掉只是浪费资源，不能把已经拿到的解析结果一起拖垮。
      if (mineru.warning === null) {
        for (const item of files) {
          if (!item.ok || !item.result) continue;
          const warnings = Array.isArray(item.result.warnings) ? item.result.warnings : [];
          item.result.warnings = [...warnings, `本地 MinerU 未能关闭：${error?.message || error}`];
        }
      }
    }
  }

  return files;
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
