// SPDX-License-Identifier: MPL-2.0
//
// release/publish.mjs — 出包 / 发版 / 投稿 的编排引擎（零依赖，只用 Node 内置模块 + git / gh）。
//
// 它是唯一干活的地方：ship.ps1 只是它的窗户，也可以直接被命令行或别的程序调用。
//
// 用法：
//   node release/publish.mjs --mode=pack                      只出包
//   node release/publish.mjs --mode=release  --version=3.2.1 --notes="- 修复xxx"
//   node release/publish.mjs --mode=publish  --version=3.2.1 --notes-file=notes.md
//   加 --dry-run  只做本地和只读检查，不写 manifest、不提交、不打 tag、不发 Release、不建 PR
//   加 --verify   投稿前用市场自带的同步器复核自己那一条（需要联网，默认关）
//   加 --skip-version-write  不把版本号写回 manifest.json（此时两者必须已经一致）
//
// 三步的含义：
//   pack    写版本号 + 出包到 dist/，不联网、不碰 git
//   release pack + 提交打 tag 推送 + 在 GitHub 建 Release
//   publish release + 在市场仓库提一个登记 PR（全程 GitHub API，本地不落市场仓库的副本）
//
// 阶段顺序固定：配置 → 预检 → 写入版本号 → 出包 → 提交并打 tag → 发 Release → 投稿。
// 版本号必须排在出包前面，因为 zip 和 entry 的文件名里都带着它，三种模式都一样。
//
// 每一步都是幂等的：Release 已存在且附件一致就跳过；approvals 里已经是这个 tag + sha256
// 就跳过提 PR；分支已存在就直接更新到新提交。所以中途失败可以原样重跑，不会重复发布。
//
// 出错只重试"可能已经成功但没收到回执"的那一类（DNS / 连接中断 / 5xx）。认证失败、事实错误
// （版本号字符违规、条目超限、sha 不一致）一律立刻停下并说明原因。细则见 release/投稿规范.md。
//
// 这个文件只放编排：命令行参数、配置与清单、七阶段流程、main。其余三头在
//   release/console.mjs   终端输出与带着原因退出
//   release/exec.mjs      调 git / gh，失败分类与退避重试
//   release/market.mjs    市场的规矩与投稿动作

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir, homedir, platform, arch, release as osRelease, version as osVersion } from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { say, step, info, warn, die } from "./console.mjs";
import { run, runRetry, git, gh, gitQuiet, classify, sleepSync } from "./exec.mjs";
import { MARKET, marketStage, readPublishedItem, verifyStage } from "./market.mjs";

const RELEASE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(RELEASE_DIR, "..");

// ─────────────────────────────────────────────────────────────────────────────
// 自测报告：模板与事实
// ─────────────────────────────────────────────────────────────────────────────
/** pr-assets/ 里的图，按文件名排序。目录不在就是空。 */
function listScreenshots(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .sort();
}

/** 从 zip 末尾的 EOCD 读条目数；读不到返回 null。 */
function readZipEntryCount(zipPath) {
  const buf = readFileSync(zipPath);
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return buf.readUInt16LE(i + 10);
  }
  return null;
}

/** Hana 自己的版本。它在 HANA_HOME（或用户目录的 .hanako）下的 last-update-version 里。 */
function readHanaVersion() {
  const home = process.env.HANA_HOME || join(homedir(), ".hanako");
  try {
    return readFileSync(join(home, "last-update-version"), "utf8").trim();
  } catch {
    return "";
  }
}

/** 一句话描述当前系统，给自测报告用。 */
function describeOs() {
  const name = osVersion(); // 例如 Windows 11 Pro
  const build = osRelease(); // 例如 10.0.26200
  const kind = platform() === "win32" ? "NT" : platform();
  return `${name} ${arch()}（${kind} ${build}）`;
}

/** 渲染自测报告模板时能自动填的值。要加新占位符，在这里加一项。 */
function collectFacts(config, ctx) {
  const n = (v) => (v === null || v === undefined ? "" : String(v));
  return {
    version: n(ctx.effectiveVersion || ctx.version),
    tag: n(ctx.tag),
    repo: n(config.releaseRepo),
    releaseUrl: `https://github.com/${config.releaseRepo}/releases/tag/${ctx.tag}`,
    date: new Date().toISOString().slice(0, 10),
    hanaVersion: n(readHanaVersion()),
    os: describeOs(),
    sha256: n(ctx.sha256),
    sha256short: n(ctx.sha256 ? ctx.sha256.slice(0, 16) : ""),
    zipEntries: n(ctx.zipEntries),
    zipKiB: n(ctx.zipSize ? (ctx.zipSize / 1024).toFixed(1) : ""),
    tests: n(ctx.selfcheck?.tests),
    jsfiles: n(ctx.selfcheck?.files),
  };
}

