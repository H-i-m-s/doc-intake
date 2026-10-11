// SPDX-License-Identifier: MPL-2.0
//
// release/market.mjs — Hana 市场的规矩，以及投稿这个动作本身。
//
// 市场改了规矩（附件命名、条目大小上限、tag 字符集、批准记录格式、PR 正文要求），
// 只改这个文件。投稿全程走 GitHub API，本地不留市场仓库的副本。

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { step, info, warn, die } from "./console.mjs";
import { ghApi, ghApiJson, run, runRetry, classify, sleepSync } from "./exec.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// 市场规矩：对所有插件都一样，不放进 config.json。
// 市场改了规矩，只改这一段。
// ─────────────────────────────────────────────────────────────────────────────
export const MARKET = {
  /** 正本仓库（维护者所有）。PR 提到这里。 */
  upstream: "liliMozi/hana-marketplace",
  /** 正本的分支。 */
  upstreamBranch: "main",
  /** 登记文件与批准文件。 */
  registryFile: "registry.json",
  approvalsFile: "approvals.json",
  /** 分支命名：每个插件一个固定分支，每次从正本最新提交重置。 */
  branchPrefix: "enroll/",
  /** entry 附件的字节上限（同步器的 MAX_ENTRY_BYTES），超了整批同步失败。 */
  maxEntryBytes: 512 * 1024,
  /** tag 允许的字符集（同步器的 TAG_RE）。 */
  tagPattern: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/,
  /** 批准记录只允许这四个键（同步器 exactKeys 校验）。 */
  sha256Pattern: /^[0-9a-f]{64}$/,
};

// ─────────────────────────────────────────────────────────────────────────────
// 市场侧：全程 GitHub API，本地不留市场仓库的副本
// ─────────────────────────────────────────────────────────────────────────────
const forkOf = (publisher) => `${publisher}/hana-marketplace`;
const branchOf = (id) => `${MARKET.branchPrefix}${id}`;

/** 正本上游 main 的最新提交 sha。 */
function upstreamHeadSha() {
  const result = ghApi(`repos/${MARKET.upstream}/git/ref/heads/${MARKET.upstreamBranch}`, { jq: ".object.sha" });
  const sha = result.status === 0 ? result.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw die(`读不到 ${MARKET.upstream} 的 ${MARKET.upstreamBranch} 最新提交`);
  return sha;
}

/**
 * 让 fork 的主分支追上正本，返回它现在的 sha。
 *
 * GitHub 只允许 fork 的 ref 指向「从 fork 自己可达」的提交。fork 落后于正本时，在 fork 上
 * 拿正本 HEAD 当父提交建出来的 commit 会被拒收 —— PATCH refs/heads/... 直接 404。
 * 实测四个对照：fork 自己的 main ✓、分支当前值 ✓、正本 main ✗、以正本 HEAD 为父的新 commit ✗。
 * 所以落提交之前，先把 fork 的主分支同步过来，用它当父提交。
 *
 * 已经是最新时 GitHub 返回 409，那是正常分支，不是失败。
 */
function syncForkToUpstream(fork, expectedSha) {
  const branch = MARKET.upstreamBranch;
  const endpoint = `repos/${fork}/merge-upstream`;

  let result = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = ghApi(endpoint, { method: "POST", body: { branch }, acceptNonZero: true });
    if (result.status === 0) break;
    if (attempt === 3 || classify(result.stderr + result.stdout) !== "transient") break;
    warn(`同步 ${fork} 的 ${branch} 遇到网络类失败，${[1, 4][attempt - 1]} 秒后重试`);
    sleepSync([1000, 4000][attempt - 1]);
  }

  if (result.status !== 0) {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!/HTTP 409|\bnot behind\b|up to date/i.test(text)) {
      // 正本里带着 .github/workflows/，所以这一步需要 workflow 权限；缺了会被明确拒绝。
      const hint = /workflow/i.test(text)
        ? "gh 的 token 缺 workflow 权限（正本里有 .github/workflows/）。跑一次 `gh auth refresh -s workflow` 再来"
        : "确认这个 fork 还在、且与正本同源";
      const detail = text.trim().split("\n").slice(0, 3).join("\n      ");
      throw die(`同步 ${fork} 的 ${branch} 失败\n      ${detail}`, hint);
    }
    info(`fork 的 ${branch} 已经是最新，无需同步`);
  }

  const head = ghApi(`repos/${fork}/git/ref/heads/${branch}`, { jq: ".object.sha" });
  const sha = head.status === 0 ? head.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw die(`同步之后仍然读不到 ${fork} 的 ${branch}`, "确认这个 fork 的状态");
  if (expectedSha && sha !== expectedSha) {
    warn(`fork 的 ${branch}（${sha.slice(0, 8)}）与正本（${expectedSha.slice(0, 8)}）不一致，以 fork 的为准落提交`);
  }
  return sha;
}

