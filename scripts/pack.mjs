// SPDX-License-Identifier: MPL-2.0
//
// 本文件衍生自 git-save-load 的 scripts/pack.mjs（同一作者项目 H-i-m-s/git-save-load），
// 该文件又部分衍生自 GitHana 的同名文件：
//   GitHana: https://github.com/Nyasers/GitHana
//   Copyright (c) 2026 Nyasers，以 Mozilla Public License v. 2.0 授权。
// 本文件已由 doc-intake 修改（排除清单、可选自检），修改后的版本同样以 MPL-2.0 发布。
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// This Source Code Form is "Incompatible With Secondary Licenses", as
// defined by the Mozilla Public License, v. 2.0.
//
// scripts/pack.mjs — 零依赖出包（不调外部 tar/zip，不用 npm 库）。
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
// 打包前若存在 scripts/selfcheck.mjs 会先跑它，不过就拒绝出包；不存在则跳过（当前无自检）。
//
// 用法：
//   node scripts/pack.mjs                 # 出包到 <app>/dist，publisher 取 DEFAULT_PUBLISHER
//   node scripts/pack.mjs --out <dir>     # 自定义输出目录
//   node scripts/pack.mjs --publisher <p> # 覆盖 publisher（必须与 registry.json 登记值一致）
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** entry.json 的 publisher。必须与市场登记（registry.json）里的值逐字符一致；发布后固化，改要发新版本。 */
const DEFAULT_PUBLISHER = "H-i-m-s";
/** 市场同步器读 entry 附件时的响应字节上限（MAX_ENTRY_BYTES）。超了整批同步失败。 */
const MARKET_ENTRY_MAX_BYTES = 512 * 1024;

/** 任意层级的整目录排除项。release.ps1 出包时也调本脚本，所以这里是唯一的排除清单：
 *  开发资料、测试、Python 字节码缓存不进包，安装位的 App 用不到它们。 */
const SKIP_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  "dist",
  "scripts",      // 出包脚本自身
  "test",         // 开发者自测（test/*.py 与样例）
  "doc",          // 设计文档、图标素材（体积大头，仅开发期需要）
  "samples",      // python/mathtype/samples 等开发语料
  "__pycache__",  // Python 字节码缓存
]);
/** 常见临时/系统文件（按文件名匹配）。 */
const SKIP_FILE_RE = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._)|\.(tmp|temp|swp|swo|log|bak|pyc|pyo)$|~$/i;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ── 0) 出包前自检（有则跑，无则跳过） ───────────────────────────────────────
function runSelfcheck() {
  const script = join(ROOT, "scripts", "selfcheck.mjs");
  if (!existsSync(script)) {
    console.log("[pack] 未发现 scripts/selfcheck.mjs，跳过自检");
    return true;
  }
  try {
    execFileSync(process.execPath, [script], { stdio: "pipe" });
    console.log("[pack] selfcheck 通过");
    return true;
  } catch (e) {
    const out = [e.stdout, e.stderr].map((b) => String(b || "")).join("").trim();
    console.error("[pack] selfcheck 未通过，拒绝出包：");
    if (out) console.error(out.split("\n").map((l) => "    " + l).join("\n"));
    return false;
  }
}

// ── 1) 递归收集待打包文件（包根平铺，跳过排除项与符号链接） ────────────
function collect(dir, base, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      collect(abs, base, out);
    } else if (st.isFile()) {
      if (SKIP_FILE_RE.test(name)) continue;
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
    publisher: publisher || DEFAULT_PUBLISHER,
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
  const manifest = readJson(join(ROOT, "manifest.json"));
  if (!manifest.id || !manifest.version) {
    console.error("[pack] manifest.json 缺 id/version，拒绝出包");
    process.exit(1);
  }

  if (!runSelfcheck()) process.exit(1);

  const outDir = resolve(arg("--out") || join(ROOT, "dist"));
  const baseName = `${manifest.id}-v${manifest.version}`;
  const zipName = `${baseName}.zip`;
  const zipPath = join(outDir, zipName);

  // 收集：条目直接以包根为起点（平铺）。宿主的加载器按目录名找 app，zip 由安装器解到 <id>/ 下。
  const files = collect(ROOT, ROOT);
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
    publisher: arg("--publisher"),
    zipName,
    digest,
    size: zipBytes.length,
  });
  writeFileSync(entryPath, JSON.stringify(entry, null, 2) + "\n", "utf8");

  const relOut = (p) => relative(ROOT, p).split(sep).join("/");
  console.log(`[pack] 完成 ${relOut(zipPath)}  ${(zipBytes.length / 1024).toFixed(1)} KiB  ${files.length} 条`);
  console.log(`        sha256 ${digest}`);
  console.log(`        entry  ${relOut(entryPath)}`);
  console.log(`        条目   manifest.json, index.js, …`);
  console.log(`        发布者 ${entry.publisher}`);

  const entryBytes = statSync(entryPath).size;
  console.log(`        市场   entry ${entryBytes} / ${MARKET_ENTRY_MAX_BYTES} 字节`);
  if (entryBytes > MARKET_ENTRY_MAX_BYTES) {
    console.warn(`[pack] 警告：市场条目超过 ${MARKET_ENTRY_MAX_BYTES} 字节上限，同步器读不下这份 entry，`);
    console.warn(`       登记会失败。大头通常是 manifest.icon 被内联成 base64（膨胀约 4/3），先压那张图。`);
  }
}

main();
