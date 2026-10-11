// SPDX-License-Identifier: MPL-2.0
//
// release/exec.mjs — 调外部命令（git / gh），给失败分类，按类退避重试。
//
// 重试只给「可能已经成功了但没收到回执」的那一类：DNS、连接中断、5xx、限速抖动。
// 认证失败和事实错误一律立刻抛。这一层是唯一 fork 子进程的地方。

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { warn, die } from "./console.mjs";

const RELEASE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(RELEASE_DIR, "..");

// 注意别用裸词：这几个模式都曾在无关文本上误命中过。
//   eof      → 收紧成 \bEOF\b（"eof" 是不少英文词的中间片段）
//   502/503/504 → 一度是裸数字，于是任何含这三个数字的文本都会命中：连出包自检里
//                `✖ test/x.test.js (504.2ms)` 这种耗时行都能骗过它，本地失败就被当成
//                网络失败，白等一秒重跑一遍。现在要求它们带 HTTP 上下文。
const TRANSIENT = /could not resolve host|connection (reset|refused|aborted)|timed? out|timeout|tls|ssl|\bEOF\b|network is unreachable|\bHTTP[^\n]{0,32}?\b(?:502|503|504)\b|\b(?:502|503|504)\b[^\n]{0,32}?\b(?:Bad Gateway|Service Unavailable|Gateway Time-?out)\b|temporarily unavailable|remote end hung up/i;
const RATE_LIMIT = /rate limit|secondary rate/i;
const AUTH_PROBLEM = /authentication|not logged in|gh auth login|bad credentials|401|permission denied|insufficient|forbidden/i;

/** 把一段命令行输出归类，决定能不能重试。 */
export function classify(text) {
  const t = String(text || "");
  if (RATE_LIMIT.test(t)) return "rate";
  if (TRANSIENT.test(t)) return "transient";
  if (AUTH_PROBLEM.test(t)) return "auth";
  return "other";
}

/** 跑一条子进程命令，返回 { status, stdout, stderr }。不抛异常。 */
export function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: "utf8",
    input: opts.input,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.error) {
    return { status: -1, stdout: "", stderr: String(result.error.message || result.error) };
  }
  return { status: result.status, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

/**
 * 带退避重试的执行。只对"可能已经成功了但没收到回执"的失败重试；
 * 认证问题和事实错误直接抛。
 */
export function runRetry(cmd, args, opts = {}) {
  const label = opts.label || `${cmd} ${args.slice(0, 3).join(" ")}`;
  const attempts = opts.attempts ?? 3;
  const delays = [1000, 4000, 16000];
  for (let attempt = 1; ; attempt += 1) {
    const result = run(cmd, args, opts);
    if (result.status === 0 || opts.acceptNonZero) return result;
    const kind = classify(result.stderr + result.stdout);
    const detail = (result.stderr || result.stdout).trim().split("\n").slice(0, 4).join("\n      ");
    if (kind === "transient" && attempt < attempts) {
      warn(`${label} 第 ${attempt} 次失败（网络类），${delays[attempt - 1] / 1000} 秒后重试：${detail.replace(/\s+/g, " ").slice(0, 160)}`);
      sleepSync(delays[attempt - 1]);
      continue;
    }
    if (kind === "rate") {
      throw die(`${label} 被 GitHub 限速`, "配置一个只读的 GITHUB_TOKEN 环境变量，或过一会儿再试");
    }
    if (kind === "auth") {
      throw die(`${label} 认证失败\n      ${detail}`, "运行 gh auth login，确认账号对仓库有读写权限");
    }
    if (kind === "transient") {
      throw die(`${label} 重试 ${attempts} 次仍未成功（网络类）\n      ${detail}`, "检查网络或代理，然后原样重跑");
    }
    throw die(`${label} 失败\n      ${detail}`);
  }
}

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// git / gh
// ─────────────────────────────────────────────────────────────────────────────
export const git = (args, opts = {}) => runRetry("git", args, { ...opts, label: opts.label || `git ${args[0]}` });
export const gh = (args, opts = {}) => runRetry("gh", args, { ...opts, label: opts.label || `gh ${args[0]}` });

export const gitQuiet = (args) => run("git", args);

/** gh api 的薄封装。input 传对象时按 JSON 走 stdin。 */
export function ghApi(endpoint, opts = {}) {
  const args = ["api", endpoint];
  if (opts.method) args.push("--method", opts.method);
  if (opts.jq) args.push("--jq", opts.jq);
  for (const h of opts.headers || []) args.push("-H", h);
  let input;
  if (opts.body !== undefined) {
    args.push("--input", "-");
    input = JSON.stringify(opts.body);
  }
  // label 带上方法和 endpoint：错的时候才知道是哪一个请求挂了。
  // 不带的话所有调用都只报「gh api 失败」，一个 404 能把人查半天。
  const result = gh(args, {
    input,
    acceptNonZero: opts.acceptNonZero,
    label: opts.label || `gh api ${opts.method || "GET"} ${endpoint}`,
  });
  return result;
}

export function ghApiJson(endpoint, opts = {}) {
  // 失败一律返回 null，而不是抛。调用点全都写成 `if (!x?.sha) die("具体哪一步失败了")`，
  // 这里先抛的话，那些更准确的错误永远轮不到。
  // （原来的注释写的就是「失败返回 null」，是实现跟注释不一致，实测踩到了。）
  //
  // 但 acceptNonZero 会让 runRetry 直接返回、不重试，于是网络拖一次就全废 —— 而投稿要
  // 连着发五六个写请求。所以这里自己按 transient 退避重试（建悬空对象是幂等的）。
  for (let attempt = 1; ; attempt += 1) {
    const result = ghApi(endpoint, { ...opts, acceptNonZero: true });
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout);
      } catch {
        return null;
      }
    }
    if (attempt >= 3 || classify(result.stderr + result.stdout) !== "transient") return null;
    const label = opts.label || `gh api ${opts.method || "GET"} ${endpoint}`;
    warn(`${label} 第 ${attempt} 次失败（网络类），${[1, 4][attempt - 1]} 秒后重试`);
    sleepSync([1000, 4000][attempt - 1]);
  }
}