/** 把 {{key}} 换成 facts 里的值。不认识的键原样留着，并报给调用方。 */
function renderTemplate(text, facts) {
  const unknown = new Set();
  const out = String(text || "").replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(facts, key)) return String(facts[key] ?? "");
    unknown.add(key);
    return whole;
  });
  return { text: out, unknown: [...unknown] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 配置与清单
// ─────────────────────────────────────────────────────────────────────────────
function loadConfig() {
  const path = join(RELEASE_DIR, "config.json");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw die(`读不到或解析不了 release/config.json：${(e && e.message) || e}`, "确认 release/config.json 存在且是合法 JSON");
  }
  const missing = [];
  if (raw.schema !== 1) missing.push("schema 必须是 1");
  if (typeof raw.publisher !== "string" || !raw.publisher.trim()) missing.push("publisher 必须是非空字符串");
  if (!raw.release || typeof raw.release.repo !== "string" || !/^[^\s/]+\/[^\s/]+$/.test(raw.release.repo)) {
    missing.push("release.repo 必须是 owner/repo 形式");
  }
  if (missing.length) {
    throw die(`release/config.json 有问题：\n      ${missing.join("\n      ")}`, "补齐后再跑一次");
  }
  // pack 的排除表也要读：预检要用它判断「这个改动会不会进包」。
  // 不在这里报 pack.mjs 那些类型错误 —— 出包那一步会拦住的，这里只需要一组能用的集合。
  const pack = raw.pack && typeof raw.pack === "object" ? raw.pack : {};
  const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

  return {
    publisher: raw.publisher.trim(),
    defaultBranch: typeof raw.defaultBranch === "string" && raw.defaultBranch ? raw.defaultBranch : "master",
    releaseRepo: raw.release.repo.trim(),
    releaseTitle: typeof raw.release.title === "string" && raw.release.title ? raw.release.title : null,
    packOut: pack.out && typeof pack.out === "string" ? pack.out : "dist",
    packExclude: {
      dirs: new Set(strList(pack.excludeDirs)),
      names: new Set(strList(pack.excludeNames)),
      prefixes: strList(pack.excludePrefixes),
      suffixes: strList(pack.excludeSuffixes),
      extensions: new Set(strList(pack.excludeExtensions).map((e) => e.replace(/^\./, "").toLowerCase())),
    },
  };
}

/**
 * 这条仓库内的路径会不会进包？判定与 pack.mjs 的 collect() 一致：
 *   - 任何一段目录名命中 pack.excludeDirs 就不进包（pack.mjs 从仓库根往下，每一层目录都查这张表）
 *   - 文件名再过 excludeNames / excludePrefixes / excludeSuffixes / excludeExtensions 四张表
 *   - 输出目录（pack.out）永远不进包
 *
 * 语义必须跟 pack.mjs 对齐：这里判错，预检就会拦一个其实不会进包的改动，或者放过一个会进包的。
 */
function isPackagedPath(config, relPath) {
  const p = String(relPath || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!p) return false;
  const parts = p.split("/").filter(Boolean);
  if (!parts.length) return false;

  const ex = config.packExclude;
  if (parts.some((seg) => ex.dirs.has(seg))) return false;

  const outDir = String(config.packOut || "dist")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (outDir && (p === outDir || p.startsWith(`${outDir}/`))) return false;

  const name = parts[parts.length - 1];
  if (ex.names.has(name)) return false;
  if (ex.prefixes.some((pre) => name.startsWith(pre))) return false;
  if (ex.suffixes.some((suf) => name.endsWith(suf))) return false;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && ex.extensions.has(name.slice(dot + 1).toLowerCase())) return false;
  return true;
}

function readManifestText() {
  const path = join(ROOT, "manifest.json");
  if (!existsSync(path)) throw die("找不到 manifest.json", "在仓库根目录跑这个脚本");
  return readFileSync(path, "utf8");
}

function parseManifest(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw die(`manifest.json 解析失败：${(e && e.message) || e}`, "修好 manifest.json 再跑");
  }
}

/** 只替换顶层那个 "version" 字段，不动文件其余部分的排版。 */
function replaceVersionField(text, version) {
  const re = /"version"\s*:\s*"([^"]*)"/;
  const match = re.exec(text);
  if (!match) throw die('manifest.json 里找不到 "version" 字段', "手工确认 manifest.json 的结构");
  return text.slice(0, match.index) + `"version": "${version}"` + text.slice(match.index + match[0].length);
}

