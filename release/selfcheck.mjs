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
//   6) python/ 下所有 .py 能过语法编译；环境里装了 olefile 时还会跑 test/ 的七个库自测
//   7) builders/ 下给开发者的两份文档存在、非空，且不命中出包排除规则（少一份就不许出包）
//   8) formats.json 自身合法；登记了的扩展名都有本地提取器接着；Python 与 JS 两侧
//      派生出来的清单都与它一致（清单只有一份，漂了就没意义）
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

  // 6b) 库自测：那九个脚本要 olefile 才能 import。装了就跑，没装就跳过 ——
  // 这一步不该让「换台机器没装依赖」变成出不了包，但也绝不在装齐的机器上放水。
  const SELFTESTS = ["selftest_v3_parse.py", "selftest_v3_render.py", "selftest_v5_parse.py", "selftest_v5_render.py", "selftest_v6_epub.py", "selftest_v7_fb2.py", "selftest_v8_cbz.py", "selftest_v9_mobi.py", "selftest_v10_txt.py"];
  const depsReady = (() => {
    const r = runPy(["-c", "import olefile"]);
    return !r.error && r.status === 0;
  })();
  if (!depsReady) {
    note("当前环境 import 不到 olefile，已跳过 test/ 的九个库自测（在装齐依赖的环境里跑就会自动带上）");
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

// ── 7) builders 文档必须随包发布 ────────────────────────────────────────────
// 采集规则是「从仓库根递归收，只跳过排除项」，新建目录默认就会被打进 zip。但「默认会带上」
// 不是保证：往 excludeDirs 里加一行 builders，或者文件名撞上 excludePrefixes / excludeSuffixes，
// 包照样出得来，只是给开发者的文档偷偷没了。所以这里按 pack.mjs 的同一套判据把
// 「真会被收进 zip 吗」重算一遍，而不是相信默认行为。
const BUILDERS_DIR = join(ROOT, "builders");
const REQUIRED_BUILDER_DOCS = ["SERVICE-API.md", "PARAMETERS.md"];

const packRules = (() => {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(RELEASE_DIR, "config.json"), "utf8"));
  } catch (e) {
    fail(`读不到 release/config.json，无法判定 builders/ 会不会被打进包：${(e && e.message) || e}`);
    return null;
  }
  const pack = raw && typeof raw.pack === "object" && raw.pack ? raw.pack : {};
  const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v) : []);
  return {
    excludeDirs: new Set(strings(pack.excludeDirs)),
    excludeNames: new Set(strings(pack.excludeNames)),
    excludePrefixes: strings(pack.excludePrefixes),
    excludeSuffixes: strings(pack.excludeSuffixes),
    excludeExtensions: new Set(strings(pack.excludeExtensions).map((e) => e.replace(/^\./, "").toLowerCase())),
  };
})();

/** 一个包内路径会不会被过滤掉：命中就返回那条规则，没命中返回 null。判据与 pack.mjs 对齐。 */
function exclusionReason(entryPath) {
  const parts = entryPath.split("/");
  const fileName = parts[parts.length - 1];
  for (const dir of parts.slice(0, -1)) {
    if (packRules.excludeDirs.has(dir)) return `目录 ${dir}/ 在 pack.excludeDirs 里`;
  }
  if (packRules.excludeNames.has(fileName)) return "文件名在 pack.excludeNames 里";
  const prefix = packRules.excludePrefixes.find((p) => fileName.startsWith(p));
  if (prefix) return `文件名命中 pack.excludePrefixes 的 ${JSON.stringify(prefix)}`;
  const suffix = packRules.excludeSuffixes.find((s) => fileName.endsWith(s));
  if (suffix) return `文件名命中 pack.excludeSuffixes 的 ${JSON.stringify(suffix)}`;
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && packRules.excludeExtensions.has(fileName.slice(dot + 1).toLowerCase())) {
    return `扩展名 ${JSON.stringify(fileName.slice(dot))} 在 pack.excludeExtensions 里`;
  }
  return null;
}