/** 读正本某个文件在某个 ref 上的原文。 */
function readUpstreamFile(path, ref) {
  const result = ghApi(`repos/${MARKET.upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`, { jq: ".content" });
  if (result.status !== 0) throw die(`读不到 ${MARKET.upstream}/${path}`, "确认网络和仓库可访问");
  return Buffer.from(result.stdout.replace(/\s/g, ""), "base64").toString("utf8");
}

/**
 * 读市场正本已发布的索引（index.v2.json），找出自己这一条。
 *
 * 三种返回值：
 *   { unavailable: true, reason }   读不到（没网 / 没权限 / 索引坏了）
 *   { missing: true }               市场里还没有这一条 —— 首次登记
 *   { version, archive, repository } 已发布的那一条
 *
 * 判「版本倒退」就该用它：市场同步器判的也正是这个值 —— 它的 previous.version 取自
 * index.v2.json 里那一条的 version，而那个 version 来自上一次的 entry.json（再往前是
 * 那一次的 manifest.json）。
 *
 * 跟 git tag 没有关系。tag 只是 Release 的地址，谁都能随手打一个；拿 tag 当版本序列，
 * 会把「改了 release/ 顺手打个新 tag、却没打算发新版」这种合法的重发拦下来。
 *
 * 这里刻意不用 readUpstreamFile：那个函数读不到就 die，而 die 会立刻打印一行 [停]，
 * 调用方想放行也收不回去了。读不到只是「查不了」，交给调用方决定拦还是放。
 */
export function readPublishedItem(ctx) {
  const head = ghApi(`repos/${MARKET.upstream}/git/ref/heads/${MARKET.upstreamBranch}`, { jq: ".object.sha" });
  if (head.status !== 0) return { unavailable: true, reason: `读不到 ${MARKET.upstream} 的 HEAD` };
  const sha = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) return { unavailable: true, reason: `HEAD 不是提交 sha：${sha.slice(0, 40)}` };

  // 必须走 raw（而不是默认的 base64 content 字段）：index.v2.json 现在 2.6 MB，每条目都内嵌
  // 一张 data URI 图标，早就超过了 contents API 的 1 MB 内联上限 —— 超了它会给 content: ""，
  // 解出来就是空串，报「Unexpected end of JSON input」。
  const file = ghApi(`repos/${MARKET.upstream}/contents/index.v2.json?ref=${encodeURIComponent(sha)}`, {
    headers: ["Accept: application/vnd.github.raw"],
    acceptNonZero: true,
    label: `gh api GET ${MARKET.upstream}/index.v2.json`,
  });
  if (file.status !== 0) return { unavailable: true, reason: `读不到 ${MARKET.upstream}/index.v2.json（gh 退出码 ${file.status}）` };

  let index;
  try {
    index = JSON.parse(file.stdout);
  } catch (e) {
    return { unavailable: true, reason: `index.v2.json 解析失败：${(e && e.message) || e}` };
  }

  const items = Array.isArray(index && index.items) ? index.items : [];
  const item = items.find((it) => it && it.kind === ctx.kind && it.id === ctx.id);
  if (!item) return { missing: true };
  return {
    version: String(item.version || ""),
    archive: item.archive || null,
    repository: String(item.repository || ""),
  };
}