// ─────────────────────────────────────────────────────────────────────────────
// 版本比较（够用的语义化比较，忽略预发布后缀）
// ─────────────────────────────────────────────────────────────────────────────
function versionParts(value) {
  const core = String(value).trim().replace(/^v/, "").split(/[-+]/)[0];
  return core.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口参数
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(rawArgv) {
  // 允许 --key=value 和 --key value 两种写法。
  //
  // 这里不用正则。之前那版是 /^--([A-Za-z][A-Za-z-]*)=(.*)$/，少了 s 标志，
  // 而正则里的 . 默认不匹配换行——所以 --notes= 一旦带上多行内容，整条就不匹配，
  // 被原样丢进 argv，最后报出来的是「不认识的参数：--notes=…」。
  // 报错指向参数名，真正的毛病在值的换行里，绕很远才看得出来。
  // 拆 --k=v 只需要找第一个等号，indexOf 不会漏，也没有标志位可漏。
  const argv = [];
  for (const a of rawArgv) {
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    // eq > 2：等号至少在第三位，参数名才不会为空（-- 本身占两位）
    if (eq > 2) argv.push(a.slice(0, eq), a.slice(eq + 1));
    else argv.push(a);
  }
  const args = { mode: null, version: null, notes: "", notesFile: null, dryRun: false, verify: false, skipVersionWrite: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--version") args.version = argv[++i];
    // trim 是为了跟 --notes-file 那条对齐（那边有 readFileSync(...).trim()）。
    // 少了它，--notes 末尾多一个换行、多一个空格，就会跟走文件那条路生成的说明不一样。
    else if (a === "--notes") args.notes = (argv[++i] ?? "").trim();
    else if (a === "--notes-file") args.notesFile = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verify") args.verify = true;
    else if (a === "--skip-version-write") args.skipVersionWrite = true;
    else throw die(`不认识的参数：${a}`, "可用：--mode --version --notes --notes-file --dry-run --verify --skip-version-write");
  }
  if (!["pack", "release", "publish"].includes(args.mode)) {
    throw die(`--mode 必须是 pack / release / publish，收到 ${JSON.stringify(args.mode)}`);
  }
  if (args.notesFile) {
    const p = resolve(process.cwd(), args.notesFile);
    if (!existsSync(p)) throw die(`--notes-file 不存在：${p}`);
    args.notes = readFileSync(p, "utf8").trim();
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// 各阶段
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 确认 gh 真的能认证。
 *
 * 不用 `gh auth status`：它自己也要联网，网络一抖它就报“令牌失效”，
 * 与真实情况不符。改成打一次需要令牌的接口，网络问题和认证问题就分得开了。
 */
function requireGhAuth(config) {
  for (let attempt = 1; ; attempt += 1) {
    const r = run("gh", ["api", "user", "--jq", ".login"]);
    if (r.status === 0) {
      info(`gh 已登录为 ${r.stdout.trim()}，目标仓库 ${config.releaseRepo}`);
      return;
    }
    const detail = (r.stderr || r.stdout).trim().split("\n").slice(0, 3).join("\n      ");
    const kind = classify(r.stderr + r.stdout);
    if (kind === "transient" && attempt < 3) {
      warn(`gh 认证检查第 ${attempt} 次没通（网络类），${attempt} 秒后重试`);
      sleepSync(1000 * attempt);
      continue;
    }
    if (kind === "transient") {
      throw die(`连不上 GitHub，没法确认 gh 登录状态\n      ${detail}`, "检查网络或代理，然后重跑；网络不稳定时重跑即可，前面做好的不会白做");
    }
    if (kind === "rate") {
      throw die(`GitHub 限速，没法确认登录状态\n      ${detail}`, "设一个只读的 GITHUB_TOKEN，或过一会儿再跑");
    }
    throw die(`gh 未登录或令牌已失效\n      ${detail}`, "运行 gh auth refresh -h github.com，或 gh auth login");
  }
}

/**
 * 重跑同一版时，tag 不会动，刚补的截图并不在它指向的提交里 —— 而 PR 正文用的是
 * raw.githubusercontent 的钉 tag 链接，引用不在 tag 里的图就是一个 404 的破图。
 * 宁可这次不带图，也不发一份带破图的正文。放在预检里，干跑也能提前看到。
 */
function dropScreenshotsNotInTag(ctx) {
  if (!ctx.tagExisted || !ctx.screenshots.length) return;
  const inTag = new Set(
    gitQuiet(["ls-tree", "-r", "--name-only", ctx.tag, "--", "release/pr-assets"])
      .stdout.split("\n")
      .map((l) => l.trim().split("/").pop())
      .filter(Boolean),
  );
  const absent = ctx.screenshots.filter((s) => !inTag.has(s));
  if (!absent.length) return;
  warn(`这几张截图不在 tag ${ctx.tag} 里，PR 正文会跳过它们（引用过去是破图）：${absent.join("、")}`);
  info(`要让图跟着上，把版本号提一个（比如 ${bumpPatch(ctx.version)}）重发一版`);
  ctx.screenshots = ctx.screenshots.filter((s) => inTag.has(s));
}

/** S2 预检：只读，不改任何东西。 */
function preflight(config, ctx, args) {
  step("预检");
  // 只打包完全不碰 gh，也就没必要要求登录。
  const needsGh = args.mode !== "pack";
  const gates = [];

  for (const tool of needsGh ? ["git", "gh", "node"] : ["git", "node"]) {
    if (run(tool, ["--version"]).status !== 0) gates.push(`找不到 ${tool}`);
  }

  if (needsGh) requireGhAuth(config);

  if (gitQuiet(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
    throw die("当前目录不是 git 仓库");
  }

  const branch = gitQuiet(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (branch !== config.defaultBranch) {
    throw die(`当前分支是 ${branch}，config 里写的是 ${config.defaultBranch}`, `先切到 ${config.defaultBranch} 再发版`);
  }

  if (args.mode !== "pack") {
    // 干净检查只认「会进包的文件」。
    //
    // 这条检查要保证的是「包里的东西都提交过了」，所以不进包的文件（release/、doc/、dist/、
    // 出包排除表里的一切）改没改都不应该影响发版 —— 拿整个工作区当判据会误拦。
    // 排除表直接读 config.json 的 pack 段，跟 pack.mjs 用同一套规则（见 isPackagedPath）。
    //
    // 额外豁免 manifest.json：脚本自己会改它，并且会替你把这一次提交做掉。
    //
    // 干跑也照样查、照样拦。干跑的意义是「真跑会发生什么」的预演，跳过一道会拦人的闸，
    // 预演就成了假话。要中途随便改代码还能跑通，用 --mode=pack（它本来就不看工作区）。
    const lines = gitQuiet(["-c", "core.quotepath=false", "status", "--porcelain"])
      .stdout.split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
    const dirty = [];
    for (const line of lines) {
      const flag = line.slice(0, 2).trim() || "??";
      const rest = line.slice(3);
      // 重命名写成 "旧 -> 新"，两边都要判：新路径会在包里，旧路径可能还在
      const paths = rest.includes(" -> ") ? rest.split(" -> ") : [rest];
      for (const p of paths) {
        const rel = p.trim().replace(/^"|"$/g, "");
        if (rel === "manifest.json") continue;
        if (!isPackagedPath(config, rel)) continue;
        dirty.push(`${flag}  ${rel}`);
        break;
      }
    }
    if (dirty.length) {
      throw die(
        `会进包的文件有未提交的改动，发版前请先处理：\n      ${dirty.slice(0, 10).join("\n      ")}`,
        args.dryRun
          ? "先把这些改动提交或撤销；干跑也照实拦，因为真跑到这一步同样会停"
          : "先把要发的代码提交推送，再发版；脚本只会替你把版本号那一次提交做掉",
      );
    }
  }

  if (gates.length) throw die(gates.join("；"));

  // 版本相关
  if (args.mode !== "pack") {
    if (!MARKET.tagPattern.test(ctx.tag)) {
      throw die(`tag ${ctx.tag} 含不允许的字符`, "tag 只能用字母、数字、. _ + -，且以字母或数字开头");
    }
    // 已经打过这个 tag 怎么办？
    // 这里只提醒，不拦。理由是「同一个 tag」不等于「同一份包」：改动 release/ 这类不进包的
    // 文件也会动 HEAD，拿提交相不相等当判据会误伤合法的重跑。
    // 真正的硬约束在 releaseStage：发 Release 前拿远端附件的 sha256 跟本地现算的比，对不上就停。
    const head = gitQuiet(["rev-parse", "HEAD"]).stdout.trim();
    const noteExistingTag = (where, sha) => {
      if (!sha) return;
      const at = sha === head ? "指向当前提交" : `指向 ${sha.slice(0, 8)}，而当前 HEAD 是 ${head.slice(0, 8)}`;
      warn(`${where}已有 tag ${ctx.tag}（${at}）—— 按“重跑这一版”处理，包是不是同一份由后面的 sha256 比对决定`);
    };

    const localTag = gitQuiet(["rev-parse", "-q", "--verify", `refs/tags/${ctx.tag}`]);
    if (localTag.status === 0) noteExistingTag("本地", gitQuiet(["rev-list", "-n", "1", ctx.tag]).stdout.trim());
    ctx.tagExisted = localTag.status === 0;

    // 远端有没有这个 tag，必须问清楚，不能把“查不到”当成“没有”：
    // 网络抖一下就放行，会带着一个推不上去的 tag 和提交继续发版。
    // 用带重试的 git（不是 gitQuiet）：先给网络三次机会，仍不通就中止。
    // 没有 origin 的纯本地仓库是另一回事，那种情况跳过。
    if (run("git", ["remote", "get-url", "origin"]).status === 0) {
      const remote = git(["ls-remote", "--tags", "origin", `refs/tags/${ctx.tag}`]);
      const lines = remote.stdout.trim().split("\n").filter(Boolean);
      // annotated tag 会多一行 <sha> refs/tags/x^{}（解引用后的提交），优先取它
      const pick = lines.find((l) => l.endsWith("^{}")) || lines.find((l) => l.endsWith(`refs/tags/${ctx.tag}`));
      noteExistingTag("远端", pick ? pick.split(/\s+/)[0] : "");
    } else {
      warn("这个仓库没有 origin 远端，跳过远端 tag 检查");
    }

    dropScreenshotsNotInTag(ctx);

    // 版本方向：拿「要发的版本」比「市场已发布的版本」。
    //
    // 比的是版本号本身。要发的那个来自 manifest.json（它随后会被写进 entry.json，
    // packStage 会再断一次 entry.version 等于它）；市场已发布的那个来自 index.v2.json，
    // 也就是上一次的 entry.json 里的 version。两个数都是「版本号」，不是 git tag。
    //
    // 不再看 git tag：tag 只是 Release 的地址，谁都能随手打一个。之前拿本地 tag 的最高值
    // 当「现有版本」，会把「改了 release/ 顺手打了个新 tag、却没打算发新版」这种合法的重发
    // 拦下来 —— 而市场那边根本不会因此拒绝（它比的是 entry 的 version）。
    //
    // 读不到市场时不拦：真倒退了市场那边还会再判一次，在这里因为联网失败拦住一次合法的
    // 发布更糟。
    const published = readPublishedItem(ctx);
    if (published.unavailable) {
      warn(`没读到市场已发布的版本，跳过版本方向检查：${published.reason}`);
      info("真倒退了市场那边还会再判一次；这里是读到不到，不当成倒退");
    } else if (published.missing) {
      info(`市场里还没有 ${ctx.kind}/${ctx.id} 这一条，按首次登记处理（不比版本）`);
    } else if (published.version && compareVersions(ctx.version, published.version) < 0) {
      throw die(
        `要发的 ${ctx.version} 比市场已发布的 ${published.version} 还低`,
        "市场不允许版本倒退，把 manifest.json 的版本号提到比它高再发",
      );
    } else {
      info(`版本方向没问题：市场已发布 ${published.version}，本次要发 ${ctx.version}`);
    }

    const existingRelease = run("gh", ["release", "view", ctx.tag, "--repo", config.releaseRepo, "--json", "assets"]);
    if (existingRelease.status === 0) {
      let assets = [];
      try {
        assets = JSON.parse(existingRelease.stdout).assets || [];
      } catch {
        assets = [];
      }
      ctx.existingRelease = { exists: true, assets };
      info(`远端已有 Release ${ctx.tag}（附件 ${assets.length} 个），稍后会核对内容决定是否跳过`);
    }
  }

  info(`分支 ${branch} · 版本 ${ctx.version} · tag ${ctx.tag}`);
}

/**
 * S1 写入版本号。必须排在出包之前：zip 和 entry 的文件名里都带着版本号。
 * 干跑时只预告不改文件，此时包仍按 manifest 里现有的版本出，effectiveVersion 记的就是这个值。
 */
function writeVersion(config, ctx, args) {
  step("写入版本号");
  const text = readManifestText();
  const manifest = parseManifest(text);

  if (args.dryRun) {
    ctx.effectiveVersion = manifest.version;
    info(`[干跑] 会把 manifest.json 改成 ${ctx.version}；本次不改，包仍按 ${manifest.version} 出`);
    return;
  }

  if (args.skipVersionWrite) {
    if (manifest.version !== ctx.version) {
      throw die(
        `--skip-version-write 下 manifest.json 是 ${manifest.version}，但你要发 ${ctx.version}`,
        "去掉 --skip-version-write，或先把 manifest.json 改成目标版本",
      );
    }
    ctx.effectiveVersion = manifest.version;
    info("按参数跳过写入");
    return;
  }

  if (manifest.version !== ctx.version) {
    writeFileSync(join(ROOT, "manifest.json"), replaceVersionField(text, ctx.version), "utf8");
    info(`manifest.json 版本号 ${manifest.version} → ${ctx.version}`);
  } else {
    info(`manifest.json 已经是 ${manifest.version}`);
  }
  ctx.effectiveVersion = ctx.version;
}

/** S3 出包。 */
function packStage(config, ctx) {
  step("出包");
  // 用 run 不用 runRetry：pack.mjs 是纯本地的，失败就是本地失败，重试只会再跑一遍自检、
  // 白等几秒，还会把「自检没过」这种已经确定的事伪装成网络抖动。重试层留给 git / gh。
  //
  // 要 pack.mjs 额外吐一行 selfcheck 的数字：自测报告要用，正好同一趟自检不重跑。
  const result = run(process.execPath, [join(RELEASE_DIR, "pack.mjs")], { env: { RELEASE_PACK_REPORT: "1" } });
  process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr.trim()) process.stdout.write(result.stderr);
  if (result.status !== 0) throw die("出包失败", "看上面 pack.mjs 的输出；自检没过也会走到这里");

  const ver = ctx.effectiveVersion || ctx.version;
  const distDir = resolve(ROOT, config.packOut);
  ctx.zipPath = join(distDir, `${ctx.id}-v${ver}.zip`);
  ctx.entryPath = join(distDir, `app-${ctx.id}-${ver}.entry.json`);
  if (!existsSync(ctx.zipPath)) throw die(`出包后找不到 ${relative(ROOT, ctx.zipPath)}`, "看 pack.mjs 的输出");
  if (!existsSync(ctx.entryPath)) throw die(`出包后找不到 ${relative(ROOT, ctx.entryPath)}`, "看 pack.mjs 的输出");

  const entry = JSON.parse(readFileSync(ctx.entryPath, "utf8"));
  ctx.entry = entry;

  // 事实只认当场从包里算出来的。entry 里那份、dist 里那个 .sha256 副文件，都只是小票；
  // 小票与包对不上时必须停下，别把错的 sha256 登记进市场（那要整个 PR 重来）。
  const zipBytes = readFileSync(ctx.zipPath);
  const zipSha256 = createHash("sha256").update(zipBytes).digest("hex");
  if (entry.archive.sha256 !== zipSha256) {
    throw die(
      `entry 里写的 sha256 和 zip 现算的对不上\n      entry：${entry.archive.sha256}\n      现算：${zipSha256}`,
      "包在出包之后被改动过，原样重跑一次；还不行就是 pack.mjs 的问题",
    );
  }
  if (entry.archive.size !== zipBytes.length) {
    throw die(`entry 里写的字节数与 zip 实际不符：entry ${entry.archive.size}，实际 ${zipBytes.length}`);
  }
  ctx.sha256 = zipSha256;
  ctx.zipSize = zipBytes.length;

  if (!MARKET.sha256Pattern.test(ctx.sha256)) throw die(`算出来的 sha256 不合法：${ctx.sha256}`);
  if (entry.publisher !== config.publisher) {
    throw die(`entry 的 publisher 是 ${entry.publisher}，config 里是 ${config.publisher}`, "两者必须一致，市场按 publisher 校验身份");
  }
  if (entry.id !== ctx.id || entry.version !== ver) {
    throw die(`entry 身份不对：${entry.id}@${entry.version}，预期 ${ctx.id}@${ver}`);
  }

  const entryBytes = statSync(ctx.entryPath).size;
  if (entryBytes > MARKET.maxEntryBytes) {
    throw die(`市场条目有 ${entryBytes} 字节，超过上限 ${MARKET.maxEntryBytes}`, "大头通常是 manifest.icon 内联 base64，先压那张图再出包");
  }
  info(`zip ${(ctx.zipSize / 1024).toFixed(1)} KiB · entry ${entryBytes} 字节 · sha256 ${ctx.sha256.slice(0, 16)}…`);

  // 自检数字从 pack.mjs 刚吐的那行里拿，不重跑一遍。
  const reportLine = result.stdout.split("\n").find((l) => l.startsWith("[pack] selfcheck-report "));
  if (reportLine) {
    try {
      ctx.selfcheck = JSON.parse(reportLine.slice("[pack] selfcheck-report ".length));
    } catch {
      /* 拿不到就不填，占位符会留空 */
    }
  }
  ctx.zipEntries = readZipEntryCount(ctx.zipPath);

  // 渲染自测报告。排在 sha256 / 条目数都算完之后，因为模板里会引用它们。
  renderSelfTest(config, ctx);
}

/** 把 release/自测.md 这份模板渲染成 PR 正文里那段。占位符填不上就原样留着，并在日志里点名。 */
function renderSelfTest(config, ctx) {
  if (!ctx.selfTestTemplate) {
    ctx.selfTest = "";
    return;
  }
  // 模板开头那段 HTML 注释是写给维护者的说明，不进 PR 正文。
  const body = ctx.selfTestTemplate.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  const facts = collectFacts(config, ctx);
  const { text, unknown } = renderTemplate(body, facts);
  ctx.selfTest = text;

  // 只对「模板里真正用到的」占位符报空值。facts 里有些键是这个插件本来就没有的
  // （比如 gsl 的自检不算测试用例数），模板没引用它们就不该吵。
  const used = new Set((body.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.slice(2, -2)));
  const blank = [...used].filter((k) => Object.prototype.hasOwnProperty.call(facts, k) && facts[k] === "");
  if (unknown.length) warn(`release/自测.md 里有不认识的占位符，已原样保留：${unknown.map((k) => `{{${k}}}`).join("、")}`);
  if (blank.length) warn(`自测报告里有几项没填上，正文里会留空：${blank.map((k) => `{{${k}}}`).join("、")}`);

  // 兜底：不管写成什么形状的花括号，只要读完了还剩着，就是写错了（或用了没有的键）。
  // 上面只报得出 {{单词}} 那种；{{带 空格}}、{{带-连字符}} 会绕过它，那种错更悄。
  const leftovers = [...new Set((ctx.selfTest.match(/\{\{[^}]*\}\}/g) || []))];
  if (leftovers.length) warn(`自测报告里还有没被替换的花括号，检查一下拼写：${leftovers.join("、")}`);

  info(`自测报告已从 release/自测.md 渲染（${ctx.selfTest.length} 字）`);
  // 想看一眼到底会写成什么，把 RELEASE_DEBUG 打开。
  if (process.env.RELEASE_DEBUG) say(`\n───── 自测报告预览 ─────\n${ctx.selfTest}\n───────────────────────`);
}

/** S4：提交版本号、打 tag、推送。 */
function commitAndTag(config, ctx, args) {
  step("提交并打 tag");

  if (args.dryRun) {
    info("[干跑] 跳过 git add / commit / tag / push");
    return;
  }

  // 截图跟着一起提交。PR 正文用 raw.githubusercontent 的链接引用它，而那个链接钉在 tag 上，
  // 所以图必须先在 tag 指向的这个提交里，否则正文里是个 404 的破图。
  // 提交在打 tag 之前，顺序不能反。
  const commitPaths = ["manifest.json", "release/pr-assets"].filter((p) => existsSync(join(ROOT, p)));
  const staged = gitQuiet(["status", "--porcelain", "--", ...commitPaths]).stdout.trim();
  if (staged) {
    git(["add", "--", ...commitPaths]);
    git(["commit", "-m", `chore(release): ${ctx.tag}`]);
    info(`提交 chore(release): ${ctx.tag}`);
  } else {
    info("manifest.json 与截图都没有变化，跳过提交");
  }

  // tag 可能已经打过了：上一次发到一半（Release 发了、投稿没做成）重跑时会走到这里。
  // 不用 -f 去覆盖：git tag 默认就拒绝覆盖，顺着它来。这个 tag 已经对外存在，
  // 一旦它指向的提交和现在这批代码不同，-f 会把它悄悄挪走，那比报错麻烦得多。
  const tagExisted = gitQuiet(["rev-parse", "-q", "--verify", `refs/tags/${ctx.tag}`]).status === 0;
  if (tagExisted) {
    info(`tag ${ctx.tag} 已存在，跳过打 tag`);
  } else {
    git(["tag", ctx.tag]);
    info(`打 tag ${ctx.tag}`);
  }

  git(["push", "origin", config.defaultBranch]);
  git(["push", "origin", ctx.tag]);
  info(`已推送到 origin/${config.defaultBranch} 和 ${ctx.tag}`);
}

/** 版本号末位加一，只为在提示里举一个例子。形如 8.6.0 → 8.6.1。 */
function bumpPatch(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return `${version} 的下一版`;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** S5 发 Release。 */
function releaseStage(config, ctx, args) {
  step("发布 Release");

  if (ctx.existingRelease?.exists) {
    const byName = new Map(ctx.existingRelease.assets.map((a) => [a.name, a]));
    const remoteZip = byName.get(`${ctx.id}-v${ctx.version}.zip`);
    const remoteEntry = byName.get(ctx.entryName);
    if (!remoteZip || !remoteEntry) {
      throw die(`远端已有 Release ${ctx.tag}，但附件对不上`, "先删掉那个 Release，或者换一个版本号");
    }

    // digest 是 GitHub 存着的 "sha256:<hex>"，拿出来跟本地现算的那个比 —— 这样「重跑」是
    // 真的幂等：同一份包才跳过，包不一样就停。老版本 gh 或老 Release 可能没这个字段，
    // 那种情况退回只比字节数（比只看文件名强，但不如 digest）。
    const remoteZipSha = String(remoteZip.digest || "").replace(/^sha256:/, "");
    if (remoteZipSha && remoteZipSha !== ctx.sha256) {
      throw die(
        `远端 Release ${ctx.tag} 上的 zip 和本地刚出的不是同一份\n      远端 ${remoteZipSha}\n      本地 ${ctx.sha256}`,
        "删掉远端那个 Release 重发，或者换一个版本号",
      );
    }
    const localEntryBytes = statSync(ctx.entryPath).size;
    const localEntrySha = createHash("sha256").update(readFileSync(ctx.entryPath)).digest("hex");
    // 条目要比内容，不能只比字节数。digest 是 GitHub 存着的 "sha256:<hex>"。
    // 只比字节数的话，同长度的改动会被当成同一份：比如 publisher 从 H-i-M-s 写成 H-i-m-s，
    // 一个字符的大小写，字节数分毫不差 —— 于是这里判「一致」、跳过重传，远端那个错的条目
    // 就永远留在 Release 上，而市场恰好是拿它来校验身份的。
    const remoteEntrySha = String(remoteEntry.digest || "").replace(/^sha256:/, "");
    if (remoteEntrySha) {
      if (remoteEntrySha !== localEntrySha) {
        throw die(
          `远端 Release ${ctx.tag} 上的条目和本地刚出的不是同一份\n      远端 ${remoteEntrySha}\n      本地 ${localEntrySha}`,
          "删掉远端那个 Release 重发，或者换一个版本号",
        );
      }
    } else if (remoteEntry.size !== localEntryBytes) {
      throw die(
        `远端 Release ${ctx.tag} 上的条目和本地刚出的不是同一份（远端 ${remoteEntry.size} 字节，本地 ${localEntryBytes} 字节）`,
        "删掉远端那个 Release 重发，或者换一个版本号",
      );
    } else {
      warn(`远端条目没有 digest，只比了字节数（${localEntryBytes}）：同长度但内容不同的条目会比不出来，必要时人工核对`);
    }

    info(`Release ${ctx.tag} 已存在，附件与本地一致，跳过`);
    ctx.releaseSkipped = true;
    return;
  }

  if (args.dryRun) {
    info(`[干跑] 跳过 gh release create ${ctx.tag}`);
    return;
  }

  const notesDir = mkdtempSync(join(tmpdir(), "gsl-notes-"));
  const notesFile = join(notesDir, "notes.md");
  const notesText = `${ctx.notes ? ctx.notes + "\n\n" : ""}---\n\n安装：下载附件 zip 拖入 HanaAgent 设置 → 插件；或从市场更新。\n`;
  writeFileSync(notesFile, notesText, "utf8");

  const title = config.releaseTitle ? config.releaseTitle.replace(/\{tag\}/g, ctx.tag).replace(/\{name\}/g, ctx.name) : `${ctx.name} ${ctx.tag}`;
  info(`上传 ${relative(ROOT, ctx.zipPath)} 和 ${ctx.entryName} …`);
  try {
    gh(["release", "create", ctx.tag, ctx.zipPath, ctx.entryPath, "--repo", config.releaseRepo, "--title", title, "--notes-file", notesFile]);
  } finally {
    rmSync(notesDir, { recursive: true, force: true });
  }
  info(`Release ${ctx.tag} 已创建`);
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = loadConfig();
  const manifest = parseManifest(readManifestText());

  const ctx = {
    kind: "app",
    id: manifest.id,
    name: manifest.name || manifest.id,
    manifest,
    version: args.version || manifest.version,
    notes: args.notes,
    screenshots: [],
  };
  if (!ctx.id) throw die("manifest.json 缺 id");

  // 标题跟着插件走，不写死：整个 release/ 是要整目录复制到别的插件去的。
  step(`${ctx.name} 发布 · 模式 ${args.mode}${args.dryRun ? " · 干跑" : ""}`);

  ctx.version = String(ctx.version).trim().replace(/^v/, "");
  ctx.effectiveVersion = manifest.version;
  if (!/^\d+\.\d+\.\d+/.test(ctx.version)) throw die(`版本号看起来不合法：${ctx.version}`, "用形如 3.2.1 的写法");
  ctx.tag = `v${ctx.version}`;
  ctx.entryName = `app-${ctx.id}-${ctx.version}.entry.json`;

  ctx.prAssetsDir = join(RELEASE_DIR, "pr-assets");
  ctx.screenshots = listScreenshots(ctx.prAssetsDir);

  // 自测报告是一份带 {{占位符}} 的模板：能自动算的数字由脚本填，叙述部分写一次就够。
  // 渲染推迟到出包之后，因为模板里要引用包的条目数、大小和 sha256。
  const selfTestPath = join(RELEASE_DIR, "自测.md");
  ctx.selfTestTemplate = existsSync(selfTestPath) ? readFileSync(selfTestPath, "utf8").trim() : "";
  ctx.selfTest = "";

  let stage = 0;
  const next = (label, fn) => {
    stage += 1;
    say(`\n──────── ${stage}. ${label} ────────`);
    return fn();
  };

  next("配置与版本", () => info(`${ctx.name} ${ctx.version} · 发布者 ${config.publisher} · 仓库 ${config.releaseRepo}${args.dryRun ? " · 干跑" : ""}`));
  next("预检", () => preflight(config, ctx, args));
  next("写入版本号", () => writeVersion(config, ctx, args));
  next("出包", () => packStage(config, ctx));

  if (args.mode === "pack") {
    step("只出包，收工");
    info(`版本:  ${ctx.effectiveVersion}`);
    info(`zip:   ${relative(ROOT, ctx.zipPath)}`);
    info(`entry: ${relative(ROOT, ctx.entryPath)}`);
    info(`sha256 ${ctx.sha256}`);
    return;
  }

  next("提交并打 tag", () => commitAndTag(config, ctx, args));
  next("发布 Release", () => releaseStage(config, ctx, args));

  if (args.verify) verifyStage(config, ctx);

  if (args.mode === "publish") {
    next("投稿到市场", () => marketStage(config, ctx, args));
  }

  step("完成");
  const repoUrl = `https://github.com/${config.releaseRepo}`;
  if (!ctx.releaseSkipped) say(`RELEASE_URL=${repoUrl}/releases/tag/${ctx.tag}`);
  else say(`RELEASE_URL=${repoUrl}/releases/tag/${ctx.tag}  (已存在，未重复创建)`);
  if (ctx.prUrl) say(`PR_URL=${ctx.prUrl}`);
  else if (args.mode === "publish" && !args.dryRun) say("PR_URL=（没有新建 PR，市场那边可能已经是最新的）");
  if (args.dryRun) say("（干跑：以上动作都没有真正执行）");
  if (!ctx.screenshots.length && args.mode === "publish") {
    info("release/pr-assets/ 里没有图；截图是选填，正文里会写一行「本版未附截图」");
  }
}

try {
  main();
} catch (error) {
  if (!error?.hinted) {
    say(`\n[停] ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.RELEASE_DEBUG) say(String(error?.stack || ""));
  }
  process.exitCode = 1;
}

