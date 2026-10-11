// 更新说明弹窗。
//
// 从 magpie-hana 的 ui/update-notice.mjs 整文件拷来（2026-10-11），而那份是从
// token-tracker-app 搬的。三边的取数层（lib/update-check.mjs）同源，所以行为一致。
// 它要的接口只有三个：api.getUpdateCheck / api.dismissUpdate / api.watchEvents。
// 最后一个可以没有：本 App 没有事件流，缺了它这组件会自己退化成轮询（见下面那段）。
// 取数通道由调用方给（卡片壳子与设置页各喂各的），见同目录的 ui/update-api.mjs。
// 样式在同目录的 update-notice.css。
//
// 这里只负责"画"和"关"：内容与版本判断都在插件进程（lib/update-check.mjs 去读 GitHub Release），
// 界面不硬编码任何一条说明，也不自己算版本高低。
//
// 三条路能走回背景：点背景（弹窗外那圈模糊处）、点 ×、点「我已知晓」。
// 除此之外没有第四种走法：内容区里点、拖、滚都不会关掉它。Esc 按「先不看」算。
//
// 场景上它有两个入口，不是同一件事：
//   「检查更新」    → force：一定去 GitHub 取一次。先把弹窗摆出来（「正在检查」），
//                     结果回来就地补内容，不让点击到画面之间隔着一次网络往返。
//   「查看更新说明」→ 只读上次检查的结果，一次网络都不出。
//
// 自动检查的时机由用户在设置页定的间隔（intervalMinutes，默认 360 分钟）决定：
// 打开界面、每 5 分钟轮询、扫到新用量时都会问一次，间隔没到就直接用手里那份。
//
// 两种关闭不是同一件事：
//   点背景 / × / Esc → 「先不看」：只记在插件进程内存里，本次 App 会话内不再弹，下次启动还会提醒一次。
//   「我已知晓」      → 落盘记住这个版本，直到发了下一版才会再提。
// 两条路都会广播，别的界面收到就把自己的弹窗一起关掉。
//
// 外观上它是个模态：背景整层模糊，底下的界面点不动。模糊靠 dialog::backdrop 的 backdrop-filter，
// 样式在 update-notice.css 的 .tt-update-dialog 一节。
//
// 进出场有一点动效：弹出挪几像素淡入，收回更短、收得干脆。节奏在 update-notice.css 的几条
// keyframes 里调；退场要等多久由这里现读 CSS 的 animation-duration，改时长不用两边对齐。

import { h } from "./components.mjs";

// 没有事件流时这就是唯一的跨界面安全网：靠它把别的界面的改动静静拉过来，
// 也靠它保证连接断了整个功能不至于哑掉。
const POLL_MS = 5 * 60 * 1000;
// 页面稳住之后再浮起来，别刚打开就砸下来。
const AUTO_DELAY_MS = 1200;

/** 2026-10-14T02:00:00Z → 10/14 */
function monthDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 分组标题的小标记色。认不出关键词就不上色，不猜。 */
function toneOf(heading) {
  const s = String(heading || "");
  if (/修复|修正|修掉|fix|bug/i.test(s)) return "fix";
  if (/新增|新功能|feature/i.test(s)) return "new";
  if (/优化|改进|调整|提升|improve|perf/i.test(s)) return "tune";
  return "";
}