/** 把登记和批准改好；返回 { registry, approvals, changed, addedEnrollment, changedEnrollment }。 */
function planMarketEdit(registryText, approvalsText, ctx, config) {
  const registry = JSON.parse(registryText);
  const approvals = JSON.parse(approvalsText);
  if (!Array.isArray(registry.entries)) throw die("registry.json 结构不对：entries 不是数组");
  if (!Array.isArray(approvals.approvals)) throw die("approvals.json 结构不对：approvals 不是数组");

  const same = (a, b) => a.kind === b.kind && a.id === b.id;

  // 名录：没有就加，已有的不一致就改；一致就一个字不碰。
  let addedEnrollment = false;
  let changedEnrollment = false;
  const enrolled = registry.entries.find((e) => same(e, ctx));
  if (!enrolled) {
    registry.entries.push({ kind: ctx.kind, id: ctx.id, repository: config.releaseRepo, publisher: config.publisher });
    addedEnrollment = true;
  } else if (enrolled.repository !== config.releaseRepo || enrolled.publisher !== config.publisher) {
    enrolled.repository = config.releaseRepo;
    enrolled.publisher = config.publisher;
    changedEnrollment = true;
  }

  // 批准：每次都要改。
  let changedApproval = false;
  const record = approvals.approvals.find((a) => same(a, ctx));
  if (!record) {
    approvals.approvals.push({ kind: ctx.kind, id: ctx.id, tag: ctx.tag, sha256: ctx.sha256 });
    changedApproval = true;
  } else if (record.tag !== ctx.tag || record.sha256 !== ctx.sha256) {
    record.tag = ctx.tag;
    record.sha256 = ctx.sha256;
    changedApproval = true;
  }

  return {
    registry,
    approvals,
    addedEnrollment,
    changedEnrollment,
    changedApproval,
    changed: addedEnrollment || changedEnrollment || changedApproval,
  };
}

