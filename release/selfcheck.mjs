// SPDX-License-Identifier: MPL-2.0
//
// 本文件的结构与部分实现取自 H-i-m-s/git-save-load 的 release/selfcheck.mjs；
// 那部分又衍生自 GitHana（Copyright (c) 2026 Nyasers，以 MPL-2.0 授权）。
// 本文件已由 doc-intake 按本 App 的结构重写，修改后的版本同样以 MPL-2.0 发布。
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// This Source Code Form is "Incompatible With Secondary Licenses", as
// defined by the Mozilla Public License, v. 2.0.
//
// release/selfcheck.mjs — Doc Intake 的出包前自检。
//
// 这是整个 release/ 里跟 App 绑得最紧的文件之一（另一个是 config.json）。
// 换 App 要么重写它，要么删掉它并把 config.json 的 pack.selfcheck 改成 "none"。
//
// 只做「不依赖外部工具也能判定、坏了就是坏了」的那部分，给发版一个实际门槛：
//   1) manifest.json 能解析、必备字段齐全，entry 与 icon 指向的文件都在
//   2) manifest 声明的 UI route 有对应页面（改了 manifest 忘了建页面，这里拦）
//   3) index.js / lib/ / routes/ / tools/ / ui/ 下的 .js 与 .mjs 语法通过，
//      连 ui/*.html 里的内联脚本一起查
//   4) 第一方代码里每个相对 import 都指得到实处（路径写错 = App 起不来）
//   5) routes/ 同一个文件里没有重复注册的同方法同路径（后者会被前者吞掉）
//   6) python/ 下所有 .py 能过语法编译；环境里装了 olefile 时还会跑 test/ 的四个库自测
//
// 用法：
//   node release/selfcheck.mjs          # 人类可读，失败以非零码退出
//   node release/selfcheck.mjs --json   # { ok, errors, warnings, files, tests }
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(RELEASE_DIR, "..");
const JSON_MODE = process.argv.slice(2).includes("--json");

const errors = [];
const warnings = [];
// 说明性的一行（查出用了哪个解释器、多少个文件过编译）不是警告，不该占警告计数、
// 也不该跟着 PR 的自测报告跑出去。
const infos = [];
const rel = (p) => relative(ROOT, p).split(sep).join("/");
const fail = (m) => errors.push(m);
const note = (m) => warnings.push(m);
const info = (m) => infos.push(m);

// ── 1) manifest.json 与它指向的文件 ─────────────────────────────────────────
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
} catch (e) {
  fail(`manifest.json 无法解析：${(e && e.message) || e}`);
}

const REQUIRED_FIELDS = ["manifestVersion", "id", "name", "version", "entry", "icon"];
if (manifest) {
  for (const field of REQUIRED_FIELDS) {
    const value = manifest[field];
    if (value === undefined || value === null || value === "") fail(`manifest.json 缺少必备字段：${field}`);
  }
  if (typeof manifest.entry === "string" && manifest.entry && !existsSync(join(ROOT, manifest.entry))) {
    fail(`entry 指向的文件不存在：${manifest.entry}`);
  }
  if (typeof manifest.icon === "string" && manifest.icon && !existsSync(join(ROOT, manifest.icon))) {
    fail(`icon 指向的文件不存在：${manifest.icon}`);
  }
  if (manifest.capabilities !== undefined && !Array.isArray(manifest.capabilities)) {
    fail("manifest.json 的 capabilities 不是数组");
  }
  // Python 端是这份 App 的干活的半边，入口文件没了就是坏了（lib/service.js 直接 spawn 它）。
  if (!existsSync(join(ROOT, "python", "main.py"))) {
    fail("python/main.py 不存在：lib/service.js 会 spawn 这个文件，缺了整条解析链都起不来");
  }
}

