// Doc Intake 设置页（Hana 设置窗里的自定义页 · contributes.settings.ui）。
// 数据面：hana.api.fetch → /api/apps/doc-intake/routes/{config,deps,install}
// 渲染模型：字段表驱动；基础项与高级设置写配置，依赖卡走只读探测 + 可选 pip 安装。
// 容错：任何请求失败都在页内显式报出原因，绝不让页面无声地停在「检测中」。
// 注意：页面跑在沙箱 iframe 里，window.confirm 被禁 —— 安装确认走页内确认条。
import { hana } from "./sdk.js";

const API = { config: "/config", deps: "/deps", install: "/install" };
const STATUS_TIMEOUT_MS = 15000;
const DEPS_TIMEOUT_MS = 90000;
const INSTALL_TIMEOUT_MS = 660000;
const READY_TIMEOUT_MS = 8000;

// 展开 / 收起动效。跟随系统「减少动态效果」时直接切换，不做动画。
const COLLAPSE_MIN_MS = 200;
const COLLAPSE_MAX_MS = 420;
const COLLAPSE_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";
// 时长跟块高走：矮块利落、高块稍慢，内容一多就不会“啪”地弹开。
const collapseDuration = (height) => Math.round(Math.min(
  COLLAPSE_MAX_MS,
  Math.max(COLLAPSE_MIN_MS, 150 + height * 0.22),
));
const REDUCED_MOTION = typeof window !== "undefined"
  && !!window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- 字段表

