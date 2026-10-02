// doc-intake 设置页后端路由。
//
// 设置页（ui/settings.html）跑在宿主设置窗的 iframe 里，通过
// hana.api.fetch("/config" | "/deps" | "/install") 访问本文件注册的
// /api/apps/doc-intake/routes/* 端点：
//   GET  /config   读回全部设置（缺省值补齐后返回）
//   POST /config   校验后写回（只认 SPEC 里的键）
//   GET  /deps     用已配置的 pythonPath 探测 Python 依赖是否安装
//   POST /install 对缺失依赖执行 pip install（只允许装 DEP_CATALOG 里列出的包）
//
// 静态设置 schema 仍留在 manifest.json：宿主拿它做 ctx.config 的字段校验、
// 默认值与敏感值处理；这里只是把"呈现与交互"换成自定义页面。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROBE_SCRIPT = path.join(CURRENT_DIR, "..", "python", "probe_deps.py");

// 设置键的类型与默认值。与 manifest.json 的 schema 保持一致；
// 这里多存一份是为了在路由侧做写入校验和缺省补齐，不依赖宿主下发 schema。
const SPEC = {
  pythonPath: { type: "string", default: "" },
  defaultBackend: { type: "string", enum: ["auto", "mineru", "paddleocr", "local"], default: "auto" },
  pdfBackendChain: { type: "string", default: "" },
  mineruCredentials: { type: "string", default: "" },
  mineruModelVersion: { type: "string", enum: ["vlm", "pipeline", "MinerU-HTML"], default: "vlm" },
  mineruEnableOCR: { type: "boolean", default: true },
  mineruEnableFormula: { type: "boolean", default: true },
  mineruEnableTable: { type: "boolean", default: true },
  paddleTokens: { type: "string", default: "" },
  paddleUseDocOrientationClassify: { type: "boolean", default: false },
  paddleUseDocUnwarping: { type: "boolean", default: true },
  paddleUseChartRecognition: { type: "boolean", default: true },
  paddleUseSealRecognition: { type: "boolean", default: false },
  paddleUseTableRecognition: { type: "boolean", default: true },
  paddleUseFormulaRecognition: { type: "boolean", default: true },
  splitImageThreshold: { type: "number", default: 1.2 },
  splitImageTolerance: { type: "number", default: 15 },
  splitImageBlankRatio: { type: "number", default: 0.98 },
  splitImageMinBlank: { type: "number", default: 5 },
  maxConcurrent: { type: "number", default: 4 },
  maxConcurrentLocal: { type: "number", default: 8 },
  legacyConversionProvider: { type: "string", enum: ["auto", "office_com", "libreoffice", "disabled"], default: "auto" },
  libreOfficePath: { type: "string", default: "" },
  legacyConversionConcurrency: { type: "number", default: 1 },
  legacyConversionTimeoutMs: { type: "number", default: 180000 },
  maxRetries: { type: "number", default: 3 },
  retryBaseDelayMs: { type: "number", default: 1000 },
  maxRemoteImagesPerHtml: { type: "number", default: 100 },
  defaultLanguage: { type: "string", default: "zh" },
  includeMedia: { type: "boolean", default: true },
  mineruFlashMaxMB: { type: "number", default: 10 },
  mineruFlashMaxPages: { type: "number", default: 20 },
  mineruPrecisionMaxMB: { type: "number", default: 200 },
  mineruPrecisionMaxPages: { type: "number", default: 200 },
  autoSplitLargePDF: { type: "boolean", default: true },
  splitChunkPages: { type: "number", default: 180 },
  keyRetryOnFailure: { type: "boolean", default: true },
  notifyKeyFailure: { type: "boolean", default: true },
  saveJson: { type: "boolean", default: false },
  inlineBlockBytes: { type: "number", default: 28672 },
  inlineBlockCount: { type: "number", default: 4 },
  mediaPathReturnLimit: { type: "number", default: 20 },
  logLevel: { type: "string", enum: ["DEBUG", "INFO", "WARNING", "ERROR"], default: "INFO" },
  logFile: { type: "string", default: "" },
  htmlExtractMetadata: { type: "boolean", default: true },
  htmlExtractLinks: { type: "boolean", default: true },
  htmlExtractImages: { type: "boolean", default: true },
  htmlExtractCodeBlocks: { type: "boolean", default: true },
  htmlHeadingStyle: { type: "string", enum: ["ATX", "SETEXT"], default: "ATX" },
  xlsxMaxRows: { type: "number", default: 100 },
  xlsxMaxCols: { type: "number", default: 50 },
  autoSave: { type: "boolean", default: false },
  savePath: { type: "string", default: "" },
};

