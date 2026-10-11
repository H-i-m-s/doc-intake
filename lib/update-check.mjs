// 「检查更新」的数据层：把 GitHub Release 的说明取回来，跟本机版本比对，决定该不该提醒。
//
// 这一份是从 magpie-hana 的 lib/update-check.mjs 整文件拷来的（2026-10-11），
// 而 magpie-hana 那份又是从 token-tracker-app 搬来的 —— 三边行为一致。
// 移植时只改了仓库地址、User-Agent 和这几行注释。
// 以后改逻辑请三边一起改，别只改一边（三份的差异用 diff 一眼就能看出来）。
//
// 三件事必须一起看，不然很容易写歪：
//
// 1) 当前版本 = 包根 manifest.json 的 version。
//    本 App 的发版脚本（scripts/release.ps1）已经把 manifest 定为唯一事实源：tag 由它推出
//    （$tag = "v$version"），打包与门禁也校验它，所以这里也只认它。
//    别拿 package.json 或代码里别的版本号来判断，那些跟发出去的版本不是一回事。
//
// 2) 远端说明 = GitHub 的 releases.atom 订阅源，不走 api.github.com。
//    原因实测过：本机出口 IP 的未认证 API 配额会耗到 0（remaining: 0），
//    而更新检查是要长期无人值守跑下去的，压在一个会耗尽的配额上等于早晚静默失效。
//    atom 免配额，一次给出最近若干条 Release 的 tag、时间、链接和渲染好的说明正文（HTML）。
//
// 3) 仓库地址与 scripts/release.ps1 里的 $RepoSlug 是同一个值。改一处要改两处。
//
// 界面里显示的文字一律是纯文本：远端 HTML 只用来切分组和取条目，绝不原样塞进页面。

import fs from "node:fs";
import path from "node:path";

export const REPO_SLUG = "H-i-m-s/doc-intake";
export const ATOM_URL = `https://github.com/${REPO_SLUG}/releases.atom`;
export const RELEASES_URL = `https://github.com/${REPO_SLUG}/releases`;
/** 两次自动检查之间至少隔多久：默认 6 小时。用户在设置页改（单位分钟），存在状态文件里。 */
export const DEFAULT_INTERVAL_MINUTES = 360;
/** 可填范围：一分钟到七天。写入时校验，读取时越界回落默认。 */
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 10080;
/** 弹窗最多列几版历史（订阅源本身只给最近十来条，这里压一道纯粹是防它哪天变多）。 */
const HISTORY_LIMIT = 20;

/** 把任意输入归一成合法的分钟数：整数且在范围内返回它，否则 null。 */
export function normalizeIntervalMinutes(raw) {
  let n;
  if (typeof raw === "number") {
    n = raw;
  } else {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s)) return null;   // 只认十进制整数："1e3"、"3.5"、"abc" 一律拒
    n = Number(s);
  }
  if (!Number.isInteger(n) || n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) return null;
  return n;
}

// ── 纯函数：解析与比较（可单独测，不碰网络也不碰磁盘） ──────────────────────

