// ui/panel.js — 文档提取面板卡
//
// 这张卡只做界面：选文件、定目录、把设置里的默认值铺到表单上。
// 点「开始提取」暂时只给一行提示 —— 真正把文件送进解析作业是下一张工单的事，
// 所以本文件里没有任何提取请求。唯一的出宿主动作是 hana.resources.pick
// （用户自己按下按钮才弹系统对话框）和一次 GET /panel-defaults（只读配置）。

const PANEL_WIDTH = 460;
/** 折叠区过渡时长，与 panel.css 里的 200ms 对齐；过渡跑完再兜一次上报。 */
const FOLD_MS = 200;
/** 用户可能停在系统文件对话框里很久，超时给足 10 分钟，别半路把选择收走。 */
const PICK_TIMEOUT_MS = 600000;

/**
 * 后端默认值回来之前，表单先按设置 schema 的默认值站着（manifest 里的 default）。
 * 这样即使 /panel-defaults 失败，看到的是「和设置一致的默认」，而不是一片空框。
 * 语言不在这份表里：它也跟着 schema 默认的 zh。
 */
const FALLBACK_DEFAULTS = {
  savePath: "",
  defaultBackend: "auto",
  language: "zh",
  includeMedia: true,
  saveJson: false,
};

// ── 纯函数：路径处理 ──────────────────────────────────────────────────────
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
  const runHintEl = document.getElementById("di-run-hint");
  const advHeadEl = document.getElementById("di-adv-toggle");
  const advChevronEl = document.getElementById("di-adv-chevron");
  const advBodyEl = document.getElementById("di-adv-body");
  const advInnerEl = document.getElementById("di-adv-inner");
  const backendEl = document.getElementById("di-backend");
  const languageEl = document.getElementById("di-language");
  const includeMediaEl = document.getElementById("di-include-media");
  const saveJsonEl = document.getElementById("di-save-json");

  if (!panelEl || !sourcesEl || !advBodyEl || !advInnerEl) return;

  let hana = null;
  let expanded = false;

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

  // 折叠区展开时卡片在 200ms 里逐帧长高，只报起点和终值的话宿主会先跳到终值，看着更硬。
  // 观察根节点把这些帧全报出去，宿主高度就跟得上了。
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

  // ── 默认值 ────────────────────────────────────────────────────────────
  function applyDefaults(defaults) {
    const savePath = typeof defaults?.savePath === "string" ? defaults.savePath.trim() : "";
    // 保存路径预填后端给的默认值；后端给空就留空，placeholder 已经在说留空的后果。
    if (savePathEl) savePathEl.value = savePath;

    const backend = typeof defaults?.defaultBackend === "string" ? defaults.defaultBackend.trim() : "";
    // 只认下拉里真实存在的 value：后端将来多出一个档位时，面板不该静默地显示成「自动」，
    // 但也不该显示一个选不中的空项，所以两个都不满意时就退回 schema 默认。
    const known = backend && Array.from(backendEl?.options || []).some((option) => option.value === backend);
    if (backendEl) backendEl.value = known ? backend : FALLBACK_DEFAULTS.defaultBackend;

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
  async function pickSources(mode, idleButton) {
    if (!hasPanelApi(hana)) return;
    const isDirectory = mode === "directory";
    const button = idleButton;
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

    // 本工单不干活：只把「还没接通」这句话露出来。不弹窗、不发请求。
    runEl?.addEventListener("click", () => {
      if (runHintEl) runHintEl.hidden = false;
      reportSize();
    });

    // 高级选项里改了内容不影响折叠区高度（控件高度固定），但这个监听留着没有代价，
    // 等下一工单往里加会变高的内容时不用再想起来补。
    if (typeof ResizeObserver !== "undefined") {
      try {
        new ResizeObserver(() => { if (expanded) applyAdvHeight(); }).observe(advInnerEl);
      } catch { /* 观察不到就只在展开时量一次，控件高度是固定的，够用 */ }
    }
  }

  (async () => {
    hana = await resolveHana().catch(() => null);
    // 宿主接口拿不到也照样把界面画出来：表单是给人填的，主题与默认值只是加分项。
    // 所以这里不提前 return。
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
  })();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPanel, { once: true });
  } else {
    startPanel();
  }
}
