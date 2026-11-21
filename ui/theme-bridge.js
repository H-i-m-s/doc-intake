// ui/theme-bridge.js — 把宿主主题搬进页面：当前配色 + 可选的主题目录。
//
// 通用件：不 import 任何项目代码，拷到别的 App 里改一行 import 就能用。
//
// ── 为什么需要它 ──────────────────────────────────────────────────────
// 1. 宿主给卡片页面的主题样式表，官方 SDK 的做法是「先 fetch 再内联成 <style>」。
//    在卡片这类挂载位里那一步常常不成立，页面里 --hana-* 全是空，颜色一路掉进兜底。
// 2. 主题表里真正定义的名字大多无前缀：--accent / --text / --bg-card / --border，
//    --hana-* 只有聊天正文那一个（--hana-text）。只认前缀，换主题就认不出强调色。
// 3. 想给用户一个主题选择器时，宿主没有「列出所有主题」的接口；能拿到的只有
//    「某一主题 id 对应的样式表」。所以这里提供 paletteOf(id) 去读任意主题的色板，
//    listThemes() 只能做到「自定义主题接口 + 调用方给的 id + 当前生效的那个」。
//
// ── 怎么用 ────────────────────────────────────────────────────────────
//   import { installThemeBridge } from "./theme-bridge.js";
//   const bridge = installThemeBridge({ hana });   // hana 是 SDK 导出的对象
//   await bridge.ready;                            // 首次配色落地
//   页面里直接用：var(--ui-text) / var(--ui-surface) / var(--ui-accent) …
//
//   要列主题（可选）：
//   const list = await bridge.listThemes({ ids: ["midnight", "coral"] });
//   const palette = await bridge.paletteOf("coral");   // { name, accent, text… }
//
//   要接别的色源（自己的品牌色、另一个 App 的皮肤）：
//   installThemeBridge({ hana, providers: [async () => ({ accent: "#C99AAF" })] })
//   provider 返回的角色盖过宿主，返回 null 表示这次没有意见。
//
// 写出的变量（都带 --ui- 前缀）：
//   bg / bg-alt / surface / surface-alt / border / text / text-soft / text-muted /
//   content / secondary / accent / accent-hover / accent-soft / link / link-hover /
//   ok / warn / coral / shadow / overlay / font / mono / on-accent
// 另在根节点写 data-ui-theme="dark|light"。
//
// 只操作 DOM，不写宿主存储，不自己 apply 主题；出错一律静默降级。

const LINK_ID = "hanako-theme-stylesheet";

/** 角色 → 候选变量名。顺序就是优先级：先宿主前缀，再主题表真名。 */
const ROLE_SOURCES = {
  bg: ["--hana-bg", "--bg"],
  bgAlt: ["--hana-bg-glass", "--bg-glass"],
  surface: ["--hana-bg-card", "--bg-card"],
  surfaceAlt: ["--hana-sidebar-bg", "--sidebar-bg"],
  border: ["--hana-border", "--border"],
  text: ["--hana-text", "--content-chat-ink", "--text"],
  textSoft: ["--hana-text-light", "--content-secondary-ink", "--text-light"],
  textMuted: ["--hana-text-muted", "--text-muted"],
  content: ["--content-chat-ink", "--text"],
  secondary: ["--content-secondary-ink", "--text-light"],
  accent: ["--hana-accent", "--accent"],
  accentHover: ["--hana-accent-hover", "--accent-hover"],
  accentSoft: ["--hana-accent-light", "--accent-light"],
  link: ["--hana-link", "--link"],
  linkHover: ["--hana-link-hover", "--link-hover"],
  ok: ["--hana-green", "--green"],
  warn: ["--hana-danger", "--danger"],
  coral: ["--hana-coral", "--coral"],
  shadow: ["--hana-shadow", "--shadow"],
  overlay: ["--hana-overlay", "--overlay-medium"],
  font: ["--hana-font-ui", "--font-ui"],
  mono: ["--hana-font-mono", "--font-mono"],
};

const ROLE_NAMES = Object.keys(ROLE_SOURCES);