// wide = 控件换行占满整行（路径 / Token / 降级链这类长文本）。
const FIELDS = {
  pythonPath: {
    title: "Python 可执行文件路径",
    hint: "必填。填 conda 环境或系统 Python 的 python.exe 完整路径，不填则插件无法运行。",
    type: "string",
    wide: true,
    placeholder: "例如 E:\\Miniconda\\envs\\Agent\\python.exe",
  },
  defaultBackend: {
    title: "默认解析后端",
    hint: "调用工具时未指定后端就按它走。一般保持「自动」。",
    type: "string",
    labels: { auto: "自动", mineru: "MinerU", paddleocr: "PaddleOCR", local: "本地（PyMuPDF）" },
  },
  pdfBackendChain: {
    title: "PDF 后端降级链",
    hint: "留空 = 自动（mineru > paddleocr > local）。也可显式写顺序，用 > 或 ; 分隔，按顺序尝试、失败自动降到下一档。",
    type: "string",
    wide: true,
    placeholder: "留空 = mineru>paddleocr>local",
  },
  mineruCredentials: {
    title: "MinerU Token",
    hint: "多个用分号分隔。获取地址：https://mineru.net/apiManage/token",
    type: "string",
    wide: true,
    textarea: true,
    placeholder: "token1;token2",
  },
  paddleTokens: {
    title: "PaddleOCR Token",
    hint: "多个用分号分隔。获取地址：https://aistudio.baidu.com/account/accessToken",
    type: "string",
    wide: true,
    textarea: true,
    placeholder: "token1;token2",
  },
  defaultLanguage: {
    title: "默认语言",
    hint: "zh / en 等，传递给 OCR 与云端 API。",
    type: "string",
    placeholder: "zh",
  },
  includeMedia: {
    title: "默认提取媒体",
    hint: "提取结果里的图片 / 视频 / 音频是否一并落到本地。",
    type: "boolean",
  },
  autoSave: {
    title: "默认自动保存到本地",
    hint: "开启后，未显式指定输出目录时也把结果写入下面的保存路径。",
    type: "boolean",
  },
  savePath: {
    title: "默认保存路径",
    hint: "留空 = 系统文档目录下的 doc-intake（按各自的机器算，不写死盘符）。",
    type: "string",
    wide: true,
    placeholder: "留空 = 文档目录/doc-intake",
  },

  // ---- MinerU ----
  mineruModelVersion: {
    title: "MinerU 模型版本",
    hint: "vlm 精度最高，pipeline 速度快。",
    type: "string",
    labels: { vlm: "vlm（精度高）", pipeline: "pipeline（速度快）", "MinerU-HTML": "MinerU-HTML" },
  },
  mineruEnableOCR: { title: "开启 OCR", hint: "仅 pipeline / vlm 有效。", type: "boolean" },
  mineruEnableFormula: { title: "开启公式识别", type: "boolean" },
  mineruEnableTable: { title: "开启表格识别", type: "boolean" },
  mineruFlashMaxMB: { title: "Flash 最大文件大小(MB)", hint: "无 Token 时走 Flash 模式。", type: "number", int: true },
  mineruFlashMaxPages: { title: "Flash 最大页数", type: "number", int: true },
  mineruPrecisionMaxMB: { title: "Precision 最大文件大小(MB)", hint: "有 Token 时走 Precision 模式。", type: "number", int: true },
  mineruPrecisionMaxPages: { title: "Precision 最大页数", type: "number", int: true },

  // ---- PaddleOCR ----
  paddleUseDocOrientationClassify: { title: "文档方向分类", type: "boolean" },
  paddleUseDocUnwarping: { title: "文档去扭曲", type: "boolean" },
  paddleUseChartRecognition: { title: "图表识别", type: "boolean" },
  paddleUseSealRecognition: { title: "印章识别", type: "boolean" },
  paddleUseTableRecognition: { title: "表格识别", type: "boolean" },
  paddleUseFormulaRecognition: { title: "公式识别", type: "boolean" },

  // ---- PDF 切割 ----
  autoSplitLargePDF: {
    title: "自动切割超限 PDF",
    hint: "在插件的 Python 进程内按「每块页数」切成内存 PDF bytes 直传云端，不在源目录留 chunk 文件。",
    type: "boolean",
  },
  splitChunkPages: { title: "切割时每块页数", hint: "保持小于 MinerU 的 200 页限制。", type: "number", int: true },

  // ---- 图片分割 ----
  splitImageThreshold: { title: "图片分割阈值", hint: "高度 / 宽度超过此值才启用长图分割。", type: "number" },
  splitImageTolerance: { title: "图片分割色差容忍度", hint: "欧氏距离。", type: "number" },
  splitImageBlankRatio: { title: "空白行像素比例阈值", hint: "一行中多少比例的像素相近才算空白行。", type: "number" },
  splitImageMinBlank: { title: "最小连续空白行数", hint: "连续多少行空白才作为切割点。", type: "number", int: true },

  // ---- 并发与重试 ----
  maxConcurrent: { title: "云端 API 并发限", hint: "MinerU / PaddleOCR。", type: "number", int: true },
  maxConcurrentLocal: { title: "本地解析并发限", hint: "DOCX / PPTX / HTML 等；旧版 Office 转换另有独立并发限。", type: "number", int: true },
  maxRetries: { title: "API 临时错误最大重试次数", hint: "429 / 5xx / 网络抖动。", type: "number", int: true },
  retryBaseDelayMs: { title: "重试基础退避（毫秒）", hint: "5xx/网络按 base × 2^attempt；429 独立用 8s base。", type: "number", int: true },
  keyRetryOnFailure: { title: "Key 失败时自动重试下一个", type: "boolean" },
  notifyKeyFailure: { title: "Key 失效时通知用户", type: "boolean" },

  // ---- 旧版 Office 转换 ----
  legacyConversionProvider: {
    title: "旧版 Office 转换后端",
    hint: "作用于 .doc / .xls / .ppt。",
    type: "string",
    labels: { auto: "自动", office_com: "Office COM", libreoffice: "LibreOffice", disabled: "禁用" },
  },
  libreOfficePath: {
    title: "LibreOffice 可执行文件路径",
    hint: "仅选 libreoffice，或 auto 且无 Office COM 时使用。",
    type: "string",
    wide: true,
    placeholder: "例如 C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  },
  legacyConversionConcurrency: { title: "旧版 Office 转换并发限", hint: "COM 默认串行。", type: "number", int: true },
  legacyConversionTimeoutMs: { title: "旧版 Office 转换超时（毫秒）", type: "number", int: true },

  // ---- HTML 提取 ----
  htmlExtractMetadata: { title: "提取元数据", hint: "title、author、description 等。", type: "boolean" },
  htmlExtractLinks: { title: "提取链接列表", type: "boolean" },
  htmlExtractImages: { title: "提取并下载图片", type: "boolean" },
  htmlExtractCodeBlocks: { title: "提取代码块", hint: "并标注语言。", type: "boolean" },
  htmlHeadingStyle: { title: "标题风格", type: "string", labels: { ATX: "ATX（#）", SETEXT: "SETEXT（下划线）" } },
  maxRemoteImagesPerHtml: { title: "最多下载远程图片数", type: "number", int: true },

  // ---- Excel 上限 ----
  xlsxMaxRows: { title: "Excel 最大提取行数", hint: "0 表示不限制。", type: "number", int: true },
  xlsxMaxCols: { title: "Excel 最大提取列数", hint: "0 表示不限制。", type: "number", int: true },

  // ---- Agent 返回容量 ----
  inlineBlockBytes: { title: "每个返回文本块最大字节", hint: "代码内限制 4096–30720。", type: "number", int: true },
  inlineBlockCount: { title: "返回文本块数量上限", hint: "代码内限制 1–8。", type: "number", int: true },
  mediaPathReturnLimit: { title: "Agent 返回媒体路径数量上限", hint: "超过上限时只返回媒体总数。", type: "number", int: true },
  saveJson: { title: "默认保存结构化 JSON", type: "boolean" },

  // ---- 日志 ----
  logLevel: { title: "日志级别", type: "string", labels: { DEBUG: "DEBUG", INFO: "INFO", WARNING: "WARNING", ERROR: "ERROR" } },
  logFile: { title: "日志文件路径", hint: "留空则只输出到控制台。", type: "string", wide: true, placeholder: "留空 = 只输出到控制台" },
};

const BASIC_KEYS = [
  "pythonPath",
  "defaultBackend",
  "pdfBackendChain",
  "mineruCredentials",
  "paddleTokens",
  "defaultLanguage",
  "includeMedia",
  "autoSave",
  "savePath",
];

const ADVANCED_GROUPS = [
  { title: "MinerU", keys: ["mineruModelVersion", "mineruEnableOCR", "mineruEnableFormula", "mineruEnableTable", "mineruFlashMaxMB", "mineruFlashMaxPages", "mineruPrecisionMaxMB", "mineruPrecisionMaxPages"] },
  { title: "PaddleOCR", keys: ["paddleUseDocOrientationClassify", "paddleUseDocUnwarping", "paddleUseChartRecognition", "paddleUseSealRecognition", "paddleUseTableRecognition", "paddleUseFormulaRecognition"] },
  { title: "PDF 切割", keys: ["autoSplitLargePDF", "splitChunkPages"] },
  { title: "图片分割", keys: ["splitImageThreshold", "splitImageTolerance", "splitImageBlankRatio", "splitImageMinBlank"] },
  { title: "并发与重试", keys: ["maxConcurrent", "maxConcurrentLocal", "maxRetries", "retryBaseDelayMs", "keyRetryOnFailure", "notifyKeyFailure"] },
  { title: "旧版 Office 转换", keys: ["legacyConversionProvider", "libreOfficePath", "legacyConversionConcurrency", "legacyConversionTimeoutMs"] },
  { title: "HTML 提取", keys: ["htmlExtractMetadata", "htmlExtractLinks", "htmlExtractImages", "htmlExtractCodeBlocks", "htmlHeadingStyle", "maxRemoteImagesPerHtml"] },
  { title: "Excel 上限", keys: ["xlsxMaxRows", "xlsxMaxCols"] },
  { title: "Agent 返回容量", keys: ["inlineBlockBytes", "inlineBlockCount", "mediaPathReturnLimit", "saveJson"] },
  { title: "日志", keys: ["logLevel", "logFile"] },
];

// ---------------------------------------------------------------- 基础件

const el = (id) => document.getElementById(id);
const ui = {
  root: el("gs"),
  refresh: el("btn-refresh"),
  reload: el("btn-reload"),
  save: el("btn-save"),
  saveState: el("save-state"),
  note: el("gs-note"),
  banner: el("python-banner"),
  basic: el("basic-fields"),
  advToggle: el("adv-toggle"),
  adv: el("adv-fields"),
  depsSummary: el("deps-summary"),
  depsToggle: el("deps-toggle"),
  depsBody: el("deps-body"),
  depsList: el("deps-list"),
  depsActions: el("deps-actions"),
  depsNote: el("deps-note"),
  depsRefresh: el("deps-refresh"),
  depsLog: el("deps-log"),
  installConfirm: el("install-confirm"),
  installConfirmText: el("install-confirm-text"),
  installOk: el("install-ok"),
  installCancel: el("install-cancel"),
};

let loaded = {};            // 服务端读回的配置（对比用）
const controls = new Map(); // key -> { read, write, type }
let depsState = { loading: true, data: null, error: "" };
let pendingInstall = null;  // { packages, label }
let installing = false;
let depsLogText = "";
let advCollapsible = null;
let depsCollapsible = null;

// 主题明暗只拿来干一件正事：让原生控件（下拉弹层、滚动条）跟着明暗走。
// 配色本身由宿主注入的主题 CSS 负责，这里不再自己写一套深色覆盖（t-dark 已删）。
function themeAppearance() {
  try {
    const snap = hana.theme?.getSnapshot?.();
    if (snap?.appearance === "dark" || snap?.appearance === "light") return snap.appearance;
    const label = String(snap?.theme || "");
    if (label && label !== "inherit") return /dark|midnight|contrast|深|夜/i.test(label) ? "dark" : "light";
  } catch { /* SDK 还没就绪，往下走 */ }

  const fromUrl = new URLSearchParams(location.search).get("hana-theme-appearance");
  if (fromUrl === "dark" || fromUrl === "light") return fromUrl;

  // 兜底：按正文色亮度判断。比 prefers-color-scheme 可靠——后者跟的是系统，不是插件主题。
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;color:var(--gs-ink)";
  document.body.appendChild(probe);
  const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/g) || []).map(Number);
  probe.remove();
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? "dark" : "light";
}

