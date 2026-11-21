// ui/panel.js — 文档提取面板卡
//
// 这张卡：选文件、定目录、摆好默认值，按下「开始提取」后起一次后台作业，
// 自己轮询进度，把每个文件的状态和一条总进度画出来。作业本身在后端跑
// （lib/job-runner.js），这里只负责发起和呈现。
//
// 只碰四条路由：/panel-defaults（读默认值）、/run（发起）、/job-status（轮询）、
// /reveal（在文件管理器里定位产物）。除此之外不发任何请求。

import { estimateTotalMs, fakePercent } from "./shared/progress.js";
import { installThemeBridge } from "./theme-bridge.js";

const PANEL_WIDTH = 460;
/** 折叠区过渡时长，与 panel.css 里的 200ms 对齐；过渡跑完再兜一次上报。 */
const FOLD_MS = 200;
/** 用户可能停在系统文件对话框里很久，超时给足 10 分钟，别半路把选择收走。 */
const PICK_TIMEOUT_MS = 600000;
/** 轮询间隔。作业快照本来就是秒级更新，更密只是白烧 CPU。 */
const POLL_MS = 1000;
/** 轮询连续失败多少次才认定记录没了。单次抖动不该让面板停在半路。 */
const MAX_POLL_FAILURES = 5;
/** 收尾补满的时长：按剩余百分点给，并夹在这个区间里。 */
const FILL_MIN_MS = 300;
const FILL_MAX_MS = 1200;
const FILL_MS_PER_PERCENT = 30;

/** 作业里的文件状态 → 界面上的字。 */
const FILE_STATE_TEXT = {
  pending: "排队",
  running: "解析中",
  done: "完成",
  failed: "失败",
};

/** 投递事件名。宿主要求 ^[a-z0-9][a-z0-9._-]{0,63}$，小写、点分隔，不碰大写与空格。 */
export const EMIT_EVENT = "panel.delivered";
/** 宿主硬限：数据包序列化后不能到 8KB。这里留一点余量，按「小于」判。 */
export const EMIT_MAX_BYTES = 8192;
/** 截断时最多带几条文件。 */
export const EMIT_MAX_FILES = 20;

/**
 * 后端默认值回来之前，表单先按设置 schema 的默认值站着（manifest 里的 default）。
 * 这样即使 /panel-defaults 失败，看到的是「和设置一致的默认」，而不是一片空框。
 */
const FALLBACK_DEFAULTS = {
  savePath: "",
  defaultBackend: "auto",
  language: "zh",
  includeMedia: true,
  saveJson: false,
};

// ── 纯函数：路径与视图 ────────────────────────────────────────────────────
// 这几条不碰 DOM，行为要能被单独说清楚，所以拎出来。

/**
 * 去掉目录结尾的分隔符。
 * 例外是盘符根目录："D:\" 削完只剩 "D:"，那不是路径而是盘符，粘回一个反斜杠凑成完整根目录。
 * 空串与全是分隔符的输入原样返回，避免把一个有效字符串削成空。
 */
export function trimTrailingSeparator(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const stripped = text.replace(/[\\/]+$/, "");
  if (!stripped) return text;
  if (/^[A-Za-z]:$/.test(stripped)) return `${stripped}\\`;
  return stripped;
}

/** 去重用的键：Windows 上路径大小写不敏感，分隔符两种写法算同一个路径。 */
export function pathKey(value) {
  return (typeof value === "string" ? value : "")
    .trim()
    .replace(/[\\/]+/g, "/")
    .toLowerCase();
}

/**
 * 把新选中的路径并进已有的多行文本：已有内容就换行追加，重复的不再加。
 * 返回拼好的整段文本，调用方直接写回输入框。
 */
export function mergePathLines(current, incoming) {
  const lines = String(current ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const seen = new Set(lines.map(pathKey));
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const path = typeof raw === "string" ? raw.trim() : "";
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(path);
  }
  return lines.join("\n");
}