if (packRules) {
  const present = existsSync(BUILDERS_DIR) && statSync(BUILDERS_DIR).isDirectory();
  if (!present) {
    fail(`builders/ 目录不存在：给开发者的文档（${REQUIRED_BUILDER_DOCS.join("、")}）要放在这里并随包发布`);
  } else if (packRules.excludeDirs.has("builders")) {
    fail("pack.excludeDirs 里有 builders：整个目录连同给开发者的文档都不会进包，把这一行去掉");
  } else {
    let shipped = 0;
    for (const name of REQUIRED_BUILDER_DOCS) {
      const entry = `builders/${name}`;
      const abs = join(BUILDERS_DIR, name);
      if (!existsSync(abs)) {
        fail(`${entry} 不存在：这份文档要随包发布，缺了调用方只能去翻源码`);
        continue;
      }
      const st = statSync(abs);
      if (!st.isFile()) {
        fail(`${entry} 不是普通文件，打不进包`);
        continue;
      }
      if (st.size === 0) {
        fail(`${entry} 是 0 字节的空文件，等于没给`);
        continue;
      }
      const reason = exclusionReason(entry);
      if (reason) {
        fail(`${entry} 不会进包：${reason}；这两份文档必须随包发布`);
        continue;
      }
      shipped += 1;
    }
    if (shipped === REQUIRED_BUILDER_DOCS.length) info(`builders/ ${shipped} 份开发者文档会随包发布`);
  }
}

// ── 8) 格式清单：formats.json 是唯一来源，Python / JS 都从它派生 ─────────
// 这一节管的是「清单只有一份」这件事能不能立住。以前扩展名抄在四处（目录准入、Python
// 细类型、JS 粗类型、describe 回给调用方的格式表），改一处漏三处且不报错：目录里静默
// 丢掉、类型落到 unknown。现在只认 formats.json，所以这里逐项验：json 自身合法、
// 登记了的扩展名真有本地提取器接着、Python 派生出来的集合与 json 相同、JS 镜像与 json 相同。
const FORMATS_PATH = join(ROOT, "formats.json");
// 这两个粗类走云端后端，不要求本地提取器；其余粗类必须有。
const CLOUD_CATEGORIES = new Set(["pdf", "image"]);
const formatErrorsBefore = errors.length;

let formatTable = null;
try {
  formatTable = JSON.parse(readFileSync(FORMATS_PATH, "utf8"));
} catch (e) {
  fail(`formats.json 无法解析：${(e && e.message) || e}`);
}

if (formatTable) {
  if (typeof formatTable !== "object" || Array.isArray(formatTable)) {
    fail("formats.json 的外层不是对象：应当是「粗类 -> {扩展名: 细类型}」");
    formatTable = null;
  } else if (Object.keys(formatTable).length === 0) {
    fail("formats.json 是空对象：一个扩展名都没登记，等于什么都不支持");
    formatTable = null;
  }
}

/** 扩展名 -> 出现过它的粗类列表。 */
const extOwners = new Map();
if (formatTable) {
  for (const [category, table] of Object.entries(formatTable)) {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      fail(`formats.json 里粗类 ${category} 的值不是对象：应当是「扩展名 -> 细类型」`);
      continue;
    }
    const entries = Object.entries(table);
    if (entries.length === 0) fail(`formats.json 里粗类 ${category} 下一个扩展名都没有`);
    for (const [ext, typeName] of entries) {
      if (!ext.startsWith(".")) fail(`formats.json 里粗类 ${category} 下的 ${JSON.stringify(ext)} 不以点开头`);
      if (ext !== ext.toLowerCase()) fail(`formats.json 里 ${ext} 不是小写：清单里的扩展名一律小写`);
      if (typeof typeName !== "string" || !typeName.trim()) {
        fail(`formats.json 里 ${category} -> ${ext} 的细类型为空`);
      }
      if (!extOwners.has(ext)) extOwners.set(ext, []);
      extOwners.get(ext).push(category);
    }
  }
  for (const [ext, owners] of extOwners) {
    if (owners.length > 1) {
      fail(`formats.json 里 ${ext} 同时登记在 ${owners.join("、")} 下面：一个扩展名只能属于一个粗类`);
    }
  }
}