// ── 2) manifest 声明的 UI route 必须有页面 ──────────────────────────────────
// 页面基准目录是 ui/：设置页从这里取。本 App 只有设置页一处 UI。
const UI_DIR = join(ROOT, "ui");
if (manifest) {
  const route = manifest.contributes?.settings?.ui?.route;
  if (typeof route === "string" && route) {
    const file = join(UI_DIR, route.replace(/^\/+/, ""));
    if (!existsSync(file)) fail(`contributes.settings.ui.route 指向的页面不存在：ui${route.startsWith("/") ? route : "/" + route}`);
  }
}

// ── 3) 会被加载的 JS 都要能解析 ─────────────────────────────────────────────
function walkFiles(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isJs = (p) => p.endsWith(".js") || p.endsWith(".mjs");
const jsFiles = [];
const seen = new Set();
const addFile = (p) => {
  if (existsSync(p) && !seen.has(p)) {
    seen.add(p);
    jsFiles.push(p);
  }
};
addFile(join(ROOT, "index.js"));
for (const dir of ["lib", "routes", "tools", "ui"]) {
  for (const f of walkFiles(join(ROOT, dir), isJs)) addFile(f);
}
// ui/assets/sdk.js 是随包的宿主 SDK bundle，不是本仓库的代码，语法判定会误伤；
// 它是逐字拷贝来的，坏了也是在源头坏的。所以只排除这一个文件。
const SDK_BUNDLE = join(ROOT, "ui", "assets", "sdk.js");
const checkedJs = jsFiles.filter((p) => p !== SDK_BUNDLE);

/** 把一段源码交给 `node --check`，只问语法。 */
function checkSyntaxOnce(src, inputType) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--input-type=" + inputType, "--check"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => {
      out += b;
    });
    child.stderr.on("data", (b) => {
      out += b;
    });
    child.on("error", (e) => done({ ok: false, out: `起进程失败：${(e && e.message) || e}` }));
    child.on("close", (code) => done(code === 0 ? { ok: true } : { ok: false, out: out.trim() }));
    child.stdin.on("error", () => {}); // 子进程先退出时忽略 EPIPE
    child.stdin.end(src);
  });
}

/** 一个文件的语法检查。
 *
 * 不走「node --check <文件>」：Node 24 对 .js 会做模块自动探测，即便后面真有语法错误也可能返回 0，
 * 会漏报。所以显式指定 --input-type：.mjs 只按 ESM 检一遍；.js 两种模式各检一遍，有一种过就算合法
 * （ui/assets/ 下的 bundle 可能是 CJS 或 UMD）。
 */
async function checkSyntax(file) {
  let src;
  try {
    src = readFileSync(file);
  } catch (e) {
    return { ok: false, out: `读取失败：${(e && e.message) || e}` };
  }
  const asEsm = await checkSyntaxOnce(src, "module");
  if (asEsm.ok) return { ok: true };
  if (file.endsWith(".mjs")) return { ok: false, out: asEsm.out };
  const asCjs = await checkSyntaxOnce(src, "commonjs");
  if (asCjs.ok) return { ok: true };
  return { ok: false, out: /\b(import|export)\b/.test(src.toString("utf8")) ? asEsm.out : asCjs.out };
}

/** 并发跑完所有文件。
 *
 * 串行 spawn 在 Windows 上每个 node 起步约 90ms；并发 8 路把几十个文件压到一秒内。
 * 并发度不往上加：几十个 node 进程同时起会吃不消，瓶颈本来就是进程创建而不是 CPU。
 */