export function installUpdateNotice({ hana, api, mock = false, log = () => {} } = {}) {
  if (!api?.getUpdateCheck) return null;

  let dialog = null;      // 当前挂着的弹窗节点，同一时刻最多一个
  let closing = null;     // 正在退场、等动效走完再摘的那个
  let closingTimer = null;
  let painter = null;     // 当前弹窗的「重画」入口：结果回来时就地换内容，不换节点
  let manualOpen = false; // 这个弹窗是她自己点开的（而不是自动浮起来的）
  let data = null;        // 最近一次拿到的快照
  let disposed = false;
  let showTimer = null;
  let pollTimer = null;
  let pendingShow = false;
  let stream = null;
  const listeners = new Set();   // 设置页那张「关于」卡片靠它跟着快照刷新

  function openExternal(url) {
    if (!url) return;
    const fallback = () => {
      try { window.open(url, "_blank"); }
      catch { try { hana?.toast?.show?.(`请手动打开：${url}`); } catch {} }
    };
    try {
      const p = hana?.external?.open?.(url);
      if (p && typeof p.catch === "function") p.catch(fallback);
    } catch { fallback(); }
  }

  function dropDialog(node) {
    if (!node) return;
    try { node.close(); } catch {}
    node.remove();
  }

  /** 退场要等多久：直接读 CSS 里那条动效的时长让它成为唯一事实源；读不到就当没有动效。 */
  function exitMs(node) {
    try {
      const parts = String(getComputedStyle(node).animationDuration || "")
        .split(",")
        .map((part) => part.trim())
        .map((part) => (part.endsWith("ms") ? parseFloat(part) : parseFloat(part) * 1000))
        .filter((n) => Number.isFinite(n) && n > 0);
      return parts.length ? Math.min(Math.max(...parts), 600) : 0;
    } catch { return 0; }
  }

  /**
   * 摘掉当前弹窗。
   * animate 只在「用户把它关掉」时给：show() 要换新的一版、页面拆除，都该立刻腾地方。
   * 原生 dialog 一 close 就消失，所以退场得先加个类、等动效走完，再真关。
   */
  function closeDialog({ animate = false } = {}) {
    const node = dialog;
    dialog = null;
    painter = null;
    manualOpen = false;
    // 上一次退场还没走完就又有新动作：直接摘干净，不让两个弹窗叠在一起。
    if (closing) {
      if (closingTimer) { clearTimeout(closingTimer); closingTimer = null; }
      dropDialog(closing);
      closing = null;
    }
    if (!node) return;
    if (!animate) { dropDialog(node); return; }
    node.classList.add("is-closing");
    const ms = exitMs(node);
    if (!ms) { dropDialog(node); return; }   // 动效被系统关掉时（prefers-reduced-motion）就是没有，直接收
    closing = node;
    closingTimer = setTimeout(() => {
      closingTimer = null;
      const done = closing;
      closing = null;
      dropDialog(done);
    }, ms + 40);
  }

  async function settle(action, version) {
    try { await api.dismissUpdate({ action, version, mock }); }
    catch (e) { log(`更新说明状态没存上：${e?.message || e}`); }
  }

  /** 本地先记一笔，免得自己发起的关闭又被下一轮刷新重新弹出来。 */
  function markLocal(action, version) {
    data = {
      ...(data || {}),
      shouldAutoShow: false,
      dismissedThisSession: action === "later" ? true : !!(data && data.dismissedThisSession),
      ackVersion: action === "ack" ? (version || "") : ((data && data.ackVersion) || ""),
    };
  }

  /**
   * 弹窗的壳只建一次，内容按快照重画。
   * 这样「检查更新」可以先弹出、等结果回来就地补内容，不会重播入场动效，也不会闪一下。
   */
  function buildDialog(initial) {
    let view = initial;

    // 「先不看」：关掉，并让别的界面也一起关。
    // 检查中关掉不算「看过」：这时手里还没结果，不该记一笔搪掉下一次提醒。
    const bail = () => {
      const snapshot = view;
      closeDialog({ animate: true });
      if (snapshot.checking) return;
      if (snapshot.hasUpdate && snapshot.latest) {
        const version = snapshot.latest.tag;
        markLocal("later", version);
        void settle("later", version);
      }
    };

    const head = h("div", { className: "tt-update-hd" },
      h("h2", { className: "tt-update-title" }, "检查更新"),
      h("button", { type: "button", className: "tt-update-x", "aria-label": "关闭", onClick: bail }, "×"),
    );

    // tabindex=-1：让弹窗自己能接住初始焦点。不写的话浏览器会把焦点放在
    // 第一个可聚焦的元素上（右上角那个 ×），并给它画一圈系统描边。
    const node = h("dialog", { className: "tt-update-dialog", "aria-label": "检查更新", tabindex: "-1" }, head);

    function paint(snapshot) {
      view = snapshot;
      const hasUpdate = !!snapshot.hasUpdate;
      const failed = !!snapshot.error;
      const checking = !!snapshot.checking;
      const state = checking ? "checking" : failed ? "error" : hasUpdate ? "new" : "current";
      const stateLabel = checking ? "正在检查" : failed ? "检查失败" : hasUpdate ? "有新版本可用" : "已是最新";

      const stateLine = h("p", { className: `tt-update-state ${state}` },
        h("span", { className: "tt-update-dot" }),
        stateLabel,
      );

      const vers = h("div", { className: "tt-update-vers" },
        h("div", {},
          h("span", {}, "当前版本"),
          h("b", {}, `v${snapshot.current || "—"}`),
        ),
        h("div", { className: "tt-update-vr" }),
        h("div", { className: hasUpdate ? "new" : "" },
          h("span", {}, "最新版本"),
          h("b", {}, snapshot.latest ? `v${snapshot.latest.version}` : "—"),
          snapshot.latest && monthDay(snapshot.latest.date) ? h("i", {}, `· ${monthDay(snapshot.latest.date)}`) : null,
        ),
      );

      const body = h("div", { className: "tt-update-body" });
      if (checking && !hasUpdate) {
        body.append(h("p", { className: "tt-update-note" }, "正在向 GitHub 取最新的更新说明…"));
      }
      if (failed) {
        body.append(h("p", { className: "tt-update-note err" },
          hasUpdate ? `取回失败（${snapshot.error}），下面是上次取回的那份。` : `取回失败：${snapshot.error}`));
      }
      // 列的是「更新说明」。自动浮起来（提醒）时只列当前之后的那几版，别拿十来条历史砸她；
      // 她点名打开（「检查更新」/「查看更新说明」）时连已装过的历史一起列——
      // 订阅源里本来就躺着最近十来次，以前已是最新时一条都不显示。
      const history = Array.isArray(snapshot.history) ? snapshot.history : [];
      const list = (manualOpen && history.length ? history : snapshot.notes) || [];
      if (list.length) {
        list.forEach((note) => {
          const groups = (note.sections || []).map((section) => {
            const tone = toneOf(section.heading);
            const kids = [];
            if (section.heading) kids.push(h("h4", {}, section.heading));
            kids.push(h("ul", {}, ...section.items.map((text) => h("li", {}, text))));
            return h("div", { className: `tt-update-grp${tone ? ` ${tone}` : ""}${section.heading ? "" : " bare"}` }, ...kids);
          });
          // 角标：哪一版是她现在装的、哪一版是最新；两个指同一版时只说「当前」，不叠两个。
          const isCurrent = !!snapshot.current && note.version === snapshot.current;
          const isLatest = !!snapshot.latest && note.version === snapshot.latest.version;
          body.append(h("section", { className: "tt-update-ver" },
            h("div", { className: "tt-update-ver-hd" },
              h("b", {}, `v${note.version}`),
              monthDay(note.date) ? h("span", {}, monthDay(note.date)) : null,
              isCurrent ? h("em", { className: "cur" }, "当前") : (isLatest ? h("em", {}, "最新") : null),
            ),
            ...groups,
          ));
        });
      } else if (!failed && !checking) {
        body.append(h("p", { className: "tt-update-note" },
          `当前版本 v${snapshot.current || "—"} 已是最新，没有要看的说明。`));
      }

      const foot = h("div", { className: "tt-update-ft" });
      if (checking) {
        foot.append(h("button", { type: "button", className: "tt-btn primary", onClick: bail }, "关闭"));
      } else if (hasUpdate) {
        foot.append(
          h("button", { type: "button", className: "tt-btn ghost", onClick: () => openExternal(snapshot.releaseUrl) }, "在 GitHub 查看 ↗"),
          h("button", {
            type: "button",
            className: "tt-btn primary",
            onClick: () => {
              const version = snapshot.latest?.tag || "";
              closeDialog({ animate: true });
              markLocal("ack", version);
              void settle("ack", version);
            },
          }, "我已知晓"),
        );
      } else if (failed) {
        foot.append(
          // 重试也先就地翻成「正在检查」，不重建节点，免得弹窗闪一下
          h("button", {
            type: "button",
            className: "tt-btn ghost",
            onClick: () => {
              const seed = view;
              paint({ ...seed, checking: true, error: "" });
              void refresh({ force: true }).then((next) => update(next || { ...seed, checking: false, error: "检查更新失败" }));
            },
          }, "重试"),
          h("button", { type: "button", className: "tt-btn primary", onClick: bail }, "关闭"),
        );
      } else {
        // 已是最新时引导词是「看全部」：这里列的是最近十来条，GitHub 上才是全量。
        if (snapshot.releasesUrl) {
          foot.append(h("button", { type: "button", className: "tt-btn ghost", onClick: () => openExternal(snapshot.releasesUrl) }, "在 GitHub 查看全部 ↗"));
        }
        foot.append(h("button", { type: "button", className: "tt-btn primary", onClick: bail }, "关闭"));
      }

      // 内容区长的时候自己滚过：换内容时别把已经滚到的地方推回顶部。
      const before = node.querySelector(".tt-update-body");
      const keepTop = before ? before.scrollTop : 0;
      node.replaceChildren(head, stateLine, vers, body, foot);
      if (keepTop) body.scrollTop = keepTop;
    }

    // 点背景关闭：必须按坐标判断点落在弹窗外，否则点弹窗自己的留白也会被判成「点背景」。
    // 用 pointerdown 而不是 click：在弹窗里划选文字、手指抬到外面时，click 的落点算在外侧，会误关。
    node.addEventListener("pointerdown", (event) => {
      const rect = node.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) bail();
    });
    // Esc 等同点背景（默认行为会直接关掉，这里拦下来自己走一遍，好把「先不看」记上）。
    node.addEventListener("cancel", (event) => { event.preventDefault(); bail(); });

    paint(initial);
    return { node, paint };
  }

  function show(snapshot, { manual = false } = {}) {
    if (disposed || !snapshot) return;
    clearTimer();
    closeDialog();
    // manualOpen 必须在建节点之前定下来：buildDialog 里就会画第一帧，而那一帧靠它决定
    // 列「新的那几版」还是列全部历史。closeDialog 会把它清成 false，所以顺序不能颠倒。
    manualOpen = manual;
    const built = buildDialog(snapshot);
    dialog = built.node;
    painter = built.paint;
    document.body.appendChild(dialog);
    try { dialog.showModal(); }
    catch { try { dialog.setAttribute("open", ""); } catch {} }
    // 焦点收回到弹窗自己身上（上一步浏览器已经把它给了 ×）。
    try { dialog.focus(); } catch {}
  }

  /** 结果回来了就地换内容：节点不换，所以不会重播入场动效。 */
  function update(snapshot) {
    if (disposed || !snapshot) return;
    if (!dialog || !painter) { show(snapshot, { manual: manualOpen }); return; }
    painter(snapshot);
  }

  function clearTimer() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }

  function scheduleAuto() {
    if (disposed || showTimer || dialog) return;
    // 窄面板（输入栏旁边那个功能面板）里不自动浮：那里一弹就盖掉了聊天。手动打开不受此限。
    try { if (window.innerWidth < 380) return; } catch {}
    if (typeof document !== "undefined" && document.hidden) { pendingShow = true; return; }
    showTimer = setTimeout(() => {
      showTimer = null;
      if (!disposed && !dialog && data?.shouldAutoShow) show(data);
    }, AUTO_DELAY_MS);
  }

  /**
   * 用快照对账：该弹就排上，别的界面真把这次提醒处理掉了才跟着关。
   *
   * 两个条不可或缺：
   *   remote     —— 只有事件流那条路才算「别处说的」；本地的定时轮询不该动她的弹窗。
   *   settled    —— 广播不都是关闭指令。签名里带 checkedAt，她自己那一次检查也会推一条回来，
   *                 那种快照只是「现在是这样」，不是「别人关掉了」。只有确认已处理才收窗。
   *   !manualOpen—— 她自己点开的那个不跟。自动浮起来的是提醒，别处处理了就该收；
   *                 她点名打开来看的东西，不该在她看的时候被抽走。
   */
  function reconcile(snapshot, { allowAuto = true, remote = false } = {}) {
    if (!snapshot || disposed) return;
    data = snapshot;
    for (const fn of listeners) { try { fn(data); } catch {} }
    if (!snapshot.shouldAutoShow) {
      clearTimer();
      pendingShow = false;
      if (remote && dialog && !manualOpen && snapshot.settled) closeDialog({ animate: true });
      return;
    }
    if (allowAuto) scheduleAuto();
  }

  async function refresh({ force = false } = {}) {
    try {
      const snapshot = await api.getUpdateCheck({ force, mock });
      reconcile(snapshot);
      return snapshot;
    } catch (e) {
      log(`检查更新失败：${e?.message || e}`);
      return null;
    }
  }

  /**
   * 「检查更新」：先把弹窗摆出来（这时是「正在检查」），结果回来就地补内容。
   * 不能等网络回来再建弹窗：那样从点击到画面之间会隔着一次 GitHub 往返。
   */
  async function openManual() {
    const seed = data || { current: "", latest: null, hasUpdate: false, notes: [], releaseUrl: "", error: "" };
    const checking = { ...seed, checking: true, error: "" };
    manualOpen = true;
    if (dialog) update(checking); else show(checking, { manual: true });
    const snapshot = await refresh({ force: true });
    update(snapshot || { ...seed, checking: false, error: "检查更新失败" });
    return snapshot;
  }

  /**
   * 「查看更新说明」：永远是「上次检查的结果」，一次网络都不出。
   * 手里还没快照时（刚打开界面、那一次还没回来）向服务端要它存的那份，仍然不出网络；
   * 连那份也没有（从来没检查过）就直说还没检查过，不替她偷偷查一遍。
   */
  async function openCached() {
    manualOpen = true;
    let snapshot = data;
    if (!snapshot) {
      try {
        snapshot = await api.getUpdateCheck({ cached: true, mock });
        if (snapshot) reconcile(snapshot);
      } catch (e) {
        log(`取本地更新说明失败：${e?.message || e}`);
      }
    }
    if (!snapshot) {
      show({
        current: "", latest: null, hasUpdate: false, notes: [], releaseUrl: "", settled: false,
        error: "还没有检查过，先点一次「检查更新」",
      }, { manual: true });
      return null;
    }
    if (dialog) update(snapshot); else show(snapshot, { manual: true });
    return snapshot;
  }

  // 事件流：别的界面点了「我已知晓」或「先不看」，这里要跟着关。
  // token-tracker 那边挂在同一个 App 的 /events（SSE）上。本 App 没有事件流，
  // api.watchEvents 不存在，下面这行会直接抛错落进 catch —— 跨界面同步于是退化成
  // 「打开界面时问一次 + 每 5 分钟轮询一次」。两个界面同时开着的时机很少，为此
  // 给本 App 加一条 SSE 不值当；真要加，把 watchEvents 接上即可，这段代码不用动。
  try {
    const controller = new AbortController();
    stream = controller;
    api.watchEvents({
      signal: controller.signal,
      onEvent: (event) => {
        if (event?.type !== "update" || !event.updateNotice) return;
        reconcile(event.updateNotice, { allowAuto: true, remote: true });
      },
    }).catch(() => {});
  } catch (e) {
    log(`事件流没接上（改用轮询）：${e?.message || e}`);
  }

  pollTimer = setInterval(() => { void refresh(); }, POLL_MS);

  const onVisibility = () => {
    if (disposed || !pendingShow || document.hidden) return;
    pendingShow = false;
    scheduleAuto();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // 打开界面就先看一次（服务端按她设的间隔判，间隔没到就直接用手里那份）。
  void refresh();

  const controller = {
    openManual,
    openCached,
    refresh,
    get data() { return data; },
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      if (data) { try { fn(data); } catch {} }
      return () => listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      clearTimer();
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      try { stream?.abort(); } catch {}
      listeners.clear();
      closeDialog();
    },
  };
  // 界面被拆掉（关卡片、换页）时把事件流与定时器一并收回，不在后台留着。
  function onPageHide() { controller.dispose(); }
  window.addEventListener("pagehide", onPageHide, { once: true });
  return controller;
}
