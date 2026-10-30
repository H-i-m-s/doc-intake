// ui/card.js — 聊天流里的文档解析进度卡片
//
// 身份：卡片挂载时 route 里带着 job（details.card.route 拼出来的），这是首选来源；
// 宿主重新挂载 iframe 时不保证及时注入 cardInstanceId，只等注入就会等成「无法识别」。
// URL 里没有 job 的存量卡片才回退到宿主铸造的 cardInstanceId，服务端两种键都认
// （lib/jobs.js 的 getJob / findJobByCardId）。查不到就是查不到，卡片不做任何猜测。
//
// 进度：数字全部来自 ui/shared/progress.js 的同一条曲线，卡片不重算公式。
// 条子走到 100% 只有两种情况：文件真的 done，或整个作业 state 变成 done。

import { estimateTotalMs, fakeAcceleration, fakePercent, fakeVelocity } from "./shared/progress.js";

/** 卡片宽度固定，宿主卡片壳按这个值给列宽。 */
export const CARD_WIDTH = 460;
const POLL_INTERVAL_MS = 1000;
const CONTEXT_RETRY_TIMES = 20;
const CONTEXT_RETRY_MS = 200;
const MAX_CONSECUTIVE_FAILURES = 5;
/** 百分比数字的刷新间隔。每帧刷会疯跳，太快看不清；100ms 足够跟上条子。 */
const TEXT_INTERVAL_MS = 100;

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

/**
 * 后端 id → 界面上的中文名。
 * id 是 Python 侧的事实，卡片只负责翻译：同一份 id 在设置页、日志、卡片上都指同一个后端。
 */
export const BACKEND_LABEL = {
  mineru: "MinerU",
  paddleocr: "PaddleOCR",
  "mineru-local": "MinerU（本地）",
  "paddleocr-local": "PaddleOCR（本地）",
  local: "本地解析",
};

/**
 * 未知 id 原样返回，不编中文名：编出来就是把「不知道是什么」说成「知道」，
 * 而原始 id 至少能让人拿着去对日志。空值返回空串，那一行整个不出现。
 */
export function backendLabel(id) {
  const key = typeof id === "string" ? id.trim() : "";
  if (!key) return "";
  return Object.hasOwn(BACKEND_LABEL, key) ? BACKEND_LABEL[key] : key;
}

