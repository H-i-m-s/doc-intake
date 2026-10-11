// SPDX-License-Identifier: MPL-2.0
//
// 本文件大部分内容衍生自 GitHana 的同名文件：
//   GitHana: https://github.com/Nyasers/GitHana
//   Copyright (c) 2026 Nyasers，以 Mozilla Public License v. 2.0 授权。
// 本文件已由 git-save-load 修改，修改后的版本同样以 MPL-2.0 发布。完整声明见根目录 NOTICE。
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// This Source Code Form is "Incompatible With Secondary Licenses", as
// defined by the Mozilla Public License, v. 2.0.
//
// release/pack.mjs — 零依赖出包（不调外部 tar/zip，不用 npm 库）。
//
// 采集范围与 publisher 一律从 release/config.json 读，代码里不硬编码插件相关的东西。
// 想给另一个插件用，整个 release/ 复制过去，只改 config.json。
//
// 产物（dist/）：
//   <id>-v<version>.zip            归档；manifest.json / index.js 直接位于包根（平铺，不套顶层目录）
//   <id>-v<version>.zip.sha256     sha256 校验值（只给人看，市场同步器不读）
//   app-<id>-<version>.entry.json  市场条目（archive.url 用 {{BASE_URL}} 占位）
//
// 市场（liliMozi/hana-marketplace）的附件规矩，名字都是死的：
//   1) entry 附件必须叫 app-<id>-<version>.entry.json。同步器按 "app-<id>-" 开头 + ".entry.json"
//      结尾筛，必须唯一命中，再逐字符比对名字。注意版本号前面没有 v。
//   2) 归档附件的名字由 entry 里 archive.url 指名，必须与它逐字符一致。
//   3) entry 里的 publisher 必须与登记仓库 registry.json 的值一致；发布即固化，改要发新版本。
//   4) entry 附件有 512 KiB 上限（同步器的 MAX_ENTRY_BYTES），超了整批同步直接失败；本脚本会提示。
//
// 布局为什么是平铺：宿主自己的出包工具产出的就是平铺包，宿主的校验器也只在包根找
// manifest.json，套一层目录会被判成「读不到 manifest.json」；zip 由安装器解到 <id>/ 下。
//
// 用法：
//   node release/pack.mjs                 # 出包到 config.pack.out，publisher 取 config.publisher
//   node release/pack.mjs --out <dir>     # 自定义输出目录
//   node release/pack.mjs --publisher <p> # 覆盖 publisher（必须与 registry.json 登记值一致）
//   node release/pack.mjs --no-selfcheck  # 跳过自检
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const RELEASE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(RELEASE_DIR, "..");

/** 市场同步器读 entry 附件时的响应字节上限（MAX_ENTRY_BYTES）。超了整批同步失败。 */
const MARKET_ENTRY_MAX_BYTES = 512 * 1024;

/** 自检模式：required 必须过；optional 有就跑、没有就跳过；none 从不跑。 */
const SELFCHECK_MODES = new Set(["required", "optional", "none"]);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

const hasFlag = (name) => process.argv.includes(name);

// ── 配置：release/config.json 是采集范围与发布身份的唯一来源 ─────────────────────
function loadConfig() {
  const path = join(RELEASE_DIR, "config.json");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`[pack] 读不到或解析不了 ${path}：${(e && e.message) || e}`);
    process.exit(1);
  }
  const problems = [];
  if (typeof raw.publisher !== "string" || !raw.publisher.trim()) problems.push("publisher 必须是非空字符串");
  if (raw.schema !== 1) problems.push("schema 必须是 1");
  const pack = raw.pack && typeof raw.pack === "object" ? raw.pack : {};
  const list = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v)) {
      problems.push(`pack.${label} 必须是字符串数组`);
      return [];
    }
    return value;
  };
  const selfcheck = pack.selfcheck === undefined ? "optional" : pack.selfcheck;
  if (!SELFCHECK_MODES.has(selfcheck)) problems.push(`pack.selfcheck 只能是 required / optional / none，现在是 ${JSON.stringify(selfcheck)}`);
  const config = {
    publisher: raw.publisher,
    defaultBranch: typeof raw.defaultBranch === "string" && raw.defaultBranch ? raw.defaultBranch : "master",
    release: {
      repo: raw.release && typeof raw.release.repo === "string" ? raw.release.repo : null,
      title: raw.release && typeof raw.release.title === "string" ? raw.release.title : null,
    },
    pack: {
      out: typeof pack.out === "string" && pack.out ? pack.out : "dist",
      excludeDirs: new Set(list(pack.excludeDirs, "excludeDirs")),
      excludeNames: new Set(list(pack.excludeNames, "excludeNames")),
      excludePrefixes: list(pack.excludePrefixes, "excludePrefixes"),
      excludeExtensions: new Set(list(pack.excludeExtensions, "excludeExtensions").map((e) => e.replace(/^\./, "").toLowerCase())),
      excludeSuffixes: list(pack.excludeSuffixes, "excludeSuffixes"),
      selfcheck,
    },
  };
  if (problems.length) {
    console.error(`[pack] release/config.json 有问题：\n${problems.map((p) => "    - " + p).join("\n")}`);
    process.exit(1);
  }
  return config;
}