/** 取路径最后一段。作业里已经有 name，但从 source 兜底时得自己切一刀。 */
export function baseNameOf(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

/**
 * 单个文件在总进度里占的份额（0~1）。
 * 完成算满；还在跑就按它自己跑了多久去逼一条渐近曲线；排队与失败都算 0。
 *
 * 失败算 0 而不是算满，是这张条的诚实之处：有一个文件没成，总进度就永远到不了 100，
 * 条子停在缺口上，和下面那行「成功 1/2」说的是同一件事。
 * 收敛条件交给后端估的那个总耗时（estimateTotalMs），和进度卡用的是同一套。
 */
export function fileFraction(file, now, fallbackBackend) {
  const status = file?.status;
  if (status === "done") return 1;
  if (status !== "running") return 0;
  const startedAt = Number(file?.startedAt);
  const elapsedMs = Number.isFinite(startedAt) && startedAt > 0 ? Math.max(0, now - startedAt) : 0;
  const backend = typeof file?.backend === "string" && file.backend ? file.backend : fallbackBackend;
  const total = estimateTotalMs(file?.pages, backend);
  return fakePercent(elapsedMs, total) / 100;
}

/** 整卡那一条总的百分比：各文件份额之和除以总数。 */
export function overallPercentOf(job, now, fallbackBackend) {
  const files = Array.isArray(job?.files) ? job.files : [];
  if (!files.length) return 0;
  const sum = files.reduce((acc, file) => acc + fileFraction(file, now, fallbackBackend), 0);
  const percent = (sum / files.length) * 100;
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/**
 * 序列化后的字节数（UTF-8）。
 * 宿主按字节卡 8KB，而中文一个字三字节，用字符串长度当尺子会低估得多。
 * TextEncoder 浏览器与 Node 都有；万一没有就按「字符数 × 3」估，宁可算大一点，
 * 被门卫退回比多砍几条文件代价大。
 */
function jsonByteLength(value) {
  const text = JSON.stringify(value) ?? "";
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 3;
  }
}

function deliverFileEntry(file, withExtras) {
  const mdPath = typeof file?.mdPath === "string" ? file.mdPath : "";
  const name = baseNameOf(file?.name) || baseNameOf(file?.source) || "未命名文件";
  if (!withExtras) return { name, mdPath };
  const pages = Number(file?.pages);
  return {
    name,
    mdPath,
    backend: typeof file?.backend === "string" ? file.backend : "",
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
  };
}

/**
 * 作业快照 → 投递给对话的数据包（纯函数，不碰 DOM，也不发任何东西）。
 *
 * 规则只有一条是硬的：宿主卡 8KB。所以按「信息从多到少」退三步，
 * 每一步都比上一步更适合小包：
 *   1) 全量（带 backend 与 pages）
 *   2) 只留 name 与 mdPath
 *   3) 只取前 20 条，并标 truncated: true
 * 三步都装不下（名字里塞超长字符串之类）就继续砍半，直到塞进去。
 * 这一条是宿主的硬限制，不是这边的偏好；丢掉的只是产物清单，
 * 投递这件事本身要说明的「跑完了」仍然在。
 *
 * 只收 mdPath 有值的文件：没落盘的产物没有任何可以指给人看的位置。
 */
export function buildDeliverPayload(job) {
  const files = Array.isArray(job?.files) ? job.files : [];
  const total = files.length;
  const success = files.filter((file) => file?.status === "done").length;
  const kept = files.filter((file) => typeof file?.mdPath === "string" && file.mdPath.trim());
  const base = {
    jobId: typeof job?.jobId === "string" ? job.jobId : "",
    summary: `成功 ${success}/${total}`,
  };

  const candidates = [
    { ...base, files: kept.map((file) => deliverFileEntry(file, true)) },
    { ...base, files: kept.map((file) => deliverFileEntry(file, false)) },
    {
      ...base,
      files: kept.slice(0, EMIT_MAX_FILES).map((file) => deliverFileEntry(file, false)),
      truncated: true,
    },
  ];
  for (const candidate of candidates) {
    if (jsonByteLength(candidate) < EMIT_MAX_BYTES) return candidate;
  }

  let count = Math.min(EMIT_MAX_FILES, kept.length);
  while (count > 0) {
    count = Math.floor(count / 2);
    const candidate = {
      ...base,
      files: kept.slice(0, count).map((file) => deliverFileEntry(file, false)),
      truncated: true,
    };
    if (jsonByteLength(candidate) < EMIT_MAX_BYTES) return candidate;
  }
  return { ...base, files: [], truncated: true };
}

// ── 浏览器部分 ────────────────────────────────────────────────────────────
// 下面只在真有 DOM 时执行：Node 里 import 本文件是为了取上面的纯函数。

/** 面板要用到的三项能力。缺一样就退回随包的 SDK，不让半套 API 进来跑一半出错。 */
function hasPanelApi(candidate) {
  return Boolean(
    candidate
    && typeof candidate === "object"
    && typeof candidate.ui?.resize === "function"
    && typeof candidate.resources?.pick === "function"
    && typeof candidate.theme?.getSnapshot === "function",
  );
}

async function resolveHana() {
  // 独立预览页在加载本文件前塞了一个 window.hana（能力齐全才认）。
  // 真宿主里没有这个全局，走随包的 SDK。
  if (hasPanelApi(globalThis.hana)) return globalThis.hana;
  const mod = await import("./assets/sdk.js");
  return mod?.hana ?? null;
}

function startPanel() {
  const panelEl = document.getElementById("di-panel");
  const sourcesEl = document.getElementById("di-sources");
  const savePathEl = document.getElementById("di-save-path");
  const pickFileEl = document.getElementById("di-pick-file");
  const pickDirEl = document.getElementById("di-pick-dir");
  const pickSaveEl = document.getElementById("di-pick-save");
  const runEl = document.getElementById("di-run");
  const hintEl = document.getElementById("di-run-hint");
  const advHeadEl = document.getElementById("di-adv-toggle");
  const advChevronEl = document.getElementById("di-adv-chevron");
  const advBodyEl = document.getElementById("di-adv-body");
  const advInnerEl = document.getElementById("di-adv-inner");
  const backendEl = document.getElementById("di-backend");
  const pageRangeEl = document.getElementById("di-page-range");
  const languageEl = document.getElementById("di-language");
  const includeMediaEl = document.getElementById("di-include-media");
  const saveJsonEl = document.getElementById("di-save-json");
  const resultEl = document.getElementById("di-result");
  const overallTextEl = document.getElementById("di-overall-text");
  const overallPercentEl = document.getElementById("di-overall-percent");
  const barFillEl = document.getElementById("di-bar-fill");
  const filesEl = document.getElementById("di-files");
  const summaryEl = document.getElementById("di-summary");
  const deliverRowEl = document.getElementById("di-deliver");
  const deliverBtnEl = document.getElementById("di-deliver-btn");
  const deliverNoteEl = document.getElementById("di-deliver-note");

  if (!panelEl || !sourcesEl || !advBodyEl || !advInnerEl || !resultEl) return;

  let hana = null;
  let expanded = false;

  // ── 自绘下拉 ──────────────────────────────────────────────────────────
  // 原生 select 的弹层在 WebView 里按系统配色渲染，深色卡片下就是白底浅字，
  // 连选项都读不清。所以控件和列表都自己画：按钮 + 列表，键盘也能用
  // （上下移动、回车选中、Esc 收起、Tab 收起）。
  // 列表占普通流：卡片高度由内容决定，绝对定位的弹层会被卡片边界裁掉。
  function createCombo(rootEl) {
    if (!rootEl) return null;
    const fieldEl = rootEl.querySelector(".di-combo__field");
    const valueEl = rootEl.querySelector(".di-combo__value");
    const listEl = rootEl.querySelector(".di-combo__list");
    const popEl = rootEl.querySelector(".di-combo__pop");
    // 折叠区为了做出收起动画把 overflow 钉成了 hidden，浮层会被它直接裁掉。
    // 浮层打开时临时改成 visible，关上再恢复。
    const clipEl = rootEl.closest(".di-adv__body");
    const optionEls = Array.from(listEl ? listEl.querySelectorAll(".di-combo__option") : []);
    let activeIndex = -1;
    let clipTimer = 0;

    const optionValue = (el) => el?.getAttribute("data-value") || "";
    const isOpen = () => rootEl.classList.contains("is-open");

    function highlight(index) {
      if (!optionEls.length) return;
      const next = (index + optionEls.length) % optionEls.length;
      activeIndex = next;
      optionEls.forEach((el, i) => el.classList.toggle("is-active", i === next));
    }

    function openList() {
      if (!popEl || !listEl || isOpen()) return;
      // 先把列表真实高度量出来：浮层高度从 0 走到这个值，收起时再走回去，两个方向都有动画。
      const listH = Math.ceil(listEl.scrollHeight || 0);
      rootEl.style.setProperty("--di-list-h", `${listH}px`);
      clearTimeout(clipTimer);
      rootEl.classList.add("is-open");
      popEl.setAttribute("aria-hidden", "false");
      clipEl?.classList.add("is-unclipped");
      fieldEl?.setAttribute("aria-expanded", "true");
      const index = optionEls.findIndex((el) => optionValue(el) === (rootEl.getAttribute("data-value") || ""));
      highlight(index >= 0 ? index : 0);
      // 浮层是绝对定位，不占位，超出卡片的部分会被 body 的 overflow:hidden 裁掉。
      // 量一次它需要多少底部留白，写进 --di-combo-room，卡片靠 padding 的过渡长高，
      // 下面那些行一动不动。
      const panelRect = panelEl.getBoundingClientRect();
      const comboRect = rootEl.getBoundingClientRect();
      const needed = (comboRect.bottom - panelRect.top) + 4 + listH - panelEl.offsetHeight;
      panelEl.style.setProperty("--di-combo-room", `${Math.max(0, Math.ceil(needed) + 8)}px`);
      reportSize();
    }

    function closeList() {
      if (!popEl || !isOpen()) return;
      rootEl.classList.remove("is-open");
      popEl.setAttribute("aria-hidden", "true");
      // 收起动画跑完再恢复裁剪，否则关闭那一刻就被折叠区硬切掉，看起来又没有动画。
      clearTimeout(clipTimer);
      clipTimer = setTimeout(() => clipEl?.classList.remove("is-unclipped"), 220);
      fieldEl?.setAttribute("aria-expanded", "false");
      optionEls.forEach((el) => el.classList.remove("is-active"));
      activeIndex = -1;
      // 留白和浮层一起收，两边都是 180ms，看不出先后。
      panelEl.style.setProperty("--di-combo-room", "0px");
      reportSize();
    }

    // 只认列表里真实存在的值：后端将来多出一个档位时，不显示一个选不中的空项。
    function setValue(next) {
      const value = typeof next === "string" ? next : "";
      const picked = optionEls.find((el) => optionValue(el) === value);
      if (!picked) return;
      rootEl.setAttribute("data-value", value);
      if (valueEl) valueEl.textContent = (picked.textContent || "").trim();
      optionEls.forEach((el) => el.setAttribute("aria-selected", optionValue(el) === value ? "true" : "false"));
    }

    function pick(index) {
      const el = optionEls[index];
      if (!el) return;
      setValue(optionValue(el));
      closeList();
      fieldEl?.focus();
    }

    fieldEl?.addEventListener("click", () => {
      if (isOpen()) closeList(); else openList();
    });

    fieldEl?.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "Escape") {
        if (isOpen()) { event.preventDefault(); closeList(); }
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        if (!isOpen()) openList();
        else highlight(activeIndex + (key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        if (isOpen()) pick(activeIndex);
        else openList();
        return;
      }
      if (key === "Tab") closeList();
    });

    optionEls.forEach((el, index) => {
      el.addEventListener("click", () => pick(index));
      el.addEventListener("mouseenter", () => highlight(index));
    });

    // 点到外面就收：卡片里只有这一个浮层，不需要更复杂的关法。
    document.addEventListener("click", (event) => {
      if (isOpen() && !rootEl.contains(event.target)) closeList();
    });

    return {
      get value() { return rootEl.getAttribute("data-value") || ""; },
      set value(next) { setValue(next); },
      has: (value) => optionEls.some((el) => optionValue(el) === value),
    };
  }

  const backendCombo = createCombo(backendEl);

  // ── 作业与进度状态 ────────────────────────────────────────────────────
  /** 当前作业号。空串表示这次面板上没有在跑的作业。 */
  let jobId = "";
  /** 最近一次拿到的作业快照（getJob 的深拷贝）。 */
  let job = null;
  /** 进过终态（或记录失效）之后不再轮询、不再推进。 */
  let stopped = true;
  /** 发起请求在进行中：按钮禁用，连点不会起两个作业。 */
  let busy = false;
  let pollTimer = 0;
  let animId = 0;
  /** 上一次写进条子的百分比。收尾补满要从这个值接着跑，不能重新算。 */
  let lastPercent = 0;
  /** 收尾补满的接缝：起点、时长、开始时刻。null 表示没在补。 */
  let fillState = null;
  let pollFailures = 0;
  /** 结果区的行，按文件下标对齐；结构建一次就不再动。 */
  const rows = [];

  function syncTheme() {
    let snap = null;
    try { snap = hana?.theme?.getSnapshot?.() || null; } catch { snap = null; }
    const label = String(snap?.theme || "");
    let dark = snap?.appearance === "dark" || /dark|midnight|contrast|深|夜/i.test(label);
    if (!snap?.appearance && (!label || label === "inherit")) {
      // 宿主没给结论就现问系统；matchMedia 也可能不存在（预览页的怪环境），失败一律按浅色。
      try {
        dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      } catch { dark = false; }
    }
    document.body.classList.toggle("t-dark", dark);
  }

  // 两条都发：SDK 那条在部分挂载位生效，卡片中心实测只认 hana.card-resize。
  // 参数不传就量自己，量的是根节点（宽度固定、高度由内容定），不受宿主 iframe 高度影响，
  // 不会形成「报高 → 宿主改高 → 再量再报」的回环。
  function reportSize() {
    const height = Math.ceil(panelEl.offsetHeight || 0);
    if (!(height > 0)) return;
    try { hana?.ui?.resize?.({ height, width: PANEL_WIDTH }); } catch { /* 老宿主没有这路 */ }
    try { window.parent?.postMessage({ type: "hana.card-resize", height }, "*"); } catch { /* 同上 */ }
  }

  // 折叠区展开时卡片在 200ms 里逐帧长高，只报起点和终值会让宿主先跳到终值，看着更硬。
  // 观察根节点把这些帧全报出去，宿主高度就跟得上了。结果区逐行出现时同理。
  if (typeof ResizeObserver !== "undefined") {
    try {
      let reportedH = 0;
      new ResizeObserver(() => {
        const height = Math.ceil(panelEl.offsetHeight || 0);
        if (!(height > 0) || height === reportedH) return;
        reportedH = height;
        reportSize();
      }).observe(panelEl);
    } catch { /* 观察失败不影响主流程，还有那几次主动上报 */ }
  }

  // ── 折叠区 ────────────────────────────────────────────────────────────
  /** 只把撑开后的目标高度写进 CSS 变量，max-height 从这里读。 */
  function applyAdvHeight() {
    const height = Math.ceil(advInnerEl.getBoundingClientRect().height || 0);
    advBodyEl.style.setProperty("--di-adv-h", `${height}px`);
  }

  function setExpanded(next) {
    const want = !!next;
    if (want === expanded) return;
    expanded = want;
    advBodyEl.classList.toggle("is-open", expanded);
    advBodyEl.setAttribute("aria-hidden", expanded ? "false" : "true");
    advHeadEl?.setAttribute("aria-expanded", expanded ? "true" : "false");
    advChevronEl?.classList.toggle("is-open", expanded);
    applyAdvHeight();
    // 过渡跑完再兜一次：标签页不可见之类的原因会让过渡没跑满，尺寸可能停在半路。
    setTimeout(reportSize, FOLD_MS + 20);
  }

  // ── 提示行 ────────────────────────────────────────────────────────────
  /** 一张面板上只有这一处会说话。warn 用于需要人处理的那几句。 */
  function showHint(text, kind) {
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.classList.toggle("di-hint--warn", kind === "warn");
    hintEl.hidden = false;
    reportSize();
  }

  function clearHint() {
    if (!hintEl) return;
    hintEl.textContent = "";
    hintEl.classList.remove("di-hint--warn");
    hintEl.hidden = true;
  }

  // ── 默认值 ────────────────────────────────────────────────────────────
  function applyDefaults(defaults) {
    const savePath = typeof defaults?.savePath === "string" ? defaults.savePath.trim() : "";
    // 保存路径预填后端给的默认值；后端给空就留空，placeholder 已经在说留空的后果。
    if (savePathEl) savePathEl.value = savePath;

    const backend = typeof defaults?.defaultBackend === "string" ? defaults.defaultBackend.trim() : "";
    // 只认列表里真实存在的 value：后端将来多出一个档位时，面板不该显示一个选不中的空项。
    const known = backend && backendCombo?.has(backend);
    if (backendCombo) backendCombo.value = known ? backend : FALLBACK_DEFAULTS.defaultBackend;

    const language = typeof defaults?.language === "string" ? defaults.language.trim() : "";
    if (languageEl) languageEl.value = language || FALLBACK_DEFAULTS.language;

    // 勾选框只接受布尔：值类型不对时留在 HTML 里的初值（本来就等于 schema 默认）。
    if (includeMediaEl && typeof defaults?.includeMedia === "boolean") {
      includeMediaEl.checked = defaults.includeMedia;
    }
    if (saveJsonEl && typeof defaults?.saveJson === "boolean") {
      saveJsonEl.checked = defaults.saveJson;
    }
    // 页码范围不铺：它永远从空开始。
  }

  async function loadDefaults() {
    if (typeof hana?.api?.fetch !== "function") return;
    let body = null;
    try {
      const res = await hana.api.fetch("/panel-defaults");
      body = await res.json();
    } catch {
      body = null;
    }
    // 读不到就静默留着手上的默认值：面板是给人填表的地方，
    // 因为一次配置读取失败就先糊一屏红字，比默认值不对更碍事。
    if (!body || body.ok !== true || !body.defaults) return;
    applyDefaults(body.defaults);
  }

  // ── 选文件 / 选文件夹 ──────────────────────────────────────────────────
  /**
   * 弹一次宿主的选择框，把选中的路径并进「源」。
   * 用户取消时宿主回一个空列表（或空 payload），这里什么都不做、也不提示：
   * 取消不是错误，弹一句「没有选择文件」只是噪音。
   */
  async function pickSources(mode, button) {
    if (!hasPanelApi(hana)) return;
    const isDirectory = mode === "directory";
    const label = button ? button.textContent : "";
    if (button) {
      // 按钮禁用是防连点：系统对话框没关之前再点一次会叠出第二个框。
      button.disabled = true;
      button.textContent = "选择中…";
    }
    let picked = [];
    try {
      const res = await hana.resources.pick({ mode }, { timeoutMs: PICK_TIMEOUT_MS });
      const list = Array.isArray(res?.resources) ? res.resources : [];
      picked = list
        .map((item) => (typeof item?.path === "string" ? item.path.trim() : ""))
        .filter(Boolean)
        .map((path) => (isDirectory ? trimTrailingSeparator(path) : path))
        .filter(Boolean);
    } catch {
      // 超时、宿主不支持、权限被拒：都不弹窗。面板上没有对话框，也不该有。
      picked = [];
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
    if (!picked.length) return;
    sourcesEl.value = mergePathLines(sourcesEl.value, picked);
    // 粘到末尾就把滚动条推到底：追加的内容在下面，看不见等于没加。
    sourcesEl.scrollTop = sourcesEl.scrollHeight;
    reportSize();
  }

  async function pickSaveDir() {
    if (!hasPanelApi(hana)) return;
    const button = pickSaveEl;
    const label = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "选择中…";
    }
    let picked = "";
    try {
      const res = await hana.resources.pick({ mode: "directory" }, { timeoutMs: PICK_TIMEOUT_MS });
      const list = Array.isArray(res?.resources) ? res.resources : [];
      const first = list.find((item) => typeof item?.path === "string" && item.path.trim());
      picked = first ? trimTrailingSeparator(first.path) : "";
    } catch {
      picked = "";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
    // 用户取消时保留输入框里原来的值，不清空。
    if (!picked || !savePathEl) return;
    savePathEl.value = picked;
    reportSize();
  }

  // ── 结果区 ────────────────────────────────────────────────────────────
  /** 结果区的行按需建，建过就复用：每帧刷状态时不去碰 DOM 结构。 */
  function ensureRow(index) {
    while (rows.length <= index) {
      const el = document.createElement("div");
      el.className = "di-file";
      el.dataset.state = "pending";
      const name = document.createElement("span");
      name.className = "di-file__name";
      const state = document.createElement("span");
      state.className = "di-file__state";
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "di-mini di-file__reveal";
      reveal.textContent = "打开文件夹";
      reveal.hidden = true;
      const error = document.createElement("span");
      error.className = "di-file__error";
      error.hidden = true;
      el.append(name, state, reveal, error);
      filesEl.append(el);
      const row = { el, name, state, reveal, error };
      reveal.addEventListener("click", () => { void revealPath(row); });
      rows.push(row);
    }
    return rows[index];
  }

  /** 用 /run 回来的文件名先把行摆出来，状态从「排队」起。 */
  function seedRows(names) {
    names.forEach((name, index) => {
      const row = ensureRow(index);
      row.el.hidden = false;
      row.el.dataset.state = "pending";
      row.name.textContent = baseNameOf(name) || name || "未命名文件";
      row.name.title = name || "";
      row.state.textContent = FILE_STATE_TEXT.pending;
      row.error.hidden = true;
      row.error.textContent = "";
      row.reveal.hidden = true;
      delete row.reveal.dataset.path;
    });
    if (overallTextEl) overallTextEl.textContent = `0/${names.length} 完成`;
  }

  /**
   * 快照 → 每一行。
   * revealReady 表示已经进终态：「打开文件夹」只在有产物、且不会再变的时候才给。
   */
  function renderRows(snapshot, revealReady) {
    const files = Array.isArray(snapshot?.files) ? snapshot.files : [];
    files.forEach((file, index) => {
      const row = ensureRow(index);
      row.el.hidden = false;
      const status = Object.hasOwn(FILE_STATE_TEXT, file?.status) ? file.status : "pending";
      row.el.dataset.state = status;
      row.name.textContent = baseNameOf(file?.name) || baseNameOf(file?.source) || "未命名文件";
      row.name.title = file?.source || file?.name || "";
      row.state.textContent = FILE_STATE_TEXT[status];
      const errorText = status === "failed"
        ? (typeof file?.error === "string" && file.error.trim() ? file.error.trim() : "解析失败")
        : "";
      row.error.hidden = !errorText;
      row.error.textContent = errorText;
      const mdPath = typeof file?.mdPath === "string" ? file.mdPath : "";
      row.reveal.hidden = !(revealReady && mdPath);
      if (mdPath) row.reveal.dataset.path = mdPath;
      else delete row.reveal.dataset.path;
    });
    if (overallTextEl) {
      const done = files.filter((file) => file?.status === "done").length;
      overallTextEl.textContent = `${done}/${files.length} 完成`;
    }
  }

  /** 条子画到某个百分比。除了这里，没有别处写宽度。 */
  function paint(percent) {
    const value = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
    lastPercent = value;
    if (barFillEl) barFillEl.style.width = `${value.toFixed(2)}%`;
    if (overallPercentEl) overallPercentEl.textContent = `${value.toFixed(1)}%`;
  }

  function fallbackBackend() {
    return backendEl?.value || FALLBACK_DEFAULTS.defaultBackend;
  }

  /**
   * 每帧推进一次条子。
   * 总进度是「已经跑了多久」的函数，本地就能连续算；轮询只负责作业状态与各文件起点。
   * 收尾补满时切成一条 easeOutCubic：起步快、收尾慢，和「跑完了」这个事件的节奏一致。
   */
  function frame() {
    animId = requestAnimationFrame(frame);
    if (fillState) {
      const elapsed = Date.now() - fillState.startedAt;
      const t = fillState.ms > 0 ? Math.min(1, Math.max(0, elapsed / fillState.ms)) : 1;
      const eased = 1 - (1 - t) ** 3;
      paint(fillState.from + (100 - fillState.from) * eased);
      if (t >= 1) {
        fillState = null;
        stopAnimation();
        paint(100);
      }
      return;
    }
    if (job) paint(overallPercentOf(job, Date.now(), fallbackBackend()));
  }

  function startAnimation() {
    if (animId) return;
    animId = requestAnimationFrame(frame);
  }

  function stopAnimation() {
    if (!animId) return;
    cancelAnimationFrame(animId);
    animId = 0;
  }

  // ── 轮询 ──────────────────────────────────────────────────────────────
  // 用 setTimeout 串下一次，不用 setInterval：一个作业只有一条链，
  // 隐藏页面时能干净地掐掉，切回来也不会留下一串还在跑的空转。
  function clearPoll() {
    if (!pollTimer) return;
    clearTimeout(pollTimer);
    pollTimer = 0;
  }

  function schedulePoll() {
    clearPoll();
    if (stopped || !jobId) return;
    if (document.visibilityState === "hidden") return;
    pollTimer = setTimeout(() => { void tick(); }, POLL_MS);
  }

  async function tick() {
    pollTimer = 0;
    if (stopped || !jobId) return;
    let data = null;
    let threw = false;
    try {
      const res = await hana.api.fetch(`/job-status?id=${encodeURIComponent(jobId)}`);
      data = await res.json();
    } catch {
      threw = true;
      data = null;
    }
    if (stopped) return;

    if (threw) {
      // 单次失败不终止：网络抖一下就让面板停在半路，比慢一点更糟。
      pollFailures += 1;
      if (pollFailures >= MAX_POLL_FAILURES) {
        failResult("与解析任务的连接已断开");
        return;
      }
      schedulePoll();
      return;
    }
    pollFailures = 0;
    // 后端明确说查不到（进程重启、过了保留期）：这是结论，不是抖动，不再等。
    if (!data || data.ok !== true || !data.job) {
      failResult("解析记录已失效");
      return;
    }

    job = data.job;
    renderRows(job, false);
    if (job.state === "done" || job.state === "failed") {
      finalize(job);
      return;
    }
    reportSize();
    schedulePoll();
  }

  /** 记录没了、通道断了：停在原地，按钮还给人，一句话说清楚。 */
  function failResult(text) {
    stopped = true;
    clearPoll();
    stopAnimation();
    setBusy(false);
    if (deliverRowEl) deliverRowEl.hidden = true;
    if (summaryEl) {
      summaryEl.textContent = text;
      summaryEl.classList.add("di-summary--warn");
      summaryEl.hidden = false;
    }
    reportSize();
  }

  /** 终态：停轮询，画结论，成功就把条子补满。 */
  function finalize(snapshot) {
    stopped = true;
    clearPoll();
    renderRows(snapshot, true);
    setBusy(false);
    resultEl.dataset.state = snapshot.state === "done" ? "done" : "failed";
    const total = Array.isArray(snapshot.files) ? snapshot.files.length : 0;
    const success = (snapshot.files || []).filter((file) => file?.status === "done").length;
    if (summaryEl) {
      summaryEl.textContent = `成功 ${success}/${total}`;
      summaryEl.classList.toggle("di-summary--warn", snapshot.state !== "done");
      summaryEl.hidden = false;
    }
    // 一个都没成就不给投递：把一句「成功 0/2」送进对话没有任何用处。
    if (deliverRowEl) deliverRowEl.hidden = !(success > 0);
    if (snapshot.state === "done") {
      // 从这里接着跑到 100，而不是重新算：终态快照里所有文件都已结束，
      // 重算会直接得到 100，条子就是一帧跳满。
      const remaining = Math.max(0, 100 - lastPercent);
      if (remaining <= 0.5) {
        stopAnimation();
        paint(100);
      } else {
        const ms = Math.round(Math.min(FILL_MAX_MS, Math.max(FILL_MIN_MS, remaining * FILL_MS_PER_PERCENT)));
        fillState = { from: lastPercent, ms, startedAt: Date.now() };
        startAnimation();
      }
    } else {
      // 失败：条子停在原地（并换成 warn 色），不给「快好了」的暗示。
      stopAnimation();
    }
    reportSize();
  }

  /** 在系统文件管理器里定位到那个产物。真正动手的是 App 进程。 */
  async function revealPath(row) {
    const path = row?.reveal?.dataset.path || "";
    if (!path) return;
    row.reveal.disabled = true;
    try {
      const res = await hana.api.fetch("/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) {
        showHint(data?.error || "打开文件夹失败", "warn");
        return;
      }
      clearHint();
    } catch {
      showHint("打开文件夹失败：连接不上应用进程", "warn");
    } finally {
      row.reveal.disabled = false;
    }
  }

  // ── 投递到对话（待实测的一条路） ────────────────────────────────────
  //
  // 宿主给卡片留了一条把用户操作送回对话的通道 hana.emit(事件名, 数据包)。
  // 能不能真的送达取决于两件在这里读不死的事：
  //   1) App 有没有被授予 app/session.start-turn（默认关）；
  //   2) 这张卡所在的挂载位是按「点击那一刻聚焦的对话」自动路由，还是要求调用方
  //      显式指定目标对话 —— 两种宿主的实现都有。
  // 所以这一块只负责：把按钮做对、把失败原因翻成人话、把宿主原话原封不动留在页面上。
  // 本工单没有验证过它真的能送达；不要把下面任何一句文案当成「已经支持」。

  /** 提示行只说一句话。tone: "ok" | "warn" | ""。 */
  function setEmitNote(text, tone) {
    if (!deliverNoteEl) return;
    deliverNoteEl.textContent = text;
    if (tone) deliverNoteEl.dataset.tone = tone;
    else delete deliverNoteEl.dataset.tone;
    reportSize();
  }

  /**
   * 失败原文 → 一句人话。
   * 三句话按「先授权、再会话、最后原样」排：权限欠缺是全局问题，
   * 会话欠缺只在某些挂载位发生，剩下的一律把宿主原话抬出来。
   * 匹配用 code + message 合起来搜：宿主有时把结论放在 code 里，message 只剩一句话。
   */
  function describeEmitFailure(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    const message = typeof error?.message === "string" ? error.message : String(error ?? "");
    const text = `${code} ${message}`;
    if (/start-turn|unauthorized|permission|授权/i.test(text)) {
      return "还没授权：打开 设置 → 应用 → 文档提取，把「可以在对话里起一轮」打开";
    }
    if (/no conversation|SESSION_REQUIRED|executionSessionId|cardInstanceId|no route/i.test(text)) {
      return "这里没有可以投递的对话，回到对话界面再点一次";
    }
    return `投递失败：${message || "宿主没有给出原因"}`;
  }

  /** 把原始错误或成功结果序列化成一行可读的 JSON，放进 title 供外部诊断读。 */
  function toDiagnosticJson(value) {
    try {
      const text = JSON.stringify(value ?? null);
      if (typeof text === "string") return text;
    } catch { /* 环形引用之类，下面的兜底接住 */ }
    try { return JSON.stringify({ code: value?.code ?? null, message: String(value?.message ?? value) }); } catch { return "{}"; }
  }

  async function deliver() {
    if (!job || !deliverBtnEl) return;
    // 宿主是否提供 emit 本身就是变量（老版本没有），拿不到也要说清楚。
    if (typeof hana?.emit !== "function") {
      if (deliverNoteEl) {
        deliverNoteEl.dataset.emit = "unavailable";
        deliverNoteEl.title = JSON.stringify({ ok: false, reason: "hana.emit 不可用" });
      }
      setEmitNote("这个宿主版本没有投递通道", "warn");
      return;
    }

    deliverBtnEl.disabled = true;
    const payload = buildDeliverPayload(job);
    try {
      // 只传两个参数：第三个参数是「显式指定目标对话」，这张卡不替用户做这个决定。
      // 手势也不伪造 —— 宿主要求真点击，SDK 自己去采。
      const result = await hana.emit(EMIT_EVENT, payload);
      if (deliverNoteEl) {
        deliverNoteEl.dataset.emit = "ok";
        deliverNoteEl.title = toDiagnosticJson({ ok: true, result: result ?? null });
      }
      setEmitNote("已投递到当前对话", "ok");
      // 按钮改成已投，直到下一次开始提取才复位（resetResult 里改回去）。
      deliverBtnEl.textContent = "已投递";
    } catch (error) {
      // 三条证据都留：一行人话给人看，一个属性给外部程序读，一份原对象给控制台。
      const code = typeof error?.code === "string" ? error.code : "";
      if (deliverNoteEl) {
        deliverNoteEl.dataset.emit = code || "error";
        deliverNoteEl.title = toDiagnosticJson(error);
      }
      console.warn("[panel] emit 失败", error);
      setEmitNote(describeEmitFailure(error), "warn");
      // 失败后按钮保持可用：用户可以改了设置再点一次。
      deliverBtnEl.disabled = false;
    }
  }

  // ── 发起一次提取 ──────────────────────────────────────────────────────
  function setBusy(next) {
    busy = !!next;
    if (!runEl) return;
    runEl.disabled = busy;
    runEl.textContent = busy ? "解析中…" : "开始提取";
  }

  /** 清掉上一次的残留：行、结论、条子、作业号、定时器。新一次从白纸开始。 */
  function resetResult() {
    stopped = true;
    clearPoll();
    stopAnimation();
    jobId = "";
    job = null;
    fillState = null;
    pollFailures = 0;
    rows.forEach((row) => row.el.remove());
    rows.length = 0;
    paint(0);
    if (overallTextEl) overallTextEl.textContent = "";
    if (summaryEl) {
      summaryEl.textContent = "";
      summaryEl.classList.remove("di-summary--warn");
      summaryEl.hidden = true;
    }
    // 投递区跟着结果区一起复位：按钮文案、提示行、诊断属性全回到初始。
    if (deliverRowEl) deliverRowEl.hidden = true;
    if (deliverBtnEl) {
      deliverBtnEl.disabled = false;
      deliverBtnEl.textContent = "投递到对话";
    }
    if (deliverNoteEl) {
      deliverNoteEl.textContent = "";
      delete deliverNoteEl.dataset.tone;
      delete deliverNoteEl.dataset.emit;
      deliverNoteEl.removeAttribute("title");
    }
    resultEl.hidden = true;
    delete resultEl.dataset.state;
  }

  async function startRun() {
    if (busy) return;
    if (typeof hana?.api?.fetch !== "function") {
      showHint("应用接口不可用，现在发不了解析请求", "warn");
      return;
    }
    const sources = sourcesEl.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!sources.length) {
      showHint("先选文件或填一个路径，空白发起没有意义", "warn");
      return;
    }

    // 提示行与结果区成套清：不能上一轮的结论还挂在新一次请求下面。
    clearHint();
    resetResult();
    setBusy(true);

    const payload = {
      sources,
      outputDir: savePathEl?.value.trim() || "",
      backend: backendCombo?.value || FALLBACK_DEFAULTS.defaultBackend,
      pageRange: pageRangeEl?.value.trim() || "",
      language: languageEl?.value.trim() || "",
      includeMedia: includeMediaEl?.checked === true,
      saveJson: saveJsonEl?.checked === true,
    };

    let data = null;
    try {
      const res = await hana.api.fetch("/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json();
    } catch {
      data = null;
    }

    if (!data) {
      setBusy(false);
      showHint("发起解析失败：连接不上应用进程", "warn");
      return;
    }
    if (data.ok !== true) {
      setBusy(false);
      // 后端已经把那几句话写成人话了，原样显示，不自己再编一句。
      showHint(data.error || "发起解析失败", "warn");
      return;
    }
    if (typeof data.jobId !== "string" || !data.jobId) {
      setBusy(false);
      showHint("发起解析失败：没有拿到作业号", "warn");
      return;
    }

    jobId = data.jobId;
    stopped = false;
    job = null;
    lastPercent = 0;
    pollFailures = 0;
    const names = Array.isArray(data.files) ? data.files : [];
    seedRows(names);
    resultEl.hidden = false;
    resultEl.dataset.state = "running";
    paint(0);
    startAnimation();
    reportSize();
    await tick();
  }

  // ── 绑事件 ────────────────────────────────────────────────────────────
  // 只绑一次。这些节点一直在 DOM 里，不随渲染重建；绑两次就会连着触发两次。
  let bound = false;

  function bindOnce() {
    if (bound) return;
    bound = true;

    advHeadEl?.addEventListener("click", () => setExpanded(!expanded));

    pickFileEl?.addEventListener("click", () => { void pickSources("file", pickFileEl); });
    pickDirEl?.addEventListener("click", () => { void pickSources("directory", pickDirEl); });
    pickSaveEl?.addEventListener("click", () => { void pickSaveDir(); });

    runEl?.addEventListener("click", () => { void startRun(); });
    // 投递按钮：只在真点击下才会走到这里，手势由 SDK 自己采。
    deliverBtnEl?.addEventListener("click", () => { void deliver(); });

    // 页面藏起来就停轮询（刷出来的画面没人看），回来立刻补一次，
    // 不然切回来会先看到一秒前的旧状态。
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearPoll();
        return;
      }
      if (jobId && !stopped) void tick();
    });

    if (typeof ResizeObserver !== "undefined") {
      try {
        new ResizeObserver(() => { if (expanded) applyAdvHeight(); }).observe(advInnerEl);
      } catch { /* 观察不到就只在展开时量一次，控件高度是固定的，够用 */ }
    }
  }

  // ── 主题 ────────────────────────────────────────────────────────────
  // 取色全部交给 ui/theme-bridge.js：它把宿主的主题样式表插进来，按备选链取出
  // 强调色与正文色，写成 --ui-* 一套变量（panel.css 再把它们翻成 --di-*）。
  // 这里只负责拿到桥的结果后切深浅档、重新报高。
  async function ensureTheme() {
    try {
      const bridge = installThemeBridge({
        hana,
        onApply: (palette) => {
          document.body.classList.toggle("t-dark", palette.theme === "dark");
          reportSize();
        },
      });
      await bridge.ready;
    } catch { /* 桥没装上就靠 panel.css 的兜底，界面照常能用 */ }
  }

  (async () => {
    hana = await resolveHana().catch(() => null);
    // 宿主接口拿不到也照样把界面画出来：表单是给人填的，主题与默认值只是加分项。
    syncTheme();
    try { hana?.theme?.subscribe?.(() => syncTheme()); } catch { /* 订阅不可用就只保留首帧 */ }
    bindOnce();
    // 先把 FALLBACK_DEFAULTS 铺上，再拉后端值覆盖：fetch 回来之前表单就不是空的。
    applyDefaults(FALLBACK_DEFAULTS);
    reportSize();
    await loadDefaults();
    reportSize();
    // 握手放在最后：这一步只是告诉宿主「页面能用了」，前面的渲染一步都不用等它。
    try { hana?.ready?.(); } catch { /* 老宿主没有这一步 */ }
    await ensureTheme();
  })();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPanel, { once: true });
  } else {
    startPanel();
  }
}