/** 取路径最后一段。快照里的 name 已是文件名，但只有 source 时得自己切一刀。 */
export function baseNameOf(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
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
    const reportedBackend = typeof file?.backend === "string" ? file.backend.trim() : "";
    const backend = reportedBackend || "mineru";
    const total = estimateTotalMs(file?.pages, backend);
    const mdPath = typeof file?.mdPath === "string" && file.mdPath ? file.mdPath : "";
    const pagesValue = Number(file?.pages);
    const pages = Number.isFinite(pagesValue) && pagesValue > 0 ? Math.round(pagesValue) : null;
    const reportedMs = Number(file?.durationMs);
    // 完成后的耗时用后端报的真实值；还在跑就按自己的起点算。两者都是毫秒，同一把尺子。
    const durationMs = status === "done" && Number.isFinite(reportedMs) && reportedMs > 0
      ? reportedMs
      : elapsed;
    let percent;
    let velocity = 0;
    let acceleration = 0;
    if (status === "done") {
      // 真完成了才给 100：曲线本身停在 99，那 1 个点就是留给这个事件的。
      percent = 100;
    } else {
      // backend 还没回报时按 mineru 估：它是 PDF 的默认档，量级最接近，
      // 差的只是起步那几秒，比起把进度条停住更接近用户看到的事实。
      percent = clampPercent(fakePercent(elapsed, total));
      // 速度和加速度也一并带出去：完成那一段要从「此刻的速度」接着跑。
      velocity = fakeVelocity(elapsed, total);
      acceleration = fakeAcceleration(elapsed, total);
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
      velocity,
      acceleration,
      // 已落盘的 Markdown 路径。没保存就没值，「打开文件夹」也就不会出现。
      mdPath,
      // 以下只供展开后的键值表：标题用 name，表格第一行要的是纯文件名。
      fileName: baseNameOf(file?.name) || baseNameOf(file?.source) || "未命名文件",
      pathText: mdPath || "未保存到本地",
      pages,
      pagesText: pages === null ? "" : `${pages} 页`,
      // backend 是快照里的原始 id，翻译不在这里做；backendText 才是给人看的。
      backend: reportedBackend,
      backendText: backendLabel(reportedBackend),
      durationText: formatDuration(durationMs),
    };
  });

  const average = files.length
    ? files.reduce((sum, file) => sum + file.percent, 0) / files.length
    : 0;
  // 速度和加速度同样取平均：总百分比是各文件百分比的算术平均，它的导数也就是导数们的平均。
  const velocity = files.length
    ? files.reduce((sum, file) => sum + file.velocity, 0) / files.length
    : 0;
  const acceleration = files.length
    ? files.reduce((sum, file) => sum + file.acceleration, 0) / files.length
    : 0;
  // 失败态保留当前进度：作业没有「完成」这回事，把条子推满等于报假消息。
  const percent = state === "done" ? 100 : clampPercent(average);
  const stateText = state === "done" ? "已完成" : state === "failed" ? "失败" : "解析中";
  const title = files.length === 1
    ? files[0].name
    : files.length > 1 ? `${files.length} 个文件` : "文档解析";

  return {
    title,
    // 详情表的「任务」一栏。作业快照里带 jobId；从 cardInstanceId 查回来的那条没有，
    // 由卡片用自己手里的查询键兜住。
    jobId: typeof job.jobId === "string" ? job.jobId : "",
    stateText,
    state: state === "done" || state === "failed" ? state : "running",
    elapsedText: formatElapsed(elapsedMs),
    percent,
    // 完成那一段的起手条件：位置、速度、加速度。
    velocity,
    acceleration,
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
  const headEl = document.getElementById("di-fold");
  const chevronEl = document.getElementById("di-chevron");
  const titleEl = document.getElementById("di-title");
  const percentEl = document.getElementById("di-percent");
  const elapsedEl = document.getElementById("di-elapsed");
  const stateEl = document.getElementById("di-state");
  const revealEl = document.getElementById("di-reveal");
  const fillEl = document.getElementById("di-fill");
  const foldEl = document.getElementById("di-fold-zone");
  const detailEl = document.getElementById("di-detail");
  const jobRowEl = document.getElementById("di-detail-job");
  const jobValueEl = document.getElementById("di-detail-job-value");
  if (!card || !fillEl || !foldEl || !detailEl) return;

  let hana = null;
  // /job-status 的查询键：URL 带来的 jobId，或宿主注入的 cardInstanceId。
  // 后端两种都认，卡片只负责挑一个能拿到的填进来。
  let jobKey = "";
  let timer = null;
  let terminal = false;
  let busy = false;
  let failures = 0;
  /** 每个文件一组详情行，按文件下标对齐；组的结构建一次就不再动。 */
  const groups = [];

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
  // 参数是本次想报的高度，不传就量卡片。折叠区展开时卡片还长在路上，量到的只是半截，
  // 所以那时由调用方把终值算好递进来。resize 事件会把 Event 对象当参数递进来，
  // 它不是数字，会落到「量卡片」那一路。
  function reportSize(overrideHeight) {
    const target = Number(overrideHeight);
    const height = Number.isFinite(target) && target > 0
      ? Math.ceil(target)
      : Math.ceil(card.offsetHeight || 0);
    if (!(height > 0)) return;
    try { hana?.ui?.resize?.({ height, width: CARD_WIDTH }); } catch { /* 老宿主没有这路 */ }
    try { window.parent?.postMessage({ type: "hana.card-resize", height }, "*"); } catch { /* 同上 */ }
  }

  // 高度逐帧跟随。只在上报的两个时刻发值，宿主收到的就是两个离散高度，
  // 表现是一下撑开；折叠区的 max-height 过渡跑了 220ms，这期间卡片每帧都在长，
  // 拿 ResizeObserver 把这些帧全报上去，宿主的卡片高度就跟得上了。
  // 观察的是自己的根节点（宽度固定、高度由内容定），不受宿主 iframe 高度影响，不会绕回来。
  if (typeof ResizeObserver !== "undefined") {
    try {
      let observedH = 0;
      new ResizeObserver(() => {
        const height = Math.ceil(card.offsetHeight || 0);
        if (!(height > 0) || height === observedH) return;
        observedH = height;
        reportSize(height);
      }).observe(card);
    } catch { /* 观察失败不影响主流程，还是靠那几次主动上报 */ }
  }

  // 最近一次轮询拿到的快照。百分比不靠它推进，靠下面那个每帧的时钟。
  let latest = null;
  let animId = 0;
  let lastPercent = 0;
  let lastTextAt = 0;
  // 完成且落了盘才有值，undefined 就代表没东西可开。
  let savedPath = "";
  // 已经进过终态。切回来时靠它决定是「补渲染终态」还是「重新开始跑」。
  let finalised = false;
  let finalPercent = 0;
  // 时钟停下那一刻的速度与加速度。
  // 不能到 settle 里再去问快照：已完成那条分支根本不算这两个量，给回来的是 0，
  // 拿 0 当接缝速度等于让条子从静止重新起步，会抽一下。
  let lastVelocity = 0;
  let lastAcceleration = 0;

  function stopAnimation() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = 0;
    }
  }

  /**
   * 每帧推进。百分比是「已经跑了多久」的函数，本地就能连续算，不必等轮询；
   * 轮询只负责作业状态（还在跑、还是已结束）。
   *
   * 原来是一秒拉一次、每次用 320ms 过渡走过去再停 680ms，看着就是一跳一跳。
   */
  function animate() {
    if (terminal) {
      animId = 0;
      return;
    }
    animId = requestAnimationFrame(animate);
    if (!latest) return;
    const now = Date.now();
    const vm = buildViewModel(latest, now);
    lastPercent = clampPercent(vm.percent);
    lastVelocity = vm.velocity;
    lastAcceleration = vm.acceleration;
    fillEl.style.width = `${lastPercent.toFixed(2)}%`;
    // 数字没必要跟条子一样每帧刷，100ms 一刷；值本身连续，看起来是小位数在稳定爬。
    if (now - lastTextAt < TEXT_INTERVAL_MS) return;
    lastTextAt = now;
    percentEl.textContent = `${lastPercent.toFixed(1)}%`;
    elapsedEl.textContent = vm.elapsedText;
    // 详情表里每个文件的耗时跟百分比同一档节流：它也是按秒变的数，
    // 每帧写一遍只是白白的布局开销。
    vm.files.forEach((file, index) => {
      const group = groups[index];
      if (group) group.duration.value.textContent = file.durationText;
    });
  }

  /**
   * 五次 Hermite。六个边界条件：起点的位置、速度、加速度，终点的位置、速度、加速度。
   * 终点那三项（100、0、0）是定死的，所以只用得上前三个基函数。
   *
   * 为什么是五次而不是三次：三次只能锁住位置和速度，加速度在接缝处会跳，
   * 而人眼挑得出来的正是那一跳。五次把加速度也锁上。
   * s 在 [0,1] 上，v0 与 a0 要先乘上 T 和 T² 换算成「点」。
   */
  function hermite5(s, p0, v0, a0, p1) {
    const s2 = s * s;
    const s3 = s2 * s;
    const s4 = s3 * s;
    const s5 = s4 * s;
    const h0 = 1 - 10 * s3 + 15 * s4 - 6 * s5;
    const h1 = s - 6 * s3 + 8 * s4 - 3 * s5;
    const h2 = (s2 - 3 * s3 + 3 * s4 - s5) / 2;
    const h3 = 10 * s3 - 15 * s4 + 6 * s5;
    return h0 * p0 + h1 * v0 + h2 * a0 + h3 * p1;
  }

  /** 这一段曲线必须单调、不越 100，否则会看到条子冲出去再退回来。 */
  function fillShapeOk(p0, v0, a0, ms) {
    let prev = p0;
    for (let i = 1; i <= 48; i += 1) {
      const p = hermite5(i / 48, p0, ms * v0, ms * ms * a0, 100);
      if (!Number.isFinite(p)) return false;
      if (p < prev - 1e-6) return false;
      if (p > 100 + 1e-6) return false;
      prev = p;
    }
    return true;
  }

  /**
   * 选补满的时长：从 260ms 起试，不满足单调就放大。
   * 起点速度越小，这一段需要的时长越长；上限 2000ms 只为兜极端情况。
   */
  /**
   * 补满那段要多久。
   *
   * 这里只保证形状合法（单调、不越界），不管好看。时长定得太短时，五次曲线为了
   * 在几十毫秒内走完剩下的点，峰值速度会飏到平均值的两倍以上，看起来就是「啪」一下满了。
   * 起点时长按剩余量给：每百分点 45ms，下限 500ms，上限 2000ms。
   * 下限压得比每点还短，是因为收尾时只剩一两个点，再给几百毫秒反而拖沓。
   */
  function pickFillMs(p0, v0, a0) {
    const remaining = Math.max(0, 100 - p0);
    const floor = Math.min(2000, Math.max(500, remaining * 45));
    for (let ms = Math.round(floor / 40) * 40; ms <= 2800; ms += 40) {
      if (fillShapeOk(p0, v0, a0, ms)) return ms;
    }
    return 2800;
  }

  /**
   * 补满那一下：从这里接着跑，不是从这里重新开始。
   *
   * 起点取当前百分比、当前速度、当前加速度，终点位置 100、速度 0、加速度 0。
   * 于是接缝处位置、速度、加速度三样都连续，肉眼看不到切换；
   * 速度在中间会自己提上去再收住，不需要另外硬拉一段过渡。
   */
  function fillToFull(from, v0, a0) {
    // 三种情况不做动画，直接把结果给出来：
    // 卡片不可见（浏览器挂起 rAF，一帧都不会跑）、已经到顶、或者压根没跑过
    // （卡片晚于作业完成才挂载，这时候从零补满没有任何意义）。
    // 只看起点位置，不看速度：速度为 0 时曲线会退化成平滑起步，仍然走得完，
    // 而拿「速度是不是 0」当条件的话，完成那一帧快照里的速度本来就是 0，
    // 每次都会从这退出去，时长白算。
    if (isHidden() || !(100 - from > 1e-6) || !(from > 0)) {
      card.dataset.fillMs = "0";
      card.dataset.fillFrom = from.toFixed(2);
      fillEl.style.width = "100%";
      percentEl.textContent = "100.0%";
      lastPercent = 100;
      reportSize();
      return;
    }
    const ms = pickFillMs(from, v0, a0);
    // 把实际用的时长写在卡片上。补满到底是 1200ms 还是被早退分支吞了，
    // 光看代码看不出来，留个可读的量做验收。
    card.dataset.fillMs = String(ms);
    card.dataset.fillFrom = from.toFixed(2);
    const startedAt = performance.now();
    const frame = (now) => {
      const s = Math.min(1, Math.max(0, (now - startedAt) / ms));
      const clamped = Math.min(100, Math.max(from, hermite5(s, from, ms * v0, ms * ms * a0, 100)));
      lastPercent = clamped;
      fillEl.style.width = `${clamped.toFixed(2)}%`;
      // 没跑完之前不给 100.0：toFixed(1) 会把 99.96 舍成 100.0，
      // 数字先到顶再等条子，看上去像提前结束了。
      percentEl.textContent = `${(s < 1 ? Math.min(99.9, clamped) : 100).toFixed(1)}%`;
      if (s < 1) {
        requestAnimationFrame(frame);
        return;
      }
      fillEl.style.width = "100%";
      percentEl.textContent = "100.0%";
      lastPercent = 100;
      reportSize();
    };
    requestAnimationFrame(frame);
  }

  /**
   * 终态：停掉时钟，按 C² 连续的五次曲线补完。失败则停在原地，不假装还能到 100。
   */
  function settle(vm) {
    terminal = true;
    finalised = true;
    finalPercent = vm.final ? 100 : lastPercent;
    clearTimer();
    stopAnimation();
    // 落盘了才给「打开文件夹」。多文件作业里只开第一个成功的：
    // 默认都落在同一个输出目录，开哪一个文件夹结果一样。
    const saved = vm.files.find((file) => file.status === "done" && file.mdPath);
    if (saved && revealEl) {
      savedPath = saved.mdPath;
      revealEl.hidden = false;
    }
    if (!vm.final) {
      percentEl.textContent = `${lastPercent.toFixed(1)}%`;
      reportSize();
      return;
    }
    // 接缝速度用时钟停下那一刻存下的，不用快照里的：vm 是已完成状态，
    // 那条分支不会算速度和加速度，拿到的是 0。
    fillToFull(lastPercent, lastVelocity, lastAcceleration);
  }

  /**
   * 在系统文件管理器里定位到那个文件。
   * 实际动手的是 App 进程（explorer /select），这里只发一包请求；
   * 卡片 iframe 自己没有起进程的能力，也不该有。
   */
  async function reveal() {
    if (!savedPath) return;
    try {
      const res = await hana.api.fetch("/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: savedPath }),
      });
      const body = await res.json().catch(() => null);
      // 失败就在按钮上留一句原因，不开弹窗：卡片里没有对话框，也不该有。
      if (body && body.ok === false) revealEl.title = body.error || "打开失败";
    } catch {
      revealEl.title = "打开失败";
    }
  }

  // ── 折叠区 ────────────────────────────────────────────────────────────
  // 展开态是一张键值表，不是一组卡片：每个文件一组行，组间只给一条极淡的分隔线。
  // 收起默认发生，且用高度过渡而不是 display:none —— 硬切时看不出下面还有东西。

  const FOLD_MS = 220;
  let expanded = false;
  let lastFoldH = -1;

  function makeRow(label, extraClass) {
    const el = document.createElement("div");
    el.className = "di-kv";
    if (extraClass) el.classList.add(extraClass);
    const k = document.createElement("span");
    k.className = "di-kv__k";
    k.textContent = label;
    const value = document.createElement("span");
    value.className = "di-kv__v";
    el.append(k, value);
    return { el, value };
  }

  /**
   * 一个文件的六行。页数与后端两行是否在场要随快照变，所以先建好、用 hidden 开关，
   * 不每次重建：节点稳定，animate() 里缓存的耗时引用才一直有效。
   */
  function makeGroup() {
    const el = document.createElement("div");
    el.className = "di-detail__group";
    const row = (label, extraClass) => {
      const made = makeRow(label, extraClass);
      el.append(made.el);
      return made;
    };
    return {
      el,
      name: row("文件"),
      path: row("路径"),
      pages: row("页数"),
      backend: row("后端"),
      duration: row("耗时"),
      status: row("状态", "di-kv--status"),
    };
  }

  function ensureGroups(count) {
    while (groups.length > count) groups.pop().el.remove();
    while (groups.length < count) {
      const group = makeGroup();
      // 「任务」是作业级的一行，位置固定在最后：文件组一律插在它之前。
      detailEl.insertBefore(group.el, jobRowEl && jobRowEl.parentNode === detailEl ? jobRowEl : null);
      groups.push(group);
    }
  }

  function setOptional(row, text) {
    const has = typeof text === "string" && text.length > 0;
    row.el.hidden = !has;
    row.value.textContent = has ? text : "";
    row.value.title = has ? text : "";
  }

  function renderDetail(vm) {
    ensureGroups(vm.files.length);
    vm.files.forEach((file, index) => {
      const group = groups[index];
      group.el.dataset.state = file.status;
      group.name.value.textContent = file.fileName;
      group.name.value.title = file.fileName;
      // 路径一行不换行，起长就尾端省略；完整路径留在 title 里。
      group.path.value.textContent = file.pathText;
      group.path.value.title = file.mdPath;
      setOptional(group.pages, file.pagesText);
      setOptional(group.backend, file.backendText);
      group.duration.value.textContent = file.durationText;
      // 失败时把原因接在同一行后面，不另起一行：列表的行数不能因为一句话而变。
      group.status.value.textContent = file.error
        ? `${file.stateText}：${file.error}`
        : file.stateText;
      group.status.value.title = file.error;
      group.status.el.dataset.state = file.status;
    });
    const jobText = vm.jobId || jobKey;
    if (jobRowEl && jobValueEl) {
      jobRowEl.hidden = !jobText;
      jobValueEl.textContent = jobText;
      jobValueEl.title = jobText;
    }
  }

  /**
   * 只把撑开后的目标高度写进 CSS 变量，max-height 从这里读。返回该高度。
   * 不再拿它去预报表高：高度怎么变交给 ResizeObserver 逐帧跟，
   * 预报表高会让宿主先跳到终值，反倒比不报更硬。
   */
  function applyFoldHeight() {
    const height = Math.ceil(detailEl.getBoundingClientRect().height || 0);
    foldEl.style.setProperty("--di-fold-h", `${height}px`);
    lastFoldH = height;
    return height;
  }

  function setExpanded(next) {
    const want = !!next;
    if (want === expanded) return;
    expanded = want;
    foldEl.classList.toggle("is-open", expanded);
    foldEl.setAttribute("aria-hidden", expanded ? "false" : "true");
    headEl?.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (chevronEl) chevronEl.classList.toggle("is-open", expanded);
    applyFoldHeight();
    // 过渡跑完再兜一次。中途每一帧由 ResizeObserver 负责报，这里只防过渡因
    // 标签页不可见之类的原因没跑满时，尺寸停在半路。
    setTimeout(reportSize, FOLD_MS + 20);
  }

  function renderView(vm) {
    titleEl.textContent = vm.title;
    titleEl.title = vm.title;
    // 百分比和秒数一律不在这里写：它们由 animate() 每帧推。
    // 这里写过一次就会和动画抢：轮询一秒一次，每次都把带小数的值盖成整数，
    // 看起来就是数字每秒抽一下、位数突然短一位。
    stateEl.textContent = vm.stateText;
    stateEl.dataset.state = vm.state;
    card.dataset.state = vm.state;
    renderDetail(vm);
    // 详情内容可能把折叠区撑高或压矮，高度变量每轮重算一次。
    const previousH = lastFoldH;
    const height = applyFoldHeight();
    // 已经展开的时候高度变了，得等过渡跑完再报一次终值。
    if (expanded && height !== previousH) setTimeout(reportSize, FOLD_MS + 20);
    reportSize();
  }

  // 记录没了 / 通道断了：只换状态文字和条子颜色，进度停在此刻，不假装还在走。
  function renderNotice(text) {
    stateEl.textContent = text;
    stateEl.dataset.state = "stale";
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
    const res = await hana.api.fetch(`/job-status?id=${encodeURIComponent(jobKey)}`);
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
    latest = job;
    const vm = buildViewModel(job, Date.now());
    renderView(vm);
    if (vm.state === "done" || vm.state === "failed") {
      settle(vm);
      return;
    }
    schedule();
  }

  /**
   * 卡片 route 里带的作业 id。
   * 宿主把 details.card.route 当 iframe 的 src，query 会原样带到页面里，
   * 所以这条身份不需要等任何人注入；切回会话时优先走它。
   */
  function readJobIdFromLocation() {
    try {
      const search = globalThis.location?.search ?? "";
      if (!search) return "";
      const id = new URLSearchParams(search).get("job");
      return typeof id === "string" ? id.trim() : "";
    } catch {
      return "";
    }
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
      if (isHidden()) {
        // 后台不拉：刷出来的画面没人看，只会让宿主的定时器越压越低频。
        if (!terminal) clearTimer();
        return;
      }
      // 已经进过终态：卡片在隐藏期间 rAF 是挂起的，很可能整个补满动画一帧都没跑。
      // 这里直接按终值补一次，否则切回来会看到一张写着「已完成」但条子在 0% 的卡。
      if (finalised) {
        if (lastPercent < finalPercent - 1e-6) {
          lastPercent = finalPercent;
          fillEl.style.width = `${finalPercent.toFixed(2)}%`;
          percentEl.textContent = `${finalPercent.toFixed(1)}%`;
        }
        reportSize();
        return;
      }
      animate();
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
    // 只绑一次。这两个按钮一直在 DOM 里，不随轮询重建；
    // 若是每次渲染重绑，监听器会越叠越多。
    headEl?.addEventListener("click", () => { setExpanded(!expanded); });
    revealEl?.addEventListener("click", (event) => {
      // 「打开文件夹」在第三行，和箭头不在同一层，眼下冒不到折叠监听上；
      // 这里仍然拦一次：以后把折叠监听提到卡片根节点时，点它不会连带收起。
      event.stopPropagation();
      reveal();
    });
    reportSize();
    // URL 优先：它是卡片自己就能读到的东西，不依赖宿主什么时候把身份注进来。
    // 存量卡片的 route 里没有 job，才去等宿主注入 cardInstanceId。
    jobKey = readJobIdFromLocation() || (await resolveCardInstanceId());
    if (!jobKey) {
      renderNotice("无法识别这张卡片对应的任务");
      return;
    }
    // 先开时钟再拉首帧：晚几百毫秒开始，条子就会先在 0% 上停一段。
    animate();
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