// ── 0) 出包前自检 ───────────────────────────────────────────────────────────
/** 自检的机器可读结果。publish.mjs 拿它去填自测报告里的数字（同一次自检，不重跑）。 */
let selfcheckReport = null;

function runSelfcheck(config) {
  const script = join(RELEASE_DIR, "selfcheck.mjs");
  if (config.pack.selfcheck === "none" || hasFlag("--no-selfcheck")) {
    console.log("[pack] 已配置跳过自检");
    return true;
  }
  if (!existsSync(script)) {
    if (config.pack.selfcheck === "optional") {
      console.log("[pack] 未发现 release/selfcheck.mjs，跳过自检");
      return true;
    }
    console.error("[pack] config 要求自检（required），但 release/selfcheck.mjs 不存在");
    return false;
  }

  // 跑 --json：同一趟既给终端看，也能把数字交给编排层去填自测报告。
  // 老版本 selfcheck 没有 --json 分支时会解析失败，那就退回只当门槛用。
  const result = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const raw = String(result.stdout || "").trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* 没有 --json 分支 */
  }

  if (result.status === 0) {
    selfcheckReport = parsed;
    console.log("[pack] selfcheck 通过");
    return true;
  }

  console.error("[pack] selfcheck 未通过，拒绝出包：");
  const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
  if (errors.length) {
    console.error(errors.map((e) => String(e).split("\n").map((l) => "    " + l).join("\n")).join("\n"));
  } else {
    const out = [raw, result.stderr].map((b) => String(b || "")).join("").trim();
    if (out) console.error(out.split("\n").map((l) => "    " + l).join("\n"));
  }
  return false;
}

// ── 1) 递归收集待打包文件（包根平铺，跳过排除项与符号链接） ──
function makeNameFilter(pack) {
  return (name) => {
    if (pack.excludeNames.has(name)) return true;
    if (pack.excludePrefixes.some((p) => name.startsWith(p))) return true;
    if (pack.excludeSuffixes.some((s) => name.endsWith(s))) return true;
    const dot = name.lastIndexOf(".");
    if (dot > 0 && pack.excludeExtensions.has(name.slice(dot + 1).toLowerCase())) return true;
    return false;
  };
}

function collect(dir, base, pack, isExcludedName, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (pack.excludeDirs.has(name)) continue;
      collect(abs, base, pack, isExcludedName, out);
    } else if (st.isFile()) {
      if (isExcludedName(name)) continue;
      out.push({ abs, entry: relative(base, abs).split(sep).join("/"), size: st.size });
    }
  }
  return out;
}

// ── 最小 ZIP 写入器（deflate/store，UTF-8 名，保留可执行位） ─────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeZip(outFile, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.entry, "utf8");
    const data = readFileSync(e.abs);
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 标志
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE((((e.mode || 0o644) | 0o100000) << 16) >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  writeFileSync(outFile, Buffer.concat([...chunks, cenBuf, eocd]));
}