// 8b) 写了扩展名就必须有落地：非云端粗类的细类型要能在本地提取器注册表里找到。
// 用正则抽注册表的键而不是 import Python：自检不该为了看一眼字典就起解释器、装依赖。
const EXTRACTORS_INIT = join(ROOT, "python", "extractors", "__init__.py");
const extractorTypes = (() => {
  let src;
  try {
    src = readFileSync(EXTRACTORS_INIT, "utf8");
  } catch {
    return null;
  }
  const block = src.match(/def\s+get_extractor\b[\s\S]*?\bextractors\s*=\s*\{([\s\S]*?)\n\s*\}/);
  if (!block) return null;
  const keys = new Set();
  for (const m of block[1].matchAll(/["']([^"']+)["']\s*:/g)) keys.add(m[1]);
  return keys.size ? keys : null;
})();

if (!extractorTypes) {
  fail(
    "读不出 python/extractors/__init__.py 里 get_extractor 的注册表，" +
      "无法判定「formats.json 登记了扩展名就必须有本地提取器」",
  );
} else if (formatTable) {
  for (const [category, table] of Object.entries(formatTable)) {
    if (CLOUD_CATEGORIES.has(category)) continue;
    for (const [ext, typeName] of Object.entries(table)) {
      if (typeof typeName !== "string" || extractorTypes.has(typeName)) continue;
      fail(
        `formats.json 里登记了 ${ext}（粗类 ${category}，细类型 ${JSON.stringify(typeName)}），` +
          `但 python/extractors/__init__.py 的注册表里没有对应的本地提取器；` +
          `要么补提取器，要么把它从清单里去掉`,
      );
    }
  }
}

