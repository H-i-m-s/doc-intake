// ui/theme-bridge.js — 把宿主主题色搬进页面，写成一组固定的 CSS 变量。
//
// 通用件：不 import 本项目任何东西，拷到别的 App 里改一行 import 就能用。
//
// ── 为什么要它 ──────────────────────────────────────────────────────────
// 宿主给卡片页面的主题样式表，官方 SDK 的做法是「先 fetch 再内联成 <style>」。
// 在卡片这类挂载位里那一步经常不成立（fetch 被页面的 connect-src 拦住，或根本没有
// 走那条路），结果页面里 --hana-* 全是空，所有颜色一路掉进各自的兜底值。
// 更麻烦的是：主题表里真正定义的名字是无前缀的（--accent / --text / --text-light /
// --bg-card / --border），--hana-* 只有聊天正文用的那几个。所以谁只认 --hana-*，
// 谁在自定义主题下就认不出强调色。
//
// 这里做四件事：
//   1. 自己把主题样式表插进页面（<link>，不走 fetch）；
//   2. 按「有前缀 → 无前缀」的备选链逐个角色取值；
//   3. 取不到的用中性色补（深色给近白字，浅色给近黑字），绝不留下暖色兜底；
//   4. 写出一组与 App 无关的变量（--ui-*），App 的样式表只认这一组。
//
// ── 怎么用 ──────────────────────────────────────────────────────────────
//   import { installThemeBridge } from "./theme-bridge.js";
//   const bridge = installThemeBridge({ hana });      // hana 是 SDK 导出的对象
//   // 之后页面里直接用：
//   //   color: var(--ui-text);
//   //   background: var(--ui-surface);
//   //   border: 1px solid var(--ui-border);
//   //   accent: var(--ui-accent);  文字压在强调色上用 var(--ui-on-accent)
//
//   想接别的色源（比如另一个 App 的皮肤、自己的品牌色），传 providers：
//   installThemeBridge({ hana, providers: [async () => ({ accent: "#C99AAF" })] })
//   provider 返回的角色会盖过宿主，返回 null 表示这次没有意见。
//
// 写出的变量：
//   --ui-bg / --ui-surface / --ui-border / --ui-text / --ui-text-soft /
//   --ui-text-muted / --ui-accent / --ui-accent-soft / --ui-on-accent /
//   --ui-ok / --ui-warn / --ui-font / --ui-mono
// 另外在根节点写 data-ui-theme="dark|light"，需要按主题切换的非颜色样式可以挂它。
//
// 只操作 DOM，不碰网络（除了插一张样式表），不碰宿主存储，不抛错。

const LINK_ID = "hanako-theme-stylesheet";

/** 每个角色按顺序找：先宿主的，再主题表里真名，最后才是调用方兜底。 */
const ROLE_SOURCES = {
  bg: ["--hana-bg", "--bg"],
  surface: ["--hana-bg-card", "--bg-card"],
  border: ["--hana-border", "--border"],
  text: ["--hana-text", "--content-chat-ink", "--text"],
  textSoft: ["--hana-text-light", "--content-secondary-ink", "--text-light"],
  textMuted: ["--hana-text-muted", "--text-muted"],
  accent: ["--hana-accent", "--accent"],
  accentSoft: ["--hana-accent-light", "--accent-light"],
  ok: ["--hana-green", "--green"],
  warn: ["--hana-danger", "--danger", "--coral"],
  font: ["--hana-font-ui", "--font-ui"],
  mono: ["--hana-font-mono", "--font-mono"],
};

/**
 * 宿主什么都没给时的中性兜底。
 * 刻意不用暖色：暖色兜底一旦落到深色卡片上就是「淡黄的字、淡黄的底」，
 * 那是这套东西最初被嫌弃的原因。
 */
const NEUTRAL = {
  dark: {
    bg: "#232c33", surface: "#2a343c", border: "rgba(255, 255, 255, 0.12)",
    text: "#f2f4f7", textSoft: "#c3cad3", textMuted: "#919aa4",
    accent: "#8b9bb0", accentSoft: "rgba(139, 155, 176, 0.16)",
    ok: "#6e9c7f", warn: "#c07d72", font: "", mono: "",
  },
  light: {
    bg: "#f7f8fa", surface: "#ffffff", border: "rgba(0, 0, 0, 0.12)",
    text: "#1f2226", textSoft: "#4d545c", textMuted: "#78818b",
    accent: "#5b7089", accentSoft: "rgba(91, 112, 137, 0.12)",
    ok: "#4f8a63", warn: "#b06a5e", font: "", mono: "",
  },
};

const ROLE_NAMES = Object.keys(ROLE_SOURCES);

/** 把任意 CSS 颜色粗略换算成 0..1 的亮度，用来判断该配白字还是黑字。 */
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
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  const channel = (n) => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 深色还是浅色：先看宿主的结论，再按正文色亮度推断。 */
function resolveAppearance(snapshot, vars, fallbackDark) {
  const declared = String(snapshot?.appearance || "").toLowerCase();
  if (declared === "dark" || declared === "light") return declared;
  const lum = luminance(vars.text);
  if (lum !== null) return lum > 0.5 ? "dark" : "light";
  return fallbackDark ? "dark" : "light";
}

function readVar(style, names) {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return "";
}