/** 市场条目（.entry.json），字段对齐 GitHana 的产物；archive.url 用 {{BASE_URL}} 占位。 */
function buildEntry({ manifest, publisher, zipName, digest, size }) {
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const entry = {
    kind: "app",
    id: manifest.id,
    name: manifest.name || manifest.id,
    publisher,
    description: typeof manifest.description === "string" ? manifest.description : "",
    version: manifest.version,
    permissions: capabilities.map((capability) => ({ capability })),
    ...(manifest.minAppVersion ? { compatibility: { minAppVersion: manifest.minAppVersion } } : {}),
    archive: { url: `{{BASE_URL}}/${zipName}`, sha256: digest, size, format: "zip" },
  };
  try {
    const iconPath = join(ROOT, manifest.icon);
    if (manifest.icon && existsSyncFile(iconPath)) {
      const ext = manifest.icon.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "image/png";
      entry.icon = `data:${ext};base64,${readFileSync(iconPath).toString("base64")}`;
    }
  } catch {
    /* 图标只是加性字段，读不到就不带 */
  }
  if (manifest.repository) entry.repository = manifest.repository;
  if (manifest.homepage) entry.homepage = manifest.homepage;
  return entry;
}

function existsSyncFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  const config = loadConfig();
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  if (!manifest.id || !manifest.version) {
    console.error("[pack] manifest.json 缺 id/version，拒绝出包");
    process.exit(1);
  }

  if (!runSelfcheck(config)) process.exit(1);
  // 把自检数字以一行 JSON 交出去，给编排层填自测报告用。不设这个环境变量时完全无感。
  if (process.env.RELEASE_PACK_REPORT === "1" && selfcheckReport) {
    console.log(`[pack] selfcheck-report ${JSON.stringify(selfcheckReport)}`);
  }

  const pack = config.pack;
  const outArg = arg("--out");
  const outDir = resolve(ROOT, outArg || pack.out);
  const baseName = `${manifest.id}-v${manifest.version}`;
  const zipName = `${baseName}.zip`;
  const zipPath = join(outDir, zipName);

  // 收集：条目直接以包根为起点（平铺）。宿主的加载器按目录名找 app，zip 由安装器解到 <id>/ 下。
  const isExcludedName = makeNameFilter(pack);
  const files = collect(ROOT, ROOT, pack, isExcludedName);
  if (files.length === 0) {
    console.error("[pack] 没有可打包的文件，拒绝出包");
    process.exit(1);
  }

  rmSync(zipPath, { force: true });
  mkdirSync(outDir, { recursive: true });
  writeZip(zipPath, files);

  const zipBytes = readFileSync(zipPath);
  const digest = createHash("sha256").update(zipBytes).digest("hex");
  writeFileSync(`${zipPath}.sha256`, `${digest}  ${zipName}\n`, "utf8");

  // 市场同步器要求 entry 附件叫 app-<id>-<version>.entry.json（版本号前没有 v），
  // 与 zip 的 <id>-v<version>.zip 不是同一种命名法，别混。
  const entryName = `app-${manifest.id}-${manifest.version}.entry.json`;
  const entryPath = join(outDir, entryName);
  const entry = buildEntry({
    manifest,
    publisher: arg("--publisher") || config.publisher,
    zipName,
    digest,
    size: zipBytes.length,
  });
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + "\n", "utf8");

  const relOut = (p) => relative(ROOT, p).split(sep).join("/");
  console.log(`[pack] 完成 ${relOut(zipPath)}  ${(zipBytes.length / 1024).toFixed(1)} KiB  ${files.length} 条`);
  console.log(`        sha256 ${digest}`);
  console.log(`        entry  ${relOut(entryPath)}`);
  console.log(`        发布者 ${entry.publisher}`);
  console.log(`        版本   ${manifest.version}   分支 ${config.defaultBranch}`);

  const entryBytes = statSync(entryPath).size;
  console.log(`        市场   entry ${entryBytes} / ${MARKET_ENTRY_MAX_BYTES} 字节`);
  if (entryBytes > MARKET_ENTRY_MAX_BYTES) {
    console.warn(`[pack] 警告：市场条目超过 ${MARKET_ENTRY_MAX_BYTES} 字节上限，同步器读不下这份 entry，`);
    console.warn(`       登记会失败。大头通常是 manifest.icon 被内联成 base64（膨胀约 4/3），先压那张图。`);
  }
}

main();