/** 宿主什么都没给时的中性兜底：深色近白、浅色近黑，不用暖色。 */
const NEUTRAL = {
  dark: {
    bg: "#232c33", bgAlt: "rgba(35, 44, 51, 0.92)", surface: "#2a343c", surfaceAlt: "#1e262c",
    border: "rgba(255, 255, 255, 0.12)", text: "#f2f4f7", textSoft: "#c3cad3", textMuted: "#919aa4",
    content: "#f2f4f7", secondary: "#c3cad3", accent: "#8b9bb0", accentHover: "#9dabbe",
    accentSoft: "rgba(139, 155, 176, 0.16)", link: "#8ab4d8", linkHover: "#a6c8e4",
    ok: "#6e9c7f", warn: "#c07d72", coral: "#c9958a", shadow: "rgba(0, 0, 0, 0.45)",
    overlay: "rgba(255, 255, 255, 0.08)", font: "", mono: "",
  },
  light: {
    bg: "#f7f8fa", bgAlt: "rgba(247, 248, 250, 0.92)", surface: "#ffffff", surfaceAlt: "#eef1f4",
    border: "rgba(0, 0, 0, 0.12)", text: "#1f2226", textSoft: "#4d545c", textMuted: "#78818b",
    content: "#1f2226", secondary: "#4d545c", accent: "#5b7089", accentHover: "#6b82a0",
    accentSoft: "rgba(91, 112, 137, 0.12)", link: "#3d6fa5", linkHover: "#2f5a8a",
    ok: "#4f8a63", warn: "#b06a5e", coral: "#c08a7e", shadow: "rgba(0, 0, 0, 0.18)",
    overlay: "rgba(0, 0, 0, 0.06)", font: "", mono: "",
  },
};

/** --ui-text-soft 这样的变量名。 */
function cssName(role) {
  return `--ui-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** 亮度 0..1，用来判断压在强调色上的字该黑还是该白。 */
function luminance(value) {
  const raw = String(value || "").trim();
  let r = 0;
  let g = 0;
  let b = 0;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const text = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    r = parseInt(text.slice(0, 2), 16);
    g = parseInt(text.slice(2, 4), 16);
    b = parseInt(text.slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(raw);
    if (!rgb) return null;
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const channel = (n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 白字和黑字哪个对比度高就用哪个，比拍亮度阈值可靠。 */
function onColor(color, fallback = "#ffffff") {
  const lum = luminance(color);
  if (lum === null) return fallback;
  const vsWhite = 1.05 / (lum + 0.05);
  const vsBlack = (lum + 0.05) / 0.05;
  return vsBlack >= vsWhite ? "#14181c" : "#ffffff";
}

function readVar(style, names) {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return "";
}

/** 主题样式表开头的注释里有名字与一句描述，列表里用得上。 */
function parseThemeHeader(css) {
  const header = /^\s*\/\*([\s\S]*?)\*\//.exec(String(css || ""));
  if (!header) return { name: "", description: "" };
  const lines = header[1].split(/\r?\n/).map((line) => line.replace(/^\s*\*?\s?/, "").trim()).filter(Boolean);
  const nameLine = lines.find((line) => /Hana Theme/i.test(line)) || "";
  const name = nameLine.replace(/^.*?Hana Theme\s*[:：]\s*/i, "").trim();
  const description = lines.find((line) => line && line !== nameLine) || "";
  return { name, description };
}

/** 从一段主题 CSS 文本里抠出所有角色。 */
function paletteFromCss(css) {
  const out = {};
  for (const role of ROLE_NAMES) {
    out[role] = "";
    for (const name of ROLE_SOURCES[role]) {
      const hit = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;}]+)`).exec(css);
      if (hit && hit[1].trim()) { out[role] = hit[1].trim(); break; }
    }
  }
  return out;
}

/**
 * 装上主题桥。
 * options.hana       SDK 导出的 hana（可选；不给就只按 URL 参数与系统偏好）
 * options.providers  追加色源：async () => ({ accent: "#…" }) | null
 * options.fallback   调用方自己的最终兜底（角色名同 ROLE_SOURCES）
 * options.onApply    (palette) => void，配色落地后回调
 */