// 「环境依赖管理」卡片的依赖清单。id 用于前后端对齐，module 是导入名，
// dists 是 importlib.metadata 里可能出现的发行名，pip 是安装用的发行规格。
const DEP_CATALOG = [
  {
    id: "pillow",
    module: "PIL",
    dists: ["Pillow"],
    name: "Pillow",
    purpose: "图片处理：长图分割、EMF→PNG 转换、图片读写",
    level: "required",
    pip: "Pillow>=9.0.0",
  },
  {
    id: "pymupdf",
    module: "fitz",
    dists: ["PyMuPDF", "fitz"],
    name: "PyMuPDF",
    purpose: "PDF 本地兜底提取，以及大 PDF 按页分块",
    level: "required",
    pip: "PyMuPDF>=1.23.0",
  },
  {
    id: "requests",
    module: "requests",
    dists: ["requests"],
    name: "requests",
    purpose: "云端 API 调用、远程图片下载、HTML 抓取",
    level: "required",
    pip: "requests>=2.28.0",
  },
  {
    id: "mineru",
    module: "mineru",
    dists: ["mineru-open-sdk", "mineru"],
    name: "mineru-open-sdk",
    purpose: "MinerU 云端 PDF 提取；缺失则降级链跳过 MinerU 这一档",
    level: "optional",
    pip: "mineru-open-sdk>=0.2.0",
  },
  {
    id: "html-to-markdown",
    module: "html_to_markdown",
    dists: ["html-to-markdown"],
    name: "html-to-markdown",
    purpose: "HTML → Markdown 转换；缺失则 HTML 解析不可用",
    level: "optional",
    pip: "html-to-markdown>=0.5.0",
  },
  {
    id: "pywin32",
    module: "win32com",
    dists: ["pywin32"],
    name: "pywin32",
    purpose: "旧版 .doc/.xls/.ppt 经 Office COM 转换（仅 Windows）",
    level: "optional",
    pip: "pywin32>=300; sys_platform == \"win32\"",
  },
  {
    id: "xlrd",
    module: "xlrd",
    dists: ["xlrd"],
    name: "xlrd",
    purpose: "旧版 .xls（BIFF）数值读取",
    level: "optional",
    pip: "xlrd>=2.0.1",
  },
];

const DEP_BY_PIP = new Map(DEP_CATALOG.map((dep) => [dep.pip, dep]));

function emptyConfig() {
  const out = {};
  for (const [key, meta] of Object.entries(SPEC)) out[key] = meta.default;
  return out;
}

// 校验写入补丁：只认 SPEC 里的键，类型/枚举不对就拒绝，未知键忽略。
function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, message: "配置格式不正确" };
  }
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    const meta = SPEC[key];
    if (!meta) continue;
    if (meta.enum && !meta.enum.includes(value)) {
      return { ok: false, message: `${key} 的取值不在允许范围内` };
    }
    if (meta.type === "string" && typeof value !== "string") {
      return { ok: false, message: `${key} 必须是字符串` };
    }
    if (meta.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      return { ok: false, message: `${key} 必须是有限数字` };
    }
    if (meta.type === "boolean" && typeof value !== "boolean") {
      return { ok: false, message: `${key} 必须是布尔值` };
    }
    result[key] = value;
  }
  return { ok: true, value: result };
}

async function readStored(ctx) {
  try {
    return (await ctx?.config?.getAll?.()) || {};
  } catch {
    return {};
  }
}

// 读回完整配置：SPEC 的每个键都用「已存值 ?? 默认值」补齐，前端直接消费。
async function readConfig(ctx) {
  const stored = await readStored(ctx);
  const merged = emptyConfig();
  for (const key of Object.keys(SPEC)) {
    const value = stored[key];
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged;
}

async function writeConfig(ctx, patch) {
  const checked = validatePatch(patch);
  if (!checked.ok) throw new Error(checked.message);
  const entries = Object.entries(checked.value).filter(([key]) => key in SPEC);
  if (entries.length === 0) return;
  if (typeof ctx?.config?.setMany === "function") {
    await ctx.config.setMany(Object.fromEntries(entries));
    return;
  }
  const failures = [];
  for (const [key, value] of entries) {
    try {
      await ctx.config.set(key, value);
    } catch {
      failures.push(key);
    }
  }
  if (failures.length) throw new Error(`写入失败：${failures.join(", ")}`);
}

// 跑一个一次性 Python 子进程，stdin 送 JSON、stdout 收 JSON。
// windowsHide 必开：这个 App 的常态是无人值守地起 Python，弹黑框是纯干扰。
function runPython(pythonExe, args, stdinPayload, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(pythonExe, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        windowsHide: true,
        timeout: timeoutMs,
      });
    } catch (error) {
      resolve({ ok: false, error: `启动 Python 失败：${error?.message || error}` });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });

    child.on("error", (error) => {
      resolve({ ok: false, error: `Python 执行失败：${error?.message || error}` });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });

    try {
      child.stdin.end(stdinPayload ?? "");
    } catch (error) {
      resolve({ ok: false, error: `写入子进程失败：${error?.message || error}` });
    }
  });
}

