// SPDX-License-Identifier: MPL-2.0
//
// release/console.mjs — 终端输出，以及带着「为什么」和「怎么办」退出。
//
// 所有模块共用这一层。别在别处直接 process.stdout.write，也别在别处 process.exit。

import process from "node:process";

// ─────────────────────────────────────────────────────────────────────────────
// 输出与错误
// ─────────────────────────────────────────────────────────────────────────────
export const say = (msg = "") => process.stdout.write(`${msg}\n`);
export const step = (msg) => say(`\n==> ${msg}`);
export const info = (msg) => say(`    ${msg}`);
export const warn = (msg) => say(`[警告] ${msg}`);

/** 带着原因和下一步怎么办退出（不打印堆栈）。 */
export function die(message, hint) {
  say(`\n[停] ${message}`);
  if (hint) say(`     怎么办：${hint}`);
  const err = new Error(message);
  err.hinted = true;
  return err;
}