export function installThemeBridge(options = {}) {
  const doc = options.doc || (typeof document !== "undefined" ? document : null);
  const win = options.win || (typeof window !== "undefined" ? window : null);
  if (!doc || !win) {
    return {
      ready: Promise.resolve(null), refresh: async () => null, getPalette: () => null,
      paletteOf: async () => null, listThemes: async () => [], destroy() {},
    };
  }

  const hana = options.hana || null;
  const root = options.root || doc.body || doc.documentElement;
  const providers = Array.isArray(options.providers) ? options.providers.filter((fn) => typeof fn === "function") : [];
  const onApply = typeof options.onApply === "function" ? options.onApply : null;
  const base = options.fallback && typeof options.fallback === "object" ? options.fallback : null;

  let applied = null;
  let unsubscribe = null;
  let disposed = false;
  const paletteCache = new Map();

  function activeThemeUrl() {
    let url = "";
    try { url = String(hana?.theme?.getSnapshot?.()?.cssUrl || "").trim(); } catch { url = ""; }
    if (url) return url;
    try {
      return String(new URLSearchParams(win.location?.search || "").get("hana-css") || "").trim();
    } catch { return ""; }
  }

  function activeThemeId() {
    try { return String(hana?.theme?.getSnapshot?.()?.theme || "").trim(); } catch { return ""; }
  }

  /** 主题 id → 样式表地址。宿主给的地址就是这个形状，换掉 theme 参数即可。 */
  function urlForTheme(id) {
    const baseUrl = activeThemeUrl();
    if (!baseUrl) return "";
    try {
      const url = new URL(baseUrl, win.location?.href || "http://localhost/");
      url.searchParams.set("theme", String(id || ""));
      return url.toString();
    } catch { return ""; }
  }

  /** 把当前生效的主题表插进页面（重复调用不会插第二张）。 */
  function ensureStylesheet(url) {
    if (!url) return Promise.resolve(false);
    const existing = doc.getElementById(LINK_ID);
    if (existing) {
      if (existing.dataset.loaded === "1") return Promise.resolve(true);
      return new Promise((done) => {
        const finish = (ok) => { existing.dataset.loaded = ok ? "1" : "0"; done(ok); };
        existing.addEventListener("load", () => finish(true), { once: true });
        existing.addEventListener("error", () => finish(false), { once: true });
        setTimeout(() => finish(existing.dataset.loaded === "1"), 800);
      });
    }
    return new Promise((done) => {
      const link = doc.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      link.href = url;
      const finish = (ok) => { link.dataset.loaded = ok ? "1" : "0"; done(ok); };
      link.addEventListener("load", () => finish(true), { once: true });
      link.addEventListener("error", () => finish(false), { once: true });
      (doc.head || doc.documentElement)?.appendChild(link);
      setTimeout(() => finish(link.dataset.loaded === "1"), 800);
    });
  }

  function appearanceOf(vars) {
    let snapshot = null;
    try { snapshot = hana?.theme?.getSnapshot?.() || null; } catch { snapshot = null; }
    const declared = String(snapshot?.appearance || "").toLowerCase();
    if (declared === "dark" || declared === "light") return declared;
    const lum = luminance(vars.text);
    if (lum !== null) return lum > 0.5 ? "dark" : "light";
    let systemDark = false;
    try { systemDark = !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches); } catch { systemDark = false; }
    return systemDark ? "dark" : "light";
  }

  function paletteFromDom(appearance) {
    const style = win.getComputedStyle(root);
    const host = {};
    for (const role of ROLE_NAMES) host[role] = readVar(style, ROLE_SOURCES[role]);
    const neutral = NEUTRAL[appearance] || NEUTRAL.light;
    const out = { theme: appearance };
    for (const role of ROLE_NAMES) {
      out[role] = host[role] || (base && typeof base[role] === "string" && base[role]) || neutral[role] || "";
    }
    return out;
  }

  function write(palette) {
    if (!root?.style) return;
    for (const role of ROLE_NAMES) {
      const value = palette[role];
      if (!value) continue;
      root.style.setProperty(cssName(role), value);
    }
    root.style.setProperty("--ui-on-accent", onColor(palette.accent));
    root.setAttribute("data-ui-theme", palette.theme);
  }

  async function refresh() {
    if (disposed || !root) return applied;
    const appearance = appearanceOf({});
    const loaded = await ensureStylesheet(activeThemeUrl());

    let palette = paletteFromDom(appearance);
    const again = appearanceOf(palette);
    if (again !== palette.theme) palette = paletteFromDom(again);

    for (const provider of providers) {
      let extra = null;
      try { extra = await provider(); } catch { extra = null; }
      if (!extra || typeof extra !== "object") continue;
      for (const role of ROLE_NAMES) {
        if (typeof extra[role] === "string" && extra[role]) palette[role] = extra[role];
      }
      if (extra.theme === "dark" || extra.theme === "light") palette.theme = extra.theme;
    }

    palette.stylesheet = loaded ? "loaded" : activeThemeUrl() ? "failed" : "missing";
    palette.id = palette.id || activeThemeId();
    write(palette);
    applied = palette;
    try { onApply?.(palette); } catch { /* 回调是调用方的代码 */ }
    return applied;
  }

  /**
   * 读任意一个主题的色板。
   * 先试 fetch（拿得到名字与描述），失败就把那张表塞进一个隐藏的同源 iframe 里量，
   * 量完即拆。两种都不想动当前页面。
   */
  async function paletteOf(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    if (paletteCache.has(key)) return paletteCache.get(key);
    const url = urlForTheme(key);
    if (!url) return null;

    let palette = null;
    try {
      const res = await win.fetch(url, { credentials: "same-origin" });
      if (res?.ok) {
        const css = await res.text();
        const header = parseThemeHeader(css);
        const vars = paletteFromCss(css);
        const appearance = /appearance\s*:\s*dark/i.test(css) ? "dark" : "light";
        const neutral = NEUTRAL[appearance];
        palette = { id: key, name: header.name || key, description: header.description || "", theme: appearance };
        for (const role of ROLE_NAMES) palette[role] = vars[role] || neutral[role] || "";
      }
    } catch { palette = null; }

    if (!palette) {
      // fetch 被 CSP 拦住时的退路：同源 iframe 里放那张表，读它的计算值。
      palette = await new Promise((done) => {
        let frame = null;
        try {
          frame = doc.createElement("iframe");
          frame.setAttribute("aria-hidden", "true");
          frame.style.cssText = "position:fixed;left:-9999px;width:0;height:0;border:0;visibility:hidden";
          frame.src = "about:blank";
          (doc.body || doc.documentElement).appendChild(frame);
          const fdoc = frame.contentDocument;
          const link = fdoc.createElement("link");
          link.rel = "stylesheet";
          link.href = url;
          const finish = (ok) => {
            let out = null;
            if (ok) {
              try {
                const style = frame.contentWindow.getComputedStyle(fdoc.documentElement);
                const vars = {};
                for (const role of ROLE_NAMES) vars[role] = readVar(style, ROLE_SOURCES[role]);
                const theme = appearanceOf(vars);
                const neutral = NEUTRAL[theme];
                out = { id: key, name: key, description: "", theme };
                for (const role of ROLE_NAMES) out[role] = vars[role] || neutral[role] || "";
              } catch { out = null; }
            }
            try { frame.remove(); } catch { /* 拆不掉就留着，隐藏的不影响页面 */ }
            done(out);
          };
          link.addEventListener("load", () => finish(true), { once: true });
          link.addEventListener("error", () => finish(false), { once: true });
          fdoc.head.appendChild(link);
          setTimeout(() => finish(true), 900);
        } catch {
          try { frame?.remove(); } catch { /* 忽略 */ }
          done(null);
        }
      });
    }

    if (palette) paletteCache.set(key, palette);
    return palette;
  }

  /**
   * 能列出的主题（尽力而为）。
   * 宿主没有「列出全部主题」的接口，所以这里只有三类来源：
   *   1. 用户自定义/已安装主题（SDK 有 themes.custom.list 时）；
   *   2. 调用方自己给的 id 列表（options.ids 或参数 ids）；
   *   3. 当前生效的那个。
   * 每一项都会补上 name（能读到样式表时从表头注释里取）。
   */
  async function listThemes(input = {}) {
    const ids = new Set();
    const custom = [];
    try {
      const api = hana?.themes?.custom;
      if (api && typeof api.list === "function") {
        const rows = await api.list();
        for (const row of Array.isArray(rows) ? rows : []) {
          const id = String(row?.id || "").trim();
          if (!id) continue;
          ids.add(id);
          custom.push({ id, name: String(row?.name || id) });
        }
      }
    } catch { /* 没这个 API 或没授权，就当没有自定义主题 */ }

    const knownFromOptions = Array.isArray(options.ids) ? options.ids : [];
    const knownFromCall = Array.isArray(input.ids) ? input.ids : [];
    for (const id of [...knownFromOptions, ...knownFromCall]) {
      const value = String(id || "").trim();
      if (value) ids.add(value);
    }
    const activeId = activeThemeId();
    if (activeId) ids.add(activeId);

    const named = new Map(custom.map((row) => [row.id, row.name]));
    const rows = [];
    for (const id of ids) {
      rows.push({ id, name: named.get(id) || id, active: id === activeId });
    }
    return rows;
  }

  async function start() {
    await refresh();
    try {
      unsubscribe = hana?.theme?.subscribe?.(() => { void refresh(); }) || null;
    } catch { unsubscribe = null; }
    return applied;
  }

  const ready = start();

  return {
    ready,
    refresh,
    getPalette: () => applied,
    paletteOf,
    listThemes,
    activeThemeUrl,
    activeThemeId,
    destroy() {
      disposed = true;
      try { unsubscribe?.(); } catch { /* 退订失败不影响页面 */ }
    },
  };
}