function emptyDepState(reason) {
  return DEP_CATALOG.map((dep) => ({
    id: dep.id,
    name: dep.name,
    module: dep.module,
    purpose: dep.purpose,
    level: dep.level,
    pip: dep.pip,
    installed: null,
    version: null,
    error: reason || null,
  }));
}

async function detectDeps(ctx) {
  const config = await readConfig(ctx);
  const pythonExe = String(config.pythonPath || "").trim();
  if (!pythonExe) {
    return { ok: true, configured: false, pythonPath: "", python: null, libs: emptyDepState(null) };
  }

  const payload = JSON.stringify(
    DEP_CATALOG.map((dep) => ({ id: dep.id, module: dep.module, dists: dep.dists })),
  );
  const run = await runPython(
    pythonExe,
    [PROBE_SCRIPT],
    payload,
    60000,
  );

  if (!run.ok && !run.stdout) {
    return {
      ok: false,
      configured: true,
      pythonPath: pythonExe,
      python: null,
      error: run.error || `探测进程退出码 ${run.code}：${(run.stderr || "").slice(0, 400)}`,
      libs: emptyDepState("探测失败"),
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    return {
      ok: false,
      configured: true,
      pythonPath: pythonExe,
      python: null,
      error: `探测输出无法解析：${(run.stdout || run.stderr || "").slice(0, 300)}`,
      libs: emptyDepState("探测失败"),
    };
  }

  const byId = new Map((Array.isArray(parsed.results) ? parsed.results : []).map((r) => [r.id, r]));
  const libs = DEP_CATALOG.map((dep) => {
    const hit = byId.get(dep.id) || {};
    return {
      id: dep.id,
      name: dep.name,
      module: dep.module,
      purpose: dep.purpose,
      level: dep.level,
      pip: dep.pip,
      installed: hit.installed === true,
      version: hit.version || null,
      error: hit.error || null,
    };
  });

  return {
    ok: true,
    configured: true,
    pythonPath: pythonExe,
    python: parsed.python || null,
    libs,
  };
}

async function installDeps(ctx, packages) {
  const config = await readConfig(ctx);
  const pythonExe = String(config.pythonPath || "").trim();
  if (!pythonExe) {
    return { ok: false, error: "尚未配置 pythonPath，无法安装依赖。" };
  }
  const requested = Array.isArray(packages) ? packages : [];
  // 只允许安装清单里登记过的包规格，杜绝经由这个端点装任意东西。
  const specs = [];
  for (const item of requested) {
    const dep = DEP_BY_PIP.get(String(item));
    if (dep && !specs.includes(dep.pip)) specs.push(dep.pip);
  }
  if (specs.length === 0) {
    return { ok: false, error: "没有可安装的依赖（只接受清单中登记的包）。" };
  }

  const run = await runPython(
    pythonExe,
    ["-m", "pip", "install", "--disable-pip-version-check", ...specs],
    "",
    600000,
  );

  return {
    ok: run.ok === true,
    code: run.code ?? null,
    packages: specs,
    stdout: (run.stdout || "").slice(-6000),
    stderr: (run.stderr || "").slice(-6000),
    error: run.ok ? null : (run.error || `pip 退出码 ${run.code}`),
  };
}

export default function registerSettingsRoutes(app, ctx) {
  app.get("/config", async (c) => {
    try {
      return c.json({ ok: true, config: await readConfig(ctx) });
    } catch (error) {
      return c.json({ ok: false, message: `读取设置失败：${error?.message || error}` });
    }
  });

  app.post("/config", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const patch = body && typeof body === "object" ? (body.config || body) : {};
    try {
      await writeConfig(ctx, patch);
      return c.json({ ok: true, config: await readConfig(ctx) });
    } catch (error) {
      return c.json({ ok: false, message: error?.message || String(error) });
    }
  });

  app.get("/deps", async (c) => {
    try {
      return c.json(await detectDeps(ctx));
    } catch (error) {
      return c.json({ ok: false, error: `依赖检测失败：${error?.message || error}` });
    }
  });

  app.post("/install", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const result = await installDeps(ctx, body?.packages);
      return c.json(result);
    } catch (error) {
      return c.json({ ok: false, error: `安装失败：${error?.message || error}` });
    }
  });
}