async function checkAllSyntax(files, concurrency = 8) {
  const results = new Map();
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= files.length) return;
      results.set(files[i], await checkSyntax(files[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}

/** 语法错误的展示：node --check 从 stdin 读时文件名是 [stdin]，换成真名，并滤掉空行。 */
function formatSyntaxOut(out, file) {
  const head = (out || "")
    .replace(/\[stdin\]/g, rel(file))
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 4)
    .join("\n    ");
  return head ? "\n    " + head : "";
}

const syntax = await checkAllSyntax(checkedJs);
for (const file of checkedJs) {
  const r = syntax.get(file);
  if (r && !r.ok) fail(`语法检查失败：${rel(file)}${formatSyntaxOut(r.out, file)}`);
}

// 页面里的内联脚本同样会被宿主执行，同一把尺子量一遍。
const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
for (const page of walkFiles(UI_DIR, (p) => p.endsWith(".html"))) {
  const html = readFileSync(page, "utf8");
  let m;
  let index = 0;
  while ((m = INLINE_SCRIPT_RE.exec(html)) !== null) {
    index += 1;
    const attrs = m[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue; // 外链脚本单独查过文件本身
    const body = (m[2] || "").trim();
    if (!body) continue;
    const asModule = /\btype\s*=\s*["']?module/i.test(attrs);
    const first = await checkSyntaxOnce(body, asModule ? "module" : "commonjs");
    if (first.ok) continue;
    const second = asModule ? null : await checkSyntaxOnce(body, "module");
    if (second && second.ok) continue;
    const worst = second && !second.ok && !first.ok && !/\b(import|export)\b/.test(body) ? second : first;
    fail(`语法检查失败：${rel(page)} 第 ${index} 段内联脚本${formatSyntaxOut(worst.out, page)}`);
  }
}

// ── 4) 第一方代码里的相对 import 都要指得到实处 ─────────────────────────────
// 只在 index.js / lib / routes / tools 上查：这几个是 App 进程真正 import 的代码，
// 路径写错的表现是「插件加载失败」，日志里只有一行，很难查。ui/ 不查（浏览器侧的
// 解析规则与 node 不同，且 bundle 里带大量非本仓库的字符串）。
const IMPORT_RE = /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
const resolveSpecifier = (from, spec) => {
  const base = resolve(dirname(from), spec);
  const tries = [base, base + ".js", base + ".mjs", base + ".json", join(base, "index.js"), join(base, "index.mjs")];
  return tries.find((p) => existsSync(p) && !statSync(p).isDirectory()) || null;
};
const firstParty = [join(ROOT, "index.js"), ...walkFiles(join(ROOT, "lib"), isJs), ...walkFiles(join(ROOT, "routes"), isJs), ...walkFiles(join(ROOT, "tools"), isJs)];
for (const file of firstParty) {
  const src = readFileSync(file, "utf8");
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1] || m[2] || m[3];
    if (!spec || !spec.startsWith(".")) continue;
    if (!resolveSpecifier(file, spec)) fail(`${rel(file)} 里 import 的模块找不到：${spec}`);
  }
}

// ── 5) routes/ 里同一个文件不能重复注册同方法同路径 ────────────────────────
// 宿主按目录自动装配 routes/，同一个文件里注册两次，后者会被前者吞掉，
// 表现是「改的那条路由没生效」，而且没有任何报错。
const ROUTE_RE = /\bapp\.(get|post|put|patch|delete|head|all)\s*\(\s*["'`]([^"'`]+)["'`]/g;
for (const file of walkFiles(join(ROOT, "routes"), isJs)) {
  const src = readFileSync(file, "utf8");
  const hits = new Map();
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(src)) !== null) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    hits.set(key, (hits.get(key) || 0) + 1);
  }
  for (const [key, count] of hits) {
    if (count > 1) fail(`${rel(file)} 里 ${key} 注册了 ${count} 次：只有第一条会生效`);
  }
}

// ── 6) Python 侧：能编译；环境齐时再跑库自测 ────────────────────────────────
let testCount = 0;

/** 找一个能用的 Python 解释器。
 *
 * 顺序：环境变量 DOC_INTAKE_PYTHON → conda 的 Agent 环境 → python3 → python。
 * 本 App 自己的 Python 一律跑在 Agent 环境里（仓库约定），但自检不该因为换了台机器
 * 就报废：找不到解释器只记一条警告，上面那几项（语法、结构、路由）照样判定。
 */
function findPython() {
  const candidates = [];
  if (process.env.DOC_INTAKE_PYTHON) candidates.push([process.env.DOC_INTAKE_PYTHON, []]);
  candidates.push(["conda", ["run", "-n", "Agent", "python"]]);
  candidates.push(["python3", []]);
  candidates.push(["python", []]);
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "print(1)"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return { cmd, pre, label: [cmd, ...pre].join(" ") };
  }
  return null;
}

const py = findPython();
if (!py) {
  note("找不到可用的 Python 解释器，已跳过 python/ 的语法编译与 test/ 的库自测");
} else {
  const runPy = (args) =>
    spawnSync(py.cmd, [...py.pre, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180000 });

  // 6a) 语法编译：只问「这段代码能不能编译」，不 import 任何模块，所以不需要装依赖。
  const pyFiles = walkFiles(join(ROOT, "python"), (p) => p.endsWith(".py"));
  if (pyFiles.length === 0) {
    note("python/ 下没有 .py 文件，跳过语法编译");
  } else {
    // 把文件路径整体交回给解释器自己走：命令行长度不受限，也不用在这里拼 79 个参数。
    const r = runPy(["-m", "compileall", "-q", join(ROOT, "python")]);
    if (r.error || r.status !== 0) {
      const out = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").filter((l) => l.trim()).slice(0, 6);
      fail(`python/ 里有文件通不过语法编译（${pyFiles.length} 个 .py）${out.length ? "\n    " + out.join("\n    ") : ""}`);
    } else {
      info(`python/ ${pyFiles.length} 个 .py 通过语法编译（${py.label}）`);
    }
  }

  // 6b) 库自测：那四个脚本要 olefile 才能 import。装了就跑，没装就跳过 ——
  // 这一步不该让「换台机器没装依赖」变成出不了包，但也绝不在装齐的机器上放水。
  const SELFTESTS = ["selftest_v3_parse.py", "selftest_v3_render.py", "selftest_v5_parse.py", "selftest_v5_render.py"];
  const depsReady = (() => {
    const r = runPy(["-c", "import olefile"]);
    return !r.error && r.status === 0;
  })();
  if (!depsReady) {
    note("当前环境 import 不到 olefile，已跳过 test/ 的四个库自测（在装齐依赖的环境里跑就会自动带上）");
  } else if (!existsSync(join(ROOT, "test"))) {
    note("没找到 test/ 目录，跳过库自测");
  } else {
    for (const name of SELFTESTS) {
      const script = join(ROOT, "test", name);
      if (!existsSync(script)) {
        note(`test/${name} 不存在，跳过`);
        continue;
      }
      const r = runPy([join("test", name)]);
      if (r.error || r.status !== 0) {
        const out = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").filter((l) => l.trim()).slice(-6);
        fail(`库自测未通过：test/${name}（退出码 ${r.status ?? "?"}）${out.length ? "\n    " + out.join("\n    ") : ""}`);
      } else {
        testCount += 1;
        info(`test/${name} 通过`);
      }
    }
  }
}

// ── 输出 ───────────────────────────────────────────────────────────────────
const ok = errors.length === 0;

if (JSON_MODE) {
  console.log(JSON.stringify({ ok, errors, warnings, files: checkedJs.length, tests: testCount }, null, 2));
} else {
  for (const i of infos) console.log(`  info: ${i}`);
  for (const w of warnings) console.log(`  warn: ${w}`);
  for (const e of errors) console.error(`  FAIL: ${e}`);
  console.log(
    `[selfcheck] 语法 ${checkedJs.length} 个文件 · 库自测 ${testCount} 个脚本 · ` +
      `错误 ${errors.length} · 警告 ${warnings.length} · ${ok ? "OK" : "FAILED"}`,
  );
}

process.exit(ok ? 0 : 1);