function syncTheme() {
  const appearance = themeAppearance();
  if (appearance) document.documentElement.style.colorScheme = appearance;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms 未响应）`)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function api(path, init) {
  const res = await hana.api.fetch(path, init);
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, message: raw }; }
  return { status: res.status, data };
}
const apiPost = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });

function setNote(message, kind) {
  ui.note.textContent = message || "";
  ui.note.hidden = !message;
  ui.note.dataset.kind = kind || "";
}

function setDepsNote(message, kind) {
  ui.depsNote.textContent = message || "";
  ui.depsNote.hidden = !message;
  ui.depsNote.dataset.kind = kind || "";
}

function makeBusy(label) {
  const wrap = document.createElement("span");
  wrap.className = "gs-busy";
  const spinner = document.createElement("span");
  spinner.className = "gs-spinner";
  const node = document.createElement("span");
  node.textContent = label;
  wrap.append(spinner, node);
  return wrap;
}

function makeButton(label, { variant = "primary", onClick, disabled = false, title } = {}) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = ["gs-btn", variant === "ghost" ? "gs-btn--ghost" : ""].filter(Boolean).join(" ");
  node.textContent = label;
  node.disabled = disabled;
  if (title) node.title = title;
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

async function copyText(value) {
  const data = String(value ?? "");
  if (!data) return false;
  try { await hana.clipboard.writeText(data, { timeoutMs: 2000 }); return true; } catch {}
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(data); return true; } } catch {}
  try {
    const area = document.createElement("textarea");
    area.value = data;
    area.readOnly = true;
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 展开 / 收起

// 用 WAAPI 量高做动画，块高不写死（内容变化后展开高度自动是对的）。
// fill: forwards 是必需的：动画结束后到 paint 之间若填充被撤，会闪一下原高度。
function createCollapsible(toggle, body, openInitially) {
  let open = !!openInitially;
  let anim = null;

  const paint = (next) => {
    toggle.setAttribute("aria-expanded", next ? "true" : "false");
    body.hidden = !next;
    body.style.height = "";
    body.style.overflow = "";
  };

  const measure = () => {
    const wasHidden = body.hidden;
    if (wasHidden) body.hidden = false;
    const height = body.scrollHeight;
    if (wasHidden) body.hidden = true;
    return height;
  };

  const set = (next) => {
    next = !!next;
    if (next === open) return;
    const from = body.hidden ? 0 : body.getBoundingClientRect().height;
    const to = next ? measure() : 0;
    open = next;
    toggle.setAttribute("aria-expanded", next ? "true" : "false");

    if (REDUCED_MOTION || from === to) {
      paint(next);
      return;
    }
    if (anim) { try { anim.cancel(); } catch {} anim = null; }
    body.hidden = false;
    body.style.overflow = "hidden";
    body.style.height = `${from}px`;
    anim = body.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: collapseDuration(Math.abs(to - from)), easing: COLLAPSE_EASE, fill: "forwards" },
    );
    anim.onfinish = () => { anim = null; paint(next); };
  };

  paint(open);
  toggle.addEventListener("click", () => set(!open));
  return { set, isOpen: () => open };
}

// ---------------------------------------------------------------- 表单构建

function buildControl(key) {
  const meta = FIELDS[key];
  if (meta.type === "boolean") {
    const label = document.createElement("label");
    label.className = "gs-switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    const track = document.createElement("span");
    track.className = "gs-switch__track";
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "gs-switch__thumb";
    track.appendChild(thumb);
    label.append(input, track);
    input.addEventListener("change", onDraftChange);
    return { node: label, read: () => input.checked, write: (v) => { input.checked = !!v; }, type: "boolean" };
  }

  if (meta.labels) {
    const select = document.createElement("select");
    select.className = "gs-select";
    for (const [value, text] of Object.entries(meta.labels)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    select.addEventListener("change", onDraftChange);
    return {
      node: select,
      read: () => select.value,
      write: (v) => {
        const wanted = String(v ?? "");
        if (Object.prototype.hasOwnProperty.call(meta.labels, wanted)) select.value = wanted;
      },
      type: "string",
    };
  }

  if (meta.textarea) {
    const area = document.createElement("textarea");
    area.className = "gs-textarea";
    if (meta.placeholder) area.placeholder = meta.placeholder;
    area.spellcheck = false;
    area.addEventListener("input", onDraftChange);
    return { node: area, read: () => area.value, write: (v) => { area.value = v == null ? "" : String(v); }, type: "string" };
  }

  const input = document.createElement("input");
  if (meta.type === "number") {
    input.type = "number";
    input.className = "gs-input gs-input--num";
    input.step = meta.int ? "1" : "any";
  } else {
    input.type = "text";
    input.className = "gs-input";
    input.spellcheck = false;
    input.autocomplete = "off";
  }
  if (meta.placeholder) input.placeholder = meta.placeholder;
  input.addEventListener("input", onDraftChange);
  return { node: input, read: () => input.value, write: (v) => { input.value = v == null ? "" : String(v); }, type: meta.type };
}

function buildField(key) {
  const meta = FIELDS[key];
  const row = document.createElement("div");
  row.className = "gs-field" + (meta.wide ? " gs-field--wide" : "");

  const label = document.createElement("div");
  label.className = "gs-field__label";
  const title = document.createElement("span");
  title.className = "gs-field__title";
  title.textContent = meta.title || key;
  label.appendChild(title);
  if (meta.hint) {
    const hint = document.createElement("span");
    hint.className = "gs-field__hint";
    hint.textContent = meta.hint;
    label.appendChild(hint);
  }

  const control = document.createElement("div");
  control.className = "gs-field__control";
  const built = buildControl(key);
  control.appendChild(built.node);

  row.append(label, control);
  controls.set(key, built);
  return row;
}

function buildAllFields() {
  for (const key of BASIC_KEYS) ui.basic.appendChild(buildField(key));
  for (const group of ADVANCED_GROUPS) {
    const box = document.createElement("div");
    box.className = "gs-group";
    const head = document.createElement("div");
    head.className = "gs-group__title";
    head.textContent = group.title;
    box.appendChild(head);
    for (const key of group.keys) {
      if (!FIELDS[key]) continue;
      box.appendChild(buildField(key));
    }
    ui.adv.appendChild(box);
  }
}

function readAll() {
  const out = {};
  for (const [key, control] of controls) {
    const meta = FIELDS[key];
    if (meta.type === "number") {
      const raw = String(control.read()).trim();
      if (raw === "") continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      out[key] = num;
    } else if (meta.type === "boolean") {
      out[key] = !!control.read();
    } else {
      out[key] = String(control.read());
    }
  }
  return out;
}

function writeAll(values) {
  for (const [key, control] of controls) control.write(values[key]);
}

function currentValues() {
  const out = {};
  for (const [key, control] of controls) {
    const meta = FIELDS[key];
    out[key] = meta.type === "boolean" ? !!control.read() : String(control.read());
  }
  return out;
}

function isDirty() {
  const now = currentValues();
  for (const key of Object.keys(FIELDS)) {
    if (String(now[key]) !== String(loaded[key] ?? "")) return true;
  }
  return false;
}

function onDraftChange() {
  const dirty = isDirty();
  ui.save.disabled = !dirty;
  if (!dirty) ui.saveState.textContent = "";
  else ui.saveState.textContent = "有未保存的改动";
  updateBanner();
}

function updateBanner() {
  const py = String(controls.get("pythonPath")?.read() || "").trim();
  if (py) {
    ui.banner.hidden = true;
    return;
  }
  ui.banner.hidden = false;
  ui.banner.textContent = "还没有填写 Python 可执行文件路径。填好并保存后，这个插件才能工作，依赖检测也才有对象。";
}

// ---------------------------------------------------------------- 配置读写

async function loadConfig() {
  const { data } = await withTimeout(api(API.config), STATUS_TIMEOUT_MS, "读取设置");
  if (!data || !data.ok) throw new Error(data?.message || "后端返回失败");
  loaded = data.config || {};
  writeAll(loaded);
  ui.save.disabled = true;
  ui.saveState.textContent = "";
  updateBanner();
}

async function saveConfig() {
  ui.save.disabled = true;
  ui.saveState.textContent = "保存中…";
  try {
    const { data } = await withTimeout(apiPost(API.config, { config: readAll() }), STATUS_TIMEOUT_MS, "保存设置");
    if (!data || !data.ok) throw new Error(data?.message || "后端返回失败");
    loaded = data.config || {};
    writeAll(loaded);
    ui.saveState.textContent = "已保存";
    setNote("设置已保存，改动即时生效。", "ok");
    updateBanner();
    // pythonPath 变了，依赖检测结果跟着失效
    void loadDeps();
  } catch (error) {
    ui.save.disabled = false;
    ui.saveState.textContent = "";
    setNote(`保存失败：${error?.message || error}`, "err");
  }
}

// ---------------------------------------------------------------- 环境依赖

function levelBadge(level) {
  const span = document.createElement("span");
  // 「必装 / 可选」不动色相，只靠字重与描边区分（跟 git-save-load 的徽章纪律一致）
  span.className = level === "required" ? "gs-badge gs-badge--req" : "gs-badge gs-badge--opt";
  span.textContent = level === "required" ? "必装" : "可选";
  return span;
}

function statusBadge(lib) {
  const span = document.createElement("span");
  span.className = "gs-badge";
  if (lib.installed === true) {
    span.dataset.state = "ok";
    span.textContent = lib.version ? `已安装 ${lib.version}` : "已安装";
  } else if (lib.installed === false) {
    // 必装缺失才算危险；可选项缺失只是普通灰。
    span.dataset.state = lib.level === "required" ? "bad" : "off";
    span.textContent = "未安装";
  } else {
    span.dataset.state = "off";
    span.textContent = "未知";
  }
  if (lib.error) span.title = lib.error;
  return span;
}

function renderDeps() {
  const s = depsState;
  ui.depsList.textContent = "";

  const head = document.createElement("div");
  head.className = "gs-dep gs-dep--head";
  for (const text of ["库", "功能", "类型", "状态"]) {
    const cell = document.createElement("span");
    cell.className = "gs-dep__cell";
    cell.textContent = text;
    head.appendChild(cell);
  }
  ui.depsList.appendChild(head);

  const libs = (s.data && s.data.libs) || [];
  if (s.loading) {
    for (const lib of libs) ui.depsList.appendChild(depRow(lib));
    if (!libs.length) ui.depsList.appendChild(skeletonRow());
  } else {
    for (const lib of libs) ui.depsList.appendChild(depRow(lib));
  }

  // 摘要（折叠时它就是卡片头那一行结论）
  ui.depsSummary.dataset.state = "";
  if (s.loading) {
    ui.depsSummary.textContent = "检测中…";
  } else if (s.error) {
    ui.depsSummary.textContent = "检测失败";
  } else if (s.data && s.data.configured === false) {
    ui.depsSummary.textContent = "未配置 pythonPath，先到「基础项」填写并保存。";
  } else if (s.data) {
    const total = libs.length;
    const installed = libs.filter((l) => l.installed === true).length;
    const missingRequired = libs.filter((l) => l.level === "required" && l.installed === false).length;
    const py = s.data.python ? `Python ${s.data.python}` : "已配置的 Python";
    const env = s.data.pythonPath ? `（${s.data.pythonPath}）` : "";
    ui.depsSummary.textContent = `${py}${env} · 共 ${total} 个依赖，已装 ${installed} 个`
      + (missingRequired ? `，必装缺 ${missingRequired} 个` : "，必装齐全");
    ui.depsSummary.title = s.data.pythonPath || "";
    ui.depsSummary.dataset.state = missingRequired ? "bad" : "";
  } else {
    ui.depsSummary.textContent = "尚未检测。";
  }

  renderDepsActions();
  ui.depsLog.hidden = !depsLogText;
  ui.depsLog.textContent = depsLogText;
}

function depRow(lib) {
  const row = document.createElement("div");
  row.className = "gs-dep";
  const name = document.createElement("span");
  name.className = "gs-dep__name";
  name.textContent = lib.name;
  const purpose = document.createElement("span");
  purpose.className = "gs-dep__purpose";
  purpose.textContent = lib.purpose;
  const level = document.createElement("span");
  level.className = "gs-dep__level";
  level.appendChild(levelBadge(lib.level));
  const status = document.createElement("span");
  status.className = "gs-dep__status";
  status.appendChild(statusBadge(lib));
  row.append(name, purpose, level, status);
  return row;
}

function skeletonRow() {
  const row = document.createElement("div");
  row.className = "gs-dep";
  const cell = document.createElement("span");
  cell.className = "gs-dep__purpose";
  cell.textContent = "读取依赖清单…";
  row.appendChild(cell);
  return row;
}

function missingLibs() {
  return ((depsState.data && depsState.data.libs) || []).filter((l) => l.installed === false);
}

function pipCommand(libs) {
  const py = String(controls.get("pythonPath")?.read() || "").trim() || "python";
  const specs = libs.map((l) => `"${l.pip}"`).join(" ");
  return `"${py}" -m pip install ${specs}`;
}

function renderDepsActions() {
  ui.depsActions.textContent = "";
  const configured = !!(depsState.data && depsState.data.configured);
  if (depsState.loading) {
    ui.depsActions.appendChild(makeBusy("检测中…"));
    return;
  }
  if (installing) {
    ui.depsActions.appendChild(makeBusy("正在安装…"));
    return;
  }

  const missing = missingLibs();
  const missingRequired = missing.filter((l) => l.level === "required");

  if (!configured) {
    const hint = document.createElement("span");
    hint.className = "gs-muted";
    hint.textContent = "配置 pythonPath 后即可一键检测与安装。";
    ui.depsActions.appendChild(hint);
    return;
  }

  if (missing.length === 0) {
    const ok = document.createElement("span");
    ok.className = "gs-muted";
    ok.textContent = "清单里的依赖都装好了。";
    ui.depsActions.appendChild(ok);
    ui.depsActions.appendChild(makeButton("重新检测", { variant: "ghost", onClick: () => void loadDeps() }));
    return;
  }

  ui.depsActions.appendChild(makeButton("复制安装命令", {
    variant: "ghost",
    onClick: async () => {
      const ok = await copyText(pipCommand(missing));
      setDepsNote(ok ? "安装命令已复制，可在终端里自行执行。" : "复制被拦截，请手动选中命令复制。", ok ? "ok" : "warn");
    },
  }));

  if (missingRequired.length) {
    ui.depsActions.appendChild(makeButton(`一键安装缺失的必装依赖（${missingRequired.length}）`, {
      onClick: () => askInstall(missingRequired, "必装依赖"),
    }));
  }
  const missingOptional = missing.filter((l) => l.level !== "required");
  if (missingOptional.length) {
    ui.depsActions.appendChild(makeButton(`安装全部缺失（含可选，${missing.length}）`, {
      variant: "ghost",
      onClick: () => askInstall(missing, "全部缺失依赖"),
    }));
  }
}

function askInstall(libs, label) {
  // 安装走的是已保存的 pythonPath：有草稿未保存时先拦住，避免装错环境。
  if (isDirty()) {
    setDepsNote("有未保存的改动。先点下方「保存」，依赖检测和安装才会用新配置。", "warn");
    return;
  }
  pendingInstall = { packages: libs.map((l) => l.pip), label };
  const py = String(controls.get("pythonPath")?.read() || "").trim();
  ui.installConfirmText.textContent = `将向 ${py} 安装${label}：${libs.map((l) => l.name).join("、")}。这会改动你那个 Python 环境，确认继续？`;
  depsCollapsible?.set(true);
  ui.installConfirm.hidden = false;
  setDepsNote("");
}

function clearInstallConfirm() {
  pendingInstall = null;
  ui.installConfirm.hidden = true;
}

async function doInstall() {
  if (!pendingInstall) return;
  const packages = pendingInstall.packages.slice();
  clearInstallConfirm();
  installing = true;
  depsLogText = "";
  setDepsNote("正在安装，视网络与包大小可能需要一会儿…");
  renderDeps();
  try {
    const { data } = await withTimeout(apiPost(API.install, { packages }), INSTALL_TIMEOUT_MS, "安装依赖");
    const parts = [];
    if (data?.stdout) parts.push(data.stdout.trim());
    if (data?.stderr) parts.push(data.stderr.trim());
    depsLogText = parts.join("\n").slice(-6000) || (data?.error || "");
    installing = false;
    if (data?.ok) {
      setDepsNote("安装完成，已重新检测。", "ok");
    } else {
      setDepsNote(`安装失败：${data?.error || "未知原因"}，详见下方输出。`, "err");
    }
  } catch (error) {
    installing = false;
    setDepsNote(`安装失败：${error?.message || error}`, "err");
  }
  renderDeps();
  void loadDeps();
}

async function loadDeps() {
  depsState = { loading: true, data: depsState.data, error: "" };
  renderDeps();
  try {
    const { data } = await withTimeout(api(API.deps), DEPS_TIMEOUT_MS, "依赖检测");
    if (!data || data.ok === false) throw new Error(data?.error || "后端返回失败");
    depsState = { loading: false, data, error: "" };
    setDepsNote("");
  } catch (error) {
    depsState = { loading: false, data: depsState.data, error: String(error?.message || error) };
    setDepsNote(`依赖检测失败：${depsState.error}`, "err");
  }
  renderDeps();
}

// ---------------------------------------------------------------- 启动

function wire() {
  ui.save.addEventListener("click", () => void saveConfig());
  ui.reload.addEventListener("click", () => void reloadConfig());
  ui.refresh.addEventListener("click", () => void reloadConfig());
  ui.depsRefresh.addEventListener("click", () => void loadDeps());
  ui.installOk.addEventListener("click", () => void doInstall());
  ui.installCancel.addEventListener("click", clearInstallConfirm);
  advCollapsible = createCollapsible(ui.advToggle, ui.adv, false);
  depsCollapsible = createCollapsible(ui.depsToggle, ui.depsBody, false);
}

async function reloadConfig() {
  setNote("");
  try {
    await loadConfig();
    setNote("已重新载入。", "ok");
  } catch (error) {
    setNote(`读取设置失败：${error?.message || error}`, "err");
  }
  void loadDeps();
}

(async function boot() {
  buildAllFields();
  wire();
  syncTheme();
  try { hana.theme?.subscribe?.(() => syncTheme()); } catch {}
  ui.root.setAttribute("aria-busy", "true");
  try { await withTimeout(hana.ready(), READY_TIMEOUT_MS, "SDK 就绪"); } catch {}
  try {
    await loadConfig();
  } catch (error) {
    setNote(`读取设置失败：${error?.message || error}`, "err");
  }
  ui.root.setAttribute("aria-busy", "false");
  void loadDeps();
})();