// 8c) Python 侧一致：让 python/formats.py 自己报一遍它派生的集合，和 json 逐项比。
if (!py) {
  note("找不到可用的 Python 解释器，已跳过「Python 侧格式清单与 formats.json 一致」这一项");
} else if (formatTable) {
  const script =
    'import json,sys;sys.path.insert(0,"python");import formats;' +
    'print(json.dumps({"exts": sorted(formats.SUPPORTED_EXTS), "types": formats.TYPE_BY_EXT}, ensure_ascii=False))';
  const r = spawnSync(py.cmd, [...py.pre, "-c", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    // conda 的报错报告很长，真正的原因（运行时异常那一行）常常被尾巴淹没，先挑它。
    const lines = `${r.stdout || ""}${r.stderr || ""}`.split("\n").map((l) => l.trimEnd());
    const exceptionLines = lines.filter((l) => /^[A-Za-z_][\w.]*(?:Error|Exception):/.test(l.trim()));
    const out = (exceptionLines.length ? exceptionLines : lines.filter((l) => l.trim())).slice(-4);
    fail(
      `python/formats.py 没能报出格式清单（退出码 ${r.status ?? "?"}）：` +
        `Python 侧无法与 json 比对${out.length ? "\n    " + out.join("\n    ") : ""}`,
    );
  } else {
    let reported = null;
    try {
      reported = JSON.parse(r.stdout.trim().split("\n").pop() || "null");
    } catch {
      reported = null;
    }
    if (!reported || !Array.isArray(reported.exts) || typeof reported.types !== "object") {
      fail(`python/formats.py 的输出看不懂，无法比对：${JSON.stringify((r.stdout || "").slice(0, 200))}`);
    } else {
      const expectedExts = new Set(Object.keys(Object.assign({}, ...Object.values(formatTable))));
      const gotExts = new Set(reported.exts);
      const missing = [...expectedExts].filter((e) => !gotExts.has(e));
      const extra = [...gotExts].filter((e) => !expectedExts.has(e));
      if (missing.length) fail(`Python 侧的 SUPPORTED_EXTS 少了 formats.json 里登记的：${missing.join("、")}`);
      if (extra.length) fail(`Python 侧的 SUPPORTED_EXTS 多出 formats.json 里没有的：${extra.join("、")}`);
      const typeDiffs = [];
      for (const ext of expectedExts) {
        const want = Object.assign({}, ...Object.values(formatTable))[ext];
        if (gotExts.has(ext) && reported.types[ext] !== want) {
          typeDiffs.push(`${ext}（json 是 ${JSON.stringify(want)}，Python 是 ${JSON.stringify(reported.types[ext] ?? null)}）`);
        }
      }
      if (typeDiffs.length) fail(`Python 侧的 TYPE_BY_EXT 与 formats.json 不一致：${typeDiffs.join("；")}`);
    }
  }
}

// 8d) JS 侧一致：lib/formats.js 的内联镜像必须与 json 逐项相同。
// 镜像只在读不到 json 时才生效，所以「平时跑不到」不等于「可以漂移」——漂了就是在
// 换一台机器、换一次打包之后再也不会有人发现的分叉。
/** 把「粗类 -> {扩展名: 细类型}」的差异说成人话。 */
function formatTableDiff(expected, actual, actualLabel) {
  const diffs = [];
  const categories = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const category of categories) {
    const want = expected[category];
    const got = actual[category];
    if (!got || typeof got !== "object") {
      diffs.push(`${actualLabel}里没有粗类 ${category}`);
      continue;
    }
    if (!want) {
      diffs.push(`${actualLabel}里多出粗类 ${category}`);
      continue;
    }
    const exts = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const ext of exts) {
      if (!(ext in got)) diffs.push(`${actualLabel}的 ${category} 下缺 ${ext}`);
      else if (!(ext in want)) diffs.push(`${actualLabel}的 ${category} 下多出 ${ext}`);
      else if (want[ext] !== got[ext]) {
        diffs.push(`${category} 下 ${ext} 的细类型：json 是 ${JSON.stringify(want[ext])}，${actualLabel}是 ${JSON.stringify(got[ext])}`);
      }
    }
  }
  return diffs;
}

if (formatTable) {
  const FORMATS_JS = join(ROOT, "lib", "formats.js");
  const MIRROR_RE = /const FORMAT_MIRROR = (\{[\s\S]*?\n\});/;
  let mirrorText = null;
  try {
    const m = readFileSync(FORMATS_JS, "utf8").match(MIRROR_RE);
    mirrorText = m ? m[1] : null;
  } catch (e) {
    fail(`读不到 lib/formats.js，无法比对 JS 镜像：${(e && e.message) || e}`);
  }
  if (mirrorText === null) {
    fail(
      "lib/formats.js 里读不出内联镜像：找的是 `const FORMAT_MIRROR = { ... };` 这一整段字面量，" +
        "自检靠它跟 formats.json 比对，所以它必须保持可被完整捕获的对象字面量写法",
    );
  } else {
    let mirror = null;
    try {
      mirror = JSON.parse(mirrorText);
    } catch (e) {
      fail(`lib/formats.js 的内联镜像不是合法 JSON 字面量（自检按 JSON 解析它）：${(e && e.message) || e}`);
    }
    if (mirror) {
      const diffs = formatTableDiff(formatTable, mirror, "JS 镜像");
      if (diffs.length) {
        fail(
          `lib/formats.js 的内联镜像与 formats.json 不一致：${diffs.slice(0, 8).join("；")}` +
            (diffs.length > 8 ? `（共 ${diffs.length} 处）` : ""),
        );
      }
    }
  }
}

if (errors.length === formatErrorsBefore && formatTable) {
  info(`格式清单 formats.json ${extOwners.size} 个扩展名，Python 侧与 JS 镜像都跟它一致`);
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