/**
 * 装上主题桥，返回一个可控的小对象。
 * 参数都可以不传，默认从 document / window 取。
 */
export function installThemeBridge(options = {}) {
  const doc = options.doc || (typeof document !== "undefined" ? document : null);
  const win = options.win || (typeof window !== "undefined" ? window : null);
  if (!doc || !win) {
    return { ready: Promise.resolve(null), refresh: async () => null, getPalette: () => null, destroy() {} };
  }

  const hana = options.hana || null;
  const root = options.root || doc.body || doc.documentElement;
  const providers = Array.isArray(options.providers) ? options.providers.filter((fn) => typeof fn === "function") : [];
  const onApply = typeof options.onApply === "function" ? options.onApply : null;
  /** 调用方给的最后兜底，优先级最低。 */
  const base = options.fallback && typeof options.fallback === "object" ? options.fallback : null;

  let applied = null;
  let unsubscribe = null;
  let disposed = false;

  function themeUrl() {
    let url = "";
    try { url = String(hana?.theme?.getSnapshot?.()?.cssUrl || "").trim(); } catch { url = ""; }
    if (url) return url;
    // 宿主的初始主题是从 URL 参数带进来的，握手之前也拿得到，所以首帧就能用上。
    try {
      return String(new URLSearchParams(win.location?.search || "").get("hana-css") || "").trim();
    } catch { return ""; }
  }

  /** 插样式表，返回「它到底加载完没有」。重复调用不会插第二张。 */
  function ensureStylesheet(url) {
    if (!url) return Promise.resolve(false);
    const existing = doc.getElementById(LINK_ID);
    if (existing) {
      return existing.dataset.loaded === "1" ? Promise.resolve(true) : new Promise((done) => {
        existing.addEventListener("load", () => done(true), { once: true });
        existing.addEventListener("error", () => done(false), { once: true });
        setTimeout(() => done(existing.dataset.loaded === "1"), 800);
      });
    }
    return new Promise((done) => {
      const link = doc.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      link.href = url;
      link.addEventListener("load", () => { link.dataset.loaded = "1"; done(true); }, { once: true });
      link.addEventListener("error", () => done(false), { once: true });
      (doc.head || doc.documentElement)?.appendChild(link);
      // 加载失败也要给个上限，不能让调用方一直等。
      setTimeout(() => done(link.dataset.loaded === "1"), 800);
    });
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

  function detectAppearance(vars) {
    let snapshot = null;
    try { snapshot = hana?.theme?.getSnapshot?.() || null; } catch { snapshot = null; }
    let systemDark = false;
    try { systemDark = !!(win.matchMedia && win.matchMedia("(prefers-color-scheme: dark)").matches); } catch { systemDark = false; }
    return resolveAppearance(snapshot, vars, systemDark);
  }

  function write(palette) {
    if (!root || !root.style) return;
    for (const role of ROLE_NAMES) {
      const value = palette[role];
      if (!value) continue;
      // 字体那两个是字体栈，变量名照样写；空值不覆盖，免得把上一轮的值抹掉。
      root.style.setProperty(`--ui-${role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
    }
    // 压在强调色上的字：直接比「白字」与「黑字」哪个对比度高，比拍一个亮度阈值可靠。
    // 阈值法在中间亮度会选错，比如 #C99AAF 这种粉，阈值选白字就糊了。
    const accentLum = luminance(palette.accent);
    let onAccent = "#ffffff";
    if (accentLum !== null) {
      const vsWhite = 1.05 / (accentLum + 0.05);
      const vsBlack = (accentLum + 0.05) / 0.05;
      onAccent = vsBlack >= vsWhite ? "#14181c" : "#ffffff";
    }
    root.style.setProperty("--ui-on-accent", onAccent);
    root.setAttribute("data-ui-theme", palette.theme);
  }

  async function refresh() {
    if (disposed || !root) return applied;
    // 先按「现在能读到什么」定一次深浅，用来挑中性兜底；
    // 表还没进来时这一步只能靠宿主的 appearance 或系统偏好。
    const probe = paletteFromDom(detectAppearance({}));
    const appearance = detectAppearance(probe);
    const url = themeUrl();
    const loaded = await ensureStylesheet(url);

    let palette = paletteFromDom(appearance);
    // 表加载完可能把深浅也改了（比如自定义主题自带 appearance），再判一次。
    const again = detectAppearance(palette);
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

    palette.stylesheet = loaded ? "loaded" : url ? "failed" : "missing";
    write(palette);
    applied = palette;
    try { onApply?.(palette, { url }); } catch { /* 回调是调用方的代码，坏了不影响配色 */ }
    return applied;
  }

  async function start() {
    await refresh();
    try {
      // 主题一变就重取：样式表内容会被宿主换掉，值要跟着刷新。
      unsubscribe = hana?.theme?.subscribe?.(() => { void refresh(); }) || null;
    } catch { unsubscribe = null; }
    return applied;
  }

  const ready = start();

  return {
    /** 等首次配色落地。 */
    ready,
    /** 手动重取一次（例如 skin 换了之后）。 */
    refresh,
    /** 最近一次的结果，没取到过为 null。 */
    getPalette: () => applied,
    destroy() {
      disposed = true;
      try { unsubscribe?.(); } catch { /* 退订失败不影响页面 */ }
    },
  };
}
