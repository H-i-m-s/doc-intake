// ui/card.js — 聊天流里的文档解析进度卡片
//
// 身份：卡片 iframe 里唯一拿得到的是宿主铸造的 cardInstanceId；jobId 既不可见也不可逆，
// 所以「这张卡对应哪个作业」由服务端反查（lib/jobs.js 的 findJobByCardId），
// 卡片自己只按秒拿快照。查不到就是查不到，卡片不做任何猜测。
//
// 进度：数字全部来自 ui/shared/progress.js 的同一条曲线，卡片不重算公式。
// 条子走到 100% 只有两种情况：文件真的 done，或整个作业 state 变成 done。

import { estimateTotalMs, fakePercent } from "./shared/progress.js";

/** 卡片宽度固定，宿主卡片壳按这个值给列宽。 */
export const CARD_WIDTH = 460;
const POLL_INTERVAL_MS = 1000;
const CONTEXT_RETRY_TIMES = 20;
const CONTEXT_RETRY_MS = 200;
const MAX_CONSECUTIVE_FAILURES = 5;

const FILE_STATE_TEXT = {
  pending: "等待中",
  running: "解析中",
  done: "已完成",
  failed: "失败",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 纯函数：格式化与快照映射 ──────────────────────────────────────────────
// 这一段刻意不碰 DOM：秒数格式和平均进度错了，卡片上的数字会长期错下去，
// 而且肉眼很难发现，必须能脱离浏览器单独跑。

export function formatDuration(ms) {
  const value = Number(ms);
  const totalMs = Number.isFinite(value) && value > 0 ? value : 0;
  const seconds = Math.floor(totalMs / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const rest = seconds % 60;
  // 秒数补零：右侧状态字不会因为位数变化被推着左右走。
  return `${Math.floor(seconds / 60)} 分 ${String(rest).padStart(2, "0")} 秒`;
}

export function formatElapsed(ms) {
  return `已等待 ${formatDuration(ms)}`;
}

export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function isKnownFileStatus(status) {
  return typeof status === "string" && Object.hasOwn(FILE_STATE_TEXT, status);
}

function fileElapsedMs(file, nowMs) {
  const startedAt = Number(file?.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return 0;
  return Math.max(0, nowMs - startedAt);
}

/**
 * 作业快照 → 视图模型。所有需要判断的地方都收在这里，DOM 那边只照着抄。
 * now 由调用方传入而不是内部取，测试才能钉住时间。
 */
export function buildViewModel(snapshot, now) {
  const job = snapshot && typeof snapshot === "object" ? snapshot : {};
  const state = typeof job.state === "string" && job.state ? job.state : "running";
  const nowValue = Number(now);
  const nowMs = Number.isFinite(nowValue) ? nowValue : Date.now();
  const createdAt = Number(job.createdAt);
  const elapsedMs = Number.isFinite(createdAt) && createdAt > 0 ? Math.max(0, nowMs - createdAt) : 0;
  const rawFiles = Array.isArray(job.files) ? job.files : [];

  const files = rawFiles.map((file) => {
    const status = isKnownFileStatus(file?.status) ? file.status : "pending";
    const elapsed = fileElapsedMs(file, nowMs);
    let percent;
    if (status === "done") {
      // 真完成了才给 100：曲线本身停在 96，那 4 个点就是留给这个事件的。
      percent = 100;
    } else {
      // backend 还没回报时按 mineru 估：它是 PDF 的默认档，量级最接近，
      // 差的只是起步那几秒，比起把进度条停住更接近用户看到的事实。
      const backend = typeof file?.backend === "string" && file.backend ? file.backend : "mineru";
      percent = clampPercent(fakePercent(elapsed, estimateTotalMs(file?.pages, backend)));
    }
    return {
      name: typeof file?.name === "string" && file.name ? file.name : "未命名文件",
      status,
      stateText: FILE_STATE_TEXT[status],
      secondsText: formatDuration(elapsed),
      error: status === "failed"
        ? (typeof file?.error === "string" && file.error.trim() ? file.error.trim() : "解析失败")
        : "",
      percent,
    };
  });

  const average = files.length
    ? files.reduce((sum, file) => sum + file.percent, 0) / files.length
    : 0;
  // 失败态保留当前进度：作业没有「完成」这回事，把条子推满等于报假消息。
  const percent = state === "done" ? 100 : clampPercent(average);
  const stateText = state === "done" ? "已完成" : state === "failed" ? "失败" : "解析中";
  const title = files.length === 1
    ? files[0].name
    : files.length > 1 ? `${files.length} 个文件` : "文档解析";

  return {
    title,
    stateText,
    state: state === "done" || state === "failed" ? state : "running",
    elapsedText: formatElapsed(elapsedMs),
    percent,
    files,
    // 只有真完成才走收尾过渡；失败停在原地，不给任何「快好了」的暗示。
    final: state === "done",
  };
}

// ── 浏览器部分 ────────────────────────────────────────────────────────────
// 下面只在真有 DOM 时执行：Node 里 import 本文件是为了取上面的纯函数。

function hasCardApi(candidate) {
  return Boolean(
    candidate
    && typeof candidate === "object"
    && typeof candidate.surface?.getContext === "function"
    && typeof candidate.api?.fetch === "function"
    && typeof candidate.ui?.resize === "function",
  );
}

async function resolveHana() {
  // 独立预览页在加载本文件前塞了一个 window.hana（三项能力齐全才认）。
  // 真宿主里没有这个全局，走随包的 SDK。
  if (hasCardApi(globalThis.hana)) return globalThis.hana;
  const mod = await import("./assets/sdk.js");
  return mod?.hana ?? null;
}

function startCard() {
  const card = document.getElementById("di-card");
  const titleEl = document.getElementById("di-title");
  const percentEl = document.getElementById("di-percent");
  const elapsedEl = document.getElementById("di-elapsed");
  const stateEl = document.getElementById("di-state");
  const fillEl = document.getElementById("di-fill");
  const filesEl = document.getElementById("di-files");
  if (!card || !fillEl || !filesEl) return;

  let hana = null;
  let cardInstanceId = "";
  let timer = null;
  let terminal = false;
  let busy = false;
  let failures = 0;
  const rows = [];

  function syncTheme() {
    let snap = null;
    try { snap = hana?.theme?.getSnapshot?.() || null; } catch { snap = null; }
    const label = String(snap?.theme || "");
    let dark = snap?.appearance === "dark" || /dark|midnight|contrast|深|夜/i.test(label);
    if (!snap?.appearance && (!label || label === "inherit")) {
      try {
        dark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      } catch { dark = false; }
    }
    document.body.classList.toggle("t-dark", dark);
  }

  // 两条都发：SDK 那条在设置窗里生效，聊天流挂载位实测只认 hana.card-resize。
  function reportSize() {
    const height = Math.ceil(card.offsetHeight || 0);
    if (!(height > 0)) return;
    try { hana?.ui?.resize?.({ height, width: CARD_WIDTH }); } catch { /* 老宿主没有这路 */ }
    try { window.parent?.postMessage({ type: "hana.card-resize", height }, "*"); } catch { /* 同上 */ }
  }

  // 上一次写进宽度的百分比。完成时要用它算「还剩多少」，决定补全给多久。
  let lastPercent = 0;
  // 本次完成过渡实际用了多少毫秒，过渡结束后补量高度要用。
  let lastFinalMs = 0;

  /**
   * 补全时长按剩余量定。
   *
   * 写死成固定值不行：只剩 1% 时条子会在原地磨一秒多，只剩三成时又显得太快。
   * 每百分点 34ms，下限 160ms 让最后一下看得见，上限 900ms 防止剩余量很大时拖太久。
   */
  function fillDurationFor(remaining) {
    const value = Number(remaining);
    if (!Number.isFinite(value) || value <= 0) return 160;
    return Math.min(900, Math.max(160, Math.round(value * 34)));
  }

  function setBar(percent, final) {
    const target = clampPercent(percent);
    lastFinalMs = final ? fillDurationFor(100 - lastPercent) : 0;
    card.classList.toggle("is-final", Boolean(final));
    // 完成那段时长只能由 JS 写：它取决于当时剩余多少，写死在 CSS 里就不成立了。
    // 两个值分别对 width 和 background-color，清空则回落 CSS 里的平时值。
    fillEl.style.transitionDuration = lastFinalMs > 0 ? `${lastFinalMs}ms, 240ms` : "";
    fillEl.style.width = `${target.toFixed(2)}%`;
    lastPercent = target;
  }

  function ensureRows(count) {
    while (rows.length > count) rows.pop().el.remove();
    while (rows.length < count) {
      const el = document.createElement("div");
      el.className = "di-file";
      const name = document.createElement("span");
      name.className = "di-file__name";
      const tail = document.createElement("span");
      tail.className = "di-file__tail";
      const state = document.createElement("span");
      state.className = "di-file__state";
      const seconds = document.createElement("span");
      seconds.className = "di-file__seconds";
      tail.append(state, seconds);
      const error = document.createElement("span");
      error.className = "di-file__error";
      el.append(name, tail, error);
      filesEl.append(el);
      rows.push({ el, name, state, seconds, error });
    }
  }

  function renderView(vm) {
    titleEl.textContent = vm.title;
    titleEl.title = vm.title;
    // 向上取整：停住不动的 0% 比停在 1% 更像死掉。进度本身是估的，取整不进位反而会
    // 让长文件在头十来秒一直挂着 0%。
    percentEl.textContent = `${Math.ceil(clampPercent(vm.percent) - 1e-9)}%`;
    elapsedEl.textContent = vm.elapsedText;
    stateEl.textContent = vm.stateText;
    card.dataset.state = vm.state;
    setBar(vm.percent, vm.final);
    // 单文件时标题就是文件名，再列一行同样的名字纯属重复。
    // 只有多文件、或单文件失败（那行要装失败原因）才列出来。
    const showRows = vm.files.length > 1 || vm.files.some((file) => file.error);
    ensureRows(showRows ? vm.files.length : 0);
    if (showRows) {
      vm.files.forEach((file, index) => {
        const row = rows[index];
        row.name.textContent = file.name;
        row.name.title = file.name;
        row.state.textContent = file.stateText;
        row.seconds.textContent = file.secondsText;
        row.error.textContent = file.error;
        row.el.dataset.state = file.status;
      });
    }
    reportSize();
  }

  // 记录没了 / 通道断了：只换状态文字和条子颜色，进度停在此刻，不假装还在走。
  function renderNotice(text) {
    stateEl.textContent = text;
    card.dataset.state = "stale";
    reportSize();
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function isHidden() {
    try { return document.visibilityState === "hidden"; } catch { return false; }
  }

  function schedule() {
    clearTimer();
    if (terminal || isHidden()) return;
    timer = setTimeout(tick, POLL_INTERVAL_MS);
  }

  function stopWith(text) {
    terminal = true;
    clearTimer();
    renderNotice(text);
  }

  async function readSnapshot() {
    const res = await hana.api.fetch(`/job-status?id=${encodeURIComponent(cardInstanceId)}`);
    // 404 是确定的结论（App 重启过，或作业过了保留期），不是抖动，不必再等。
    if (res && res.ok === false) return null;
    const body = await res.json();
    if (!body || body.ok !== true || !body.job) return null;
    return body.job;
  }

  async function tick() {
    timer = null;
    if (terminal || busy) return;
    busy = true;
    let job = null;
    try {
      job = await readSnapshot();
    } catch {
      busy = false;
      failures += 1;
      // 单次失败不终止：网络抖一下就让卡片停在半路，比慢一点更糟。
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        stopWith("与解析任务的连接已断开");
        return;
      }
      schedule();
      return;
    }
    busy = false;
    failures = 0;
    if (!job) {
      stopWith("解析记录已失效");
      return;
    }
    const vm = buildViewModel(job, Date.now());
    renderView(vm);
    if (vm.state === "done" || vm.state === "failed") {
      // 终态停轮询；完成那段过渡走完后再补一次高度，避免它被过渡撑高的一瞬间没报上去。
      terminal = true;
      clearTimer();
      if (vm.final) setTimeout(reportSize, lastFinalMs);
      return;
    }
    schedule();
  }

  async function resolveCardInstanceId() {
    for (let i = 0; i < CONTEXT_RETRY_TIMES; i += 1) {
      let ctx = null;
      try { ctx = hana.surface?.getContext?.() || null; } catch { ctx = null; }
      const id = typeof ctx?.cardInstanceId === "string" ? ctx.cardInstanceId.trim() : "";
      if (id) return id;
      // 宿主往 iframe 里注入身份有延迟，这边等的就是它。
      await sleep(CONTEXT_RETRY_MS);
    }
    return "";
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      // 后台标签页不拉：刷出来的画面没人看，只会让宿主的定时器越压越低频。
      if (terminal) return;
      if (isHidden()) {
        clearTimer();
        return;
      }
      tick();
    });
    window.addEventListener("resize", reportSize);
  }

  (async () => {
    hana = await resolveHana().catch(() => null);
    if (!hana) {
      renderNotice("宿主接口不可用");
      return;
    }
    // 这一步不能省：ready() 是跟宿主的握手，不握手时 surface.getContext() 会一直
    // 返回 null，卡片就只能停在「无法识别」。失败不阻塞渲染，主题还能先上。
    try { hana.ready?.(); } catch { /* 老宿主没有这一步 */ }
    syncTheme();
    try { hana.theme?.subscribe?.(() => syncTheme()); } catch { /* 订阅不可用就只保留首帧 */ }
    reportSize();
    cardInstanceId = await resolveCardInstanceId();
    if (!cardInstanceId) {
      renderNotice("无法识别这张卡片对应的任务");
      return;
    }
    await tick();
  })();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startCard, { once: true });
  } else {
    startCard();
  }
}