/** 在 fork 上落一个提交，并让分支指向它。全程 API。 */
function pushMarketCommit(fork, branch, baseSha, baseTreeSha, files, message) {
  const entries = [];
  for (const { path, content } of files) {
    const blob = ghApiJson(`repos/${fork}/git/blobs`, { method: "POST", body: { content, encoding: "utf-8" } });
    if (!blob?.sha) throw die(`在 ${fork} 上创建 blob 失败（${path}）`);
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const tree = ghApiJson(`repos/${fork}/git/trees`, { method: "POST", body: { base_tree: baseTreeSha, tree: entries } });
  if (!tree?.sha) throw die("创建 tree 失败");

  const commit = ghApiJson(`repos/${fork}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [baseSha] } });
  if (!commit?.sha) throw die("创建 commit 失败");

  const refPath = `repos/${fork}/git/ref/heads/${branch}`;
  const existing = ghApi(refPath, { acceptNonZero: true });
  if (existing.status === 0) {
    const patched = ghApi(`repos/${fork}/git/refs/heads/${branch}`, { method: "PATCH", body: { sha: commit.sha, force: true } });
    if (patched.status !== 0) throw die(`更新分支 ${branch} 失败`);
  } else {
    const created = ghApi(`repos/${fork}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
    if (created.status !== 0) throw die(`创建分支 ${branch} 失败`);
  }
  return commit.sha;
}

/** 拼 PR 正文。 */
function buildPrBody(config, ctx, changeNote) {
  const repoUrl = `https://github.com/${config.releaseRepo}`;
  const releaseUrl = `${repoUrl}/releases/tag/${ctx.tag}`;
  const rawBase = `https://raw.githubusercontent.com/${config.releaseRepo}/${encodeURIComponent(ctx.tag)}`;
  const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

  const capabilities = Array.isArray(ctx.manifest.capabilities) ? ctx.manifest.capabilities : [];

  const lines = [];
  lines.push("## 投稿信息 / Submission", "");
  lines.push(`- 扩展名称 / Extension name: ${ctx.name}`);
  lines.push(`- 类型与 ID / Kind and ID: app / ${ctx.id}`);
  lines.push(`- 发布者 / Publisher: ${config.publisher}`);
  lines.push(`- 用途与主要功能 / Purpose and main features: ${ctx.manifest.description || "（见仓库 README）"}`);
  lines.push(`- 作者仓库 / Author repository: ${repoUrl}`);
  lines.push(`- 正式 Release / Stable Release: ${releaseUrl}`);
  lines.push(`- 本次登记或变更说明 / Enrollment or registration change: ${changeNote}`);
  lines.push("");

  lines.push("## 图标预览 / Icon preview", "");
  if (ctx.manifest.icon) lines.push(`![icon](${rawBase}/${encodePath(ctx.manifest.icon)})`);
  else lines.push("（无图标）");
  lines.push("");

  lines.push("## 截图或演示 / Screenshots or demo", "");
  if (ctx.screenshots.length) {
    for (const shot of ctx.screenshots) {
      lines.push(`![${shot}](${rawBase}/release/pr-assets/${encodeURIComponent(shot)})`);
    }
  } else {
    // 截图是可选的：没放就不提，也不留「（待补）」拖得像个未完成的坑。
    lines.push("（本版未附截图；截图不是必填项）");
  }
  lines.push("");

  lines.push("## 自测报告 / Author test report", "");
  // 正常情况下 ctx.selfTest 已经由模板渲染好了（见 publish.mjs 的 renderSelfTest）。
  // 走到这个分支意味着 release/自测.md 不存在或没内容 —— 那也会把 PR 开成 draft。
  lines.push(ctx.selfTest || "（release/自测.md 不存在或没有内容；补上后重跑即可，PR 也会变成正式）");
  lines.push("");

  lines.push("## 权限与外部服务 / Permissions and external services", "");
  lines.push(`- 声明能力 / Capabilities: ${capabilities.length ? capabilities.join(", ") : "无"}`);
  lines.push(`- 为什么需要 / Why: ${config.capabilityNotes || "每项能力只用于读本机数据，或读取自己仓库 Release 里的更新说明；详见仓库自测报告。"}`);
  lines.push("- 外部服务 / External services: GitHub（git / gh CLI）");
  lines.push("");

  lines.push("## 投稿检查 / Enrollment checklist", "");
  lines.push("- [x] 本 PR 仅修改登记数据；未提交源码、安装包或截图文件。");
  lines.push("- [x] 作者仓库已有正式 Release，包含匹配的条目 JSON 和 ZIP。");
  lines.push("- [x] 登记的 kind、id、publisher 与条目一致。");
  lines.push("- [x] `approvals.json` 中的 tag 指向该 Release，sha256 照抄自条目 JSON 的 `archive.sha256`。");
  lines.push("- [x] 未手动编辑生成的 `index.v2.json`。");
  // 这一节的勾选是投稿人自述，脚本只是把它写进 PR 正文。截图不是必填项，所以只在真放了图
  // 的那次才把「图片已检查敏感信息」捎上；没图时提它反而像缺了一件东西。
  const picBit = ctx.screenshots.length ? "，图片已检查敏感信息" : "（截图非必填，本版未附）";
  lines.push(`- [x] 已填写审阅材料，不适用或未测试的部分已注明${picBit}。`);
  return lines.join("\n") + "\n";
}

export function marketStage(config, ctx, args) {
  step("投稿到市场");
  const fork = forkOf(config.publisher);
  const branch = branchOf(ctx.id);

  // 只有一种情况还算「材料不齐」：自测报告是空的。截图是可选材料，有就带上、没有就不提，
  // 没有理由因此把 PR 降级成草案。
  const missing = [];
  if (!ctx.selfTest) missing.push("release/自测.md 不存在或没有内容");
  const draft = missing.length > 0;

  // 读正本的内容：权威在正本，与 fork 落不落后无关。
  const upSha = upstreamHeadSha();
  const registryText = readUpstreamFile(MARKET.registryFile, upSha);
  const approvalsText = readUpstreamFile(MARKET.approvalsFile, upSha);
  const edit = planMarketEdit(registryText, approvalsText, ctx, config);

  if (!edit.changed) {
    info("市场登记和批准都已经是最新的，跳过提 PR");
    const existingPr = ghApiJson(`repos/${MARKET.upstream}/pulls?head=${encodeURIComponent(config.publisher)}:${encodeURIComponent(branch)}&state=open`);
    if (Array.isArray(existingPr) && existingPr[0]) ctx.prUrl = existingPr[0].html_url;
    return;
  }

  if (args.dryRun) {
    info(`[干跑] 会${edit.addedEnrollment ? "新增名录" : edit.changedEnrollment ? "修改名录" : "不动名录"}、${edit.changedApproval ? "更新批准" : "不动批准"}`);
    info(`[干跑] 会先把 ${fork} 的 ${MARKET.upstreamBranch} 追上正本 ${upSha.slice(0, 8)}，再写到 ${branch}，PR 提到 ${MARKET.upstream}`);
    info(`[干跑] PR 会开成 ${draft ? `draft（材料还缺：${missing.join("；")}）` : "正式（材料齐）"}`);
    return;
  }

  // fork 的 ref 只接受「从 fork 自己可达」的提交；落后时拿正本 HEAD 当父提交会被 GitHub 拒收。
  // 先把 fork 的主分支同步到正本，再拿它当底座 —— 这样 PR 正好也开在最新底座上。
  const baseSha = syncForkToUpstream(fork, upSha);
  const baseCommit = ghApiJson(`repos/${fork}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit?.tree?.sha;
  if (!baseTreeSha) throw die(`在 ${fork} 上找不到提交 ${baseSha.slice(0, 8)}`, "确认 fork 还在、且和正本同源");
  info(`基线 ${MARKET.upstream}@${upSha.slice(0, 8)} → fork@${baseSha.slice(0, 8)}`);

  const files = [
    { path: MARKET.registryFile, content: JSON.stringify(edit.registry, null, 2) + "\n" },
    { path: MARKET.approvalsFile, content: JSON.stringify(edit.approvals, null, 2) + "\n" },
  ];

  const changeBits = [];
  if (edit.addedEnrollment) changeBits.push("首次登记");
  if (edit.changedEnrollment) changeBits.push("登记信息有变更");
  if (edit.changedApproval) changeBits.push(`更新到 ${ctx.tag}`);
  const changeNote = `${changeBits.join("；")}。${ctx.notes ? "\n\n" + ctx.notes : ""}`;
  const message = `${edit.addedEnrollment || edit.changedEnrollment ? "enroll" : "approve"}: app/${ctx.id} ${ctx.tag}`;
  const body = buildPrBody(config, ctx, changeNote);

  if (draft) warn(`PR 会开成 draft，材料还缺：${missing.join("；")}`);

  pushMarketCommit(fork, branch, baseSha, baseTreeSha, files, message);
  info(`已提交到 ${fork}:${branch}`);

  const title = message;
  const pr = ghApiJson(`repos/${MARKET.upstream}/pulls`, {
    method: "POST",
    body: { title, head: `${config.publisher}:${branch}`, base: MARKET.upstreamBranch, body, ...(draft ? { draft: true } : {}) },
    acceptNonZero: true,
  });
  if (pr?.html_url) {
    ctx.prUrl = pr.html_url;
    info(draft ? `PR 已创建（draft，材料补齐后点 Ready for review）：${pr.html_url}` : `PR 已创建：${pr.html_url}`);
    return;
  }

  const existing = ghApiJson(`repos/${MARKET.upstream}/pulls?head=${encodeURIComponent(config.publisher)}:${encodeURIComponent(branch)}&state=open`);
  if (Array.isArray(existing) && existing[0]) {
    ctx.prUrl = existing[0].html_url;
    warn("这个分支已经有一个开着的 PR，没有重复创建");
    info(`已有 PR：${ctx.prUrl}`);
    return;
  }
  throw die("创建 PR 失败", "看看上面 gh 的报错，必要时手工到网页上开 PR");
}

/** 可选：用市场自带的同步器复核自己那一条。 */
export function verifyStage(config, ctx) {
  step("复核（市场自带同步器）");
  const baseSha = upstreamHeadSha();

  const dir = mkdtempSync(join(tmpdir(), "gsl-verify-"));
  try {
    const syncPath = join(dir, "extension-market-sync.mjs");
    const registryPath = join(dir, "registry.json");
    const approvalsPath = join(dir, "approvals.json");
    writeFileSync(syncPath, readUpstreamFile("scripts/extension-market-sync.mjs", baseSha), "utf8");
    writeFileSync(registryPath, readUpstreamFile(MARKET.registryFile, baseSha), "utf8");
    writeFileSync(approvalsPath, readUpstreamFile(MARKET.approvalsFile, baseSha), "utf8");

    const token = run("gh", ["auth", "token"]).stdout.trim();
    const result = runRetry(
      process.execPath,
      [syncPath, "--discover", "--registry", registryPath, "--approvals", approvalsPath],
      { label: "market-sync --discover", env: token ? { GITHUB_TOKEN: token } : {} },
    );
    const out = `${result.stdout}\n${result.stderr}`;
    const mine = out.split("\n").find((l) => l.includes(`app/${ctx.id} `) && l.includes("approvals.json record:"));
    if (!mine) {
      warn("同步器没有为这个扩展提出批准记录（可能：Release 还不是最新的正式 Release，或市场那边已经是最新）");
      return;
    }
    const json = mine.slice(mine.indexOf("record: ") + "record: ".length).trim();
    let proposed;
    try {
      proposed = JSON.parse(json);
    } catch {
      warn(`解析同步器的输出失败：${json}`);
      return;
    }
    if (proposed.sha256 !== ctx.sha256) {
      throw die(`同步器算出的 sha256 是 ${proposed.sha256}，本地是 ${ctx.sha256}`, "两边不一致说明包不对，别提交");
    }
    info(`同步器复核通过：${proposed.tag} · sha256 一致`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