/** HTML 实体还原。&amp; 必须最后处理，否则 "&amp;lt;" 会被连解两层。 */
export function unescapeEntities(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 去掉所有标签，还原成一行纯文本。表格、链接、加粗一律降级成文字。 */
export function plainText(html) {
  return unescapeEntities(String(html ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** 版本号解析：v8.5.0 / 8.5.0 / 8.5.0-beta.1 都认；认不出返回 null。 */
function parseVersion(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  return { v: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || "" };
}

/** 显示用的版本号：统一成 8.5.0（去掉 v 前缀）。认不出就原样返回。 */
export function displayVersion(raw) {
  const p = parseVersion(raw);
  return p ? p.v.join(".") : String(raw ?? "").trim();
}

/**
 * 版本比较：a 小于 b 返回 -1，相等 0，大于 1；任一侧认不出返回 null。
 * 同一个号里，正式版高于它的预发布版（8.5.0 > 8.5.0-beta.1）。
 */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.v[i] !== y.v[i]) return x.v[i] < y.v[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * 说明正文（GitHub 渲染好的 HTML）→ 分组条目。
 *
 * 约定：写 release notes 时用三级标题分组（### 新增 / ### 优化 / ### 修复），
 * 认得出就按标题切组；认不出就是一组无标题条目，不报错也不丢内容。
 * 二级标题（## …）与弹窗标题重复，丢掉；
 * <hr> 之后按惯例是附带说明（安装指引之类），那是给 Release 页看的，也丢掉。
 */
export function parseNotesHtml(html) {
  let body = String(html ?? "");
  const hr = body.search(/<hr\b/i);
  if (hr >= 0) body = body.slice(0, hr);

  const sections = [];
  let current = null;
  const open = (heading) => { current = { heading, items: [] }; sections.push(current); };

  const blockRe = /<(h2|h3|ul|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(body))) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === "h2") continue;
    if (tag === "h3") { open(plainText(inner)); continue; }
    const items = tag === "ul"
      ? [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => plainText(x[1]))
      : [plainText(inner)];
    const kept = items.filter(Boolean);
    if (!kept.length) continue;
    if (!current) open("");
    current.items.push(...kept);
  }

  // 头部被丢掉之后剩下的零散文本（有些 notes 直接以段落开头）也算一组。
  if (!sections.length) {
    const rest = plainText(body);
    if (rest) sections.push({ heading: "", items: [rest] });
  }
  return sections;
}

/** 从 release 链接里取 tag：…/releases/tag/v8.5.0 → v8.5.0 */
function tagFromLink(link) {
  const m = /\/releases\/tag\/([^/?#]+)/.exec(String(link ?? ""));
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * atom 订阅源 → release 列表。认不出 tag 的条目直接跳过：宁可少一条，也不猜一个版本号出来。
 * 返回按版本从新到旧排好。
 */
export function parseAtom(xml) {
  const out = [];
  const entries = String(xml ?? "").match(/<entry\b[\s\S]*?<\/entry>/g) || [];
  for (const entry of entries) {
    const tagNode = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(entry);
    const title = plainText(tagNode ? tagNode[1] : "");
    const linkMatch = /<link\b[^>]*href="([^"]*)"/i.exec(entry);
    const url = unescapeEntities(linkMatch ? linkMatch[1] : "");
    const dateNode = /<(?:updated|published)\b[^>]*>([\s\S]*?)<\/(?:updated|published)>/i.exec(entry);
    const date = plainText(dateNode ? dateNode[1] : "");
    const contentNode = /<content\b[^>]*>([\s\S]*?)<\/content>/i.exec(entry);
    const html = unescapeEntities(contentNode ? contentNode[1] : "");

    const tag = tagFromLink(url) || (/v?\d+\.\d+\.\d+/.exec(title) || [""])[0];
    const parsed = parseVersion(tag);
    if (!parsed) continue;

    out.push({
      tag,
      version: parsed.v.join("."),
      pre: parsed.pre,
      title,
      date,
      url,
      sections: parseNotesHtml(html),
    });
  }
  out.sort((a, b) => (compareVersions(b.tag, a.tag) ?? 0));
  return out;
}

/** 取回失败时给界面一句人话，别把 ENOTFOUND 直接扔出去。 */
export function humanizeFetchError(error) {
  const code = String(error?.cause?.code || error?.code || "");
  const message = String(error?.message || error || "");
  // 这几条是 App 运行时的出站闸门在说话，跟「网线掉了」是两回事，得分开讲。
  if (code === "PLUGIN_NETWORK_NOT_DECLARED" || code === "ERR_ACCESS_DENIED") return "这个版本没有出站网络权限";
  if (code === "PLUGIN_NETWORK_RESPONSE_TOO_LARGE") return "更新说明太长，超过单次取回上限";
  if (/HOST_NOT_ALLOWED|NOT_ALLOWED/i.test(code)) return "github.com 不在本版本声明的网络白名单里";
  if (/abort/i.test(String(error?.name || ""))) return "请求超时";
  if (/HTTP 403|HTTP 429/.test(message)) return "GitHub 暂时拒绝了这次请求";
  if (/HTTP 5\d\d/.test(message)) return "GitHub 那边出了点问题";
  if (/HTTP \d/.test(message)) return message;
  if (["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)) return "网络不通";
  return "取回更新说明失败";
}

// ── 状态层：一份文件装偏好与缓存，内存里另存「本次会话先不看」 ──────────────

const DEFAULT_STATE = Object.freeze({ enabled: true, ackVersion: "", intervalMinutes: DEFAULT_INTERVAL_MINUTES, fetchedAt: 0, releases: [] });

function normalizeState(raw) {
  const out = { ...DEFAULT_STATE };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
    if (typeof raw.ackVersion === "string") out.ackVersion = raw.ackVersion;
    const minutes = normalizeIntervalMinutes(raw.intervalMinutes);
    if (minutes !== null) out.intervalMinutes = minutes;
    if (Number.isFinite(raw.fetchedAt)) out.fetchedAt = Number(raw.fetchedAt);
    if (Array.isArray(raw.releases)) out.releases = raw.releases.filter((r) => r && typeof r.tag === "string");
  }
  return out;
}

export function createUpdateCheck({
  dataDir = "",
  appVersion = "",
  repoSlug = REPO_SLUG,
  log = () => {},
  // 默认不给通道：App 子进程没开 --allow-net，裸 fetch 出站会被运行时直接拒掉，
  // 而这个拒绝在 JS 侧只表现为一句空洞的「fetch failed」。要联网必须由调用方
  // 显式传入宿主受控通道（ctx.network.fetch），不配就老老实实说没有网络能力。
  fetchImpl = null,
  now = () => Date.now(),
} = {}) {
  const file = dataDir ? path.join(dataDir, "update-notice.json") : "";

  // 读取永远反映落盘的最新值，不缓存副本：写入很稀疏，这点 IO 不值得换来一份会过期的状态。
  function read() {
    if (!file) return { ...DEFAULT_STATE, releases: [] };
    try {
      if (!fs.existsSync(file)) return { ...DEFAULT_STATE, releases: [] };
      return normalizeState(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")));
    } catch (e) {
      log("warn", `更新说明状态读取失败，按默认处理：${e?.message || e}`);
      return { ...DEFAULT_STATE, releases: [] };
    }
  }

  // 原子写：tmp + rename，避免读到写了一半的文件。只覆盖传进来的字段。
  function write(patch) {
    const next = { ...read(), ...(patch || {}) };
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, file);
      } catch (e) {
        log("warn", `更新说明状态写入失败：${e?.message || e}`);
      }
    }
    return next;
  }

  // 「点背景 / 点 ×」只记在内存里：App 进程一重启（下一次打开 App）它就没了，
  // 于是新会话里还会再提醒一次。这是「先不看」与「我已知晓」的区别所在。
  let sessionDismissed = "";

  function pickLatest(releases) {
    let latest = null;
    for (const r of releases) {
      if (r.pre) continue;                       // 预发布版不当作「最新」
      if (compareVersions(r.tag, appVersion) === null) continue;
      if (!latest || (compareVersions(r.tag, latest.tag) ?? 0) > 0) latest = r;
    }
    return latest;
  }

  /** 界面要的那几格：去掉内部字段（title / pre 之类），只留渲染用得上的。 */
  const summaryOf = (r) => ({ version: r.version, tag: r.tag, date: r.date, url: r.url, sections: r.sections });

  /** 当前版本之后、最新版本（含）之间的说明，从新到旧。落多个版本时弹窗里就堆这几条。 */
  function notesFor(releases, latest) {
    if (!latest) return [];
    return releases
      .filter((r) => !r.pre
        && (compareVersions(r.tag, appVersion) ?? -1) > 0
        && (compareVersions(r.tag, latest.tag) ?? 1) <= 0)
      .sort((a, b) => (compareVersions(b.tag, a.tag) ?? 0));
  }

  /**
   * 历史：订阅源里所有正式版（不含预发布），从新到旧，已经装过的那些也在里面。
   * 界面靠它做到「已是最新时也有东西可看」——不然点开「查看更新说明」只有一句
   * 「没有要看的说明」，而订阅源里明明躺着最近十来次的说明。
   * 注意它包含比当前版本新的那几版（notes 是它的子集），所以有新版时用 notes、
   * 平时用 history，两边不要拼在一起，否则同一版会出现两次。
   */
  function historyFor(releases) {
    return releases
      .filter((r) => !r.pre)
      .sort((a, b) => (compareVersions(b.tag, a.tag) ?? 0))
      .slice(0, HISTORY_LIMIT);
  }

  function view(state, { error = "", checkedAt = 0, fromCache = true } = {}) {
    const releases = Array.isArray(state.releases) ? state.releases : [];
    const latest = pickLatest(releases);
    const hasUpdate = !!latest && (compareVersions(latest.tag, appVersion) ?? 0) > 0;
    const notes = hasUpdate ? notesFor(releases, latest) : [];
    const acked = hasUpdate && state.ackVersion && (compareVersions(state.ackVersion, latest.tag) ?? -1) >= 0;
    const dismissed = hasUpdate && sessionDismissed && (compareVersions(sessionDismissed, latest.tag) ?? -1) >= 0;
    return {
      current: displayVersion(appVersion),
      latest: latest ? { version: latest.version, tag: latest.tag, date: latest.date, url: latest.url, title: latest.title } : null,
      hasUpdate,
      notes: notes.map(summaryOf),
      // 全量历史（含已经装过的版本）：界面在「已是最新」时列它，有新版时列 notes。
      history: historyFor(releases).map(summaryOf),
      releaseUrl: (latest && latest.url) || `https://github.com/${repoSlug}/releases`,
      releasesUrl: `https://github.com/${repoSlug}/releases`,
      checkedAt,
      error,
      fromCache,
      enabled: state.enabled !== false,
      intervalMinutes: state.intervalMinutes,
      ackVersion: state.ackVersion || "",
      dismissedThisSession: !!dismissed,
      // 要不要自动浮起来：开关开着、有新版、这个版本没被「已知晓」过、也没被「先不看」过。
      shouldAutoShow: state.enabled !== false && hasUpdate && !acked && !dismissed,
      // 这次提醒是不是已经被处理过了（已跳晓 / 先不看）。界面靠它分辨「别的界面处理掉了」
      // 和「例行检查发回来的新快照」——后者不是关闭指令。
      settled: !!(acked || dismissed),
    };
  }

  /**
   * 拉一次订阅源。检查间隔由用户定（状态里的 intervalMinutes），所以挂在扫描事件上
   * 随便调也不会把 GitHub 问爆；间隔没到就直接用手里那份。force 绕过间隔。
   * 失败不清缓存：手里的旧说明比一片空白有用。
   */
  async function fetchReleases({ force = false } = {}) {
    const state = read();
    const intervalMs = state.intervalMinutes * 60 * 1000;
    const fresh = state.fetchedAt > 0 && state.releases.length > 0 && now() - state.fetchedAt < intervalMs;
    if (!force && fresh) return { releases: state.releases, checkedAt: state.fetchedAt, error: "", fromCache: true };

    if (typeof fetchImpl !== "function") {
      return { releases: state.releases, checkedAt: state.fetchedAt, error: "当前环境没有网络能力", fromCache: true };
    }
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      // 不带 If-None-Match。条件请求看着划算，实际上走不通：宿主的受控通道拿不到 200–599
      // 之外的状态码时会造 Response 失败，上游的 304 会直接抛成「取回失败」，把每次
      // 后续检查都变成失败。省这一次请求的代价太高，节流交给本地那个检查间隔。
      const headers = { "User-Agent": `doc-intake/${displayVersion(appVersion) || "0"}`, Accept: "application/atom+xml" };
      const res = await fetchImpl(`https://github.com/${repoSlug}/releases.atom`, { headers, signal: ctrl?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const releases = parseAtom(await res.text());
      if (!releases.length) throw new Error("订阅源里没有认得出的 Release");
      write({ releases, fetchedAt: now() });
      return { releases, checkedAt: now(), error: "", fromCache: false };
    } catch (e) {
      // 通道表示不了 304：反序列化时造 Response 会抛（"Invalid response status code 304"）。
      // 但 304 的语义本来就是「没变」，手里那份缓存就是它想要的结果，不必当失败。
      if (/Invalid response status code 30\d/.test(String(e?.message || e)) && state.releases.length) {
        write({ fetchedAt: now() });
        return { releases: state.releases, checkedAt: now(), error: "", fromCache: true };
      }
      const code = e?.cause?.code || e?.code || "";
      log("warn", `更新说明取回失败：${e?.message || e}${code ? `（${code}）` : ""}`);
      return { releases: state.releases, checkedAt: state.fetchedAt, error: humanizeFetchError(e), fromCache: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 给界面的一份完整快照。force 由「检查更新」按钮触发。 */
  async function check({ force = false } = {}) {
    const got = await fetchReleases({ force });
    // 直接用这一次取到的那一份，不从磁盘再读一遍。fetchReleases 里那次 write 只是
    // 落盘持久化，成败不影响这一次的结果；要是拿它当唯一来源，磁盘一写不进去，
    // 界面就会拿到一份空快照，还理直气壮地说「已是最新」——那是静默谎话。
    const state = read();
    const merged = got.releases.length
      ? { ...state, releases: got.releases, fetchedAt: got.checkedAt || state.fetchedAt }
      : state;
    return view(merged, { error: got.error, checkedAt: got.checkedAt, fromCache: got.fromCache });
  }

  /** 不联网，用手里已有的数据给快照（打开弹窗、跨界面同步时用）。 */
  function snapshot() {
    const state = read();
    return view(state, { checkedAt: state.fetchedAt, fromCache: true });
  }

  function setEnabled(enabled) {
    write({ enabled: enabled !== false });
    return snapshot();
  }

  /** 改自动检查的间隔（分钟）。非法值明确抛错，不静默换成默认值。 */
  function setIntervalMinutes(minutes) {
    const value = normalizeIntervalMinutes(minutes);
    if (value === null) {
      throw Object.assign(
        new Error(`检查间隔要填 ${MIN_INTERVAL_MINUTES} 到 ${MAX_INTERVAL_MINUTES} 之间的整数分钟数`),
        { code: "INVALID_INTERVAL" },
      );
    }
    write({ intervalMinutes: value });
    return snapshot();
  }

  /** mode "read" = 我已知晓（落盘，直到下个版本）；"later" = 先不看（只在本次会话内存里）。 */
  function dismiss(version, mode) {
    const tag = String(version || "").trim();
    if (!tag) return snapshot();
    if (mode === "read") {
      const state = read();
      if (!state.ackVersion || (compareVersions(tag, state.ackVersion) ?? 1) > 0) write({ ackVersion: tag });
    } else {
      if (!sessionDismissed || (compareVersions(tag, sessionDismissed) ?? 1) > 0) sessionDismissed = tag;
    }
    return snapshot();
  }

  /** 供广播用的一行签名：只有它变了才值得推一次事件给界面。 */
  function signature(snap = snapshot()) {
    return [snap.enabled ? 1 : 0, snap.ackVersion, snap.intervalMinutes, sessionDismissed,
      snap.latest ? snap.latest.tag : "", snap.checkedAt].join("|");
  }

  return { check, snapshot, setEnabled, setIntervalMinutes, dismiss, signature, _internal: { read, write, view } };
}
