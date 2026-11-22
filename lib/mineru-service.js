// 本地 MinerU 的「谁拉起、谁关掉」都收在这里。
//
// python/mineru_service.py 是守护脚本，本文是它在 App 侧的对手方：
// 解析前问一句「这次用哪个地址」，用完（idle=0 时）喊它收工。
// 三条不能破的规矩：
//   1. 设置里填了地址就用它，只探活，绝不启动、绝不杀（那是用户自己的实例）。
//   2. 只有 service.json 记的 pid 活着、命令行含 mineru-kit、端口对得上，三者都对
//      才允许动手；用户在 8000 上自己起的实例永远不在这条路上。
//   3. 同一进程里只拉起一次（单例 Promise），三个文件同时解析不该起三个服务。
//
// 状态文件全在 sdk.dataDir 下的 mineru-service/，不在仓库、不在输出目录。

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUPERVISOR_SCRIPT = path.join(CURRENT_DIR, "..", "python", "mineru_service.py");

export const DEFAULT_LOCAL_PORT = 8010;
export const DEFAULT_IDLE_SECONDS = 300;

/** 拉起之后等 health 的上限。守护脚本自己是 120 秒，这边留一点余量给它写日志。 */
const START_HEALTH_TIMEOUT_MS = 90_000;
/** stop() 先给 SIGTERM，等它自己收工；超时就树杀。 */
const STOP_GRACE_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_500;
const HEALTH_POLL_INTERVAL_MS = 500;

const STATE_DIR_NAME = "mineru-service";
const STATE_FILE = "service.json";
const ACTIVITY_FILE = "activity";
const LOG_FILE = "service.log";

/** 判断「这个 pid 是我们的」时认的关键字，与 python/mineru_service.py 的 KIT_MARKER 一致。 */
const KIT_MARKER = "mineru-kit";

let state = { dataDir: "", logger: null };
/** 单例：同一进程里并发调 resolveEndpoint 只拉起一次。 */
let inflight = null;

/**
 * App 启动时调一次。dataDir 只能来自宿主（sdk.dataDir），不自己猜路径。
 * stateDir 只是给测试用的旁路，生产不传。
 */
export function configureMineruService({ dataDir, logger, stateDir } = {}) {
  state = {
    dataDir: typeof dataDir === "string" ? dataDir : "",
    logger: logger || null,
    stateDir: typeof stateDir === "string" && stateDir ? stateDir : "",
  };
}

function log(level, message, fields) {
  const sink = state.logger;
  const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
  try {
    if (sink && typeof sink[level] === "function") sink[level](line);
  } catch {
    // 日志失败不能影响解析。
  }
}

function boolValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/** 把 getSettings 的返回值补成这里需要的形状；缺字段一律按出厂值算。 */
function normalize(settings) {
  const raw = settings && typeof settings === "object" ? settings : {};
  const port = Number(raw.mineruLocalPort);
  const idle = Number(raw.mineruLocalIdleSeconds);
  return {
    pythonPath: typeof raw.pythonPath === "string" ? raw.pythonPath.trim() : "",
    mineruKitPath: typeof raw.mineruKitPath === "string" ? raw.mineruKitPath.trim() : "",
    mineruLocalPort: Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : DEFAULT_LOCAL_PORT,
    mineruLocalIdleSeconds: Number.isFinite(idle) && idle >= 0 ? Math.trunc(idle) : DEFAULT_IDLE_SECONDS,
    mineruLocalAutoStart: boolValue(raw.mineruLocalAutoStart, true),
    mineruLocalEndpoint: typeof raw.mineruLocalEndpoint === "string" ? raw.mineruLocalEndpoint.trim() : "",
  };
}

function stateDir() {
  if (state.stateDir) return state.stateDir;
  if (!state.dataDir) return "";
  return path.join(state.dataDir, STATE_DIR_NAME);
}

function statePath(name) {
  const dir = stateDir();
  return dir ? path.join(dir, name) : "";
}

function ownEndpoint(s) {
  return `http://127.0.0.1:${s.mineruLocalPort}`;
}

function trimEndpoint(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

// ---------------------------------------------------------------- 探活

/** GET {endpoint}/v1/health，2xx 算通。任何网络错误都只是「没通」，不抛。 */
export function probeHealth(endpoint, timeoutMs = HEALTH_PROBE_TIMEOUT_MS) {
  const base = trimEndpoint(endpoint);
  if (!base) return Promise.resolve(false);
  let url;
  try {
    url = new URL(`${base}/v1/health`);
  } catch {
    return Promise.resolve(false);
  }
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = client.request(
      {
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      },
      (res) => {
        res.resume();
        done(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
    req.end();
  });
}

async function waitHealth(endpoint, timeoutMs, shouldStop) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probeHealth(endpoint)) return true;
    if (shouldStop && shouldStop()) return false;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
}

/** 读 service.log 的最后几行：拉起失败时给用户看的理由就在那里。 */
function tailLog(maxLines = 2) {
  const file = statePath(LOG_FILE);
  if (!file) return "";
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const span = Math.min(size, 2048);
      const buffer = Buffer.alloc(span);
      fs.readSync(fd, buffer, 0, span, size - span);
      const lines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
      return lines.slice(-maxLines).join(" / ");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- 进程身份

function pidAlive(pid) {
  const value = Number(pid);
  if (!Number.isFinite(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    // EPERM = 进程在，只是没权限发信号；ESRCH = 没了。
    return error?.code === "EPERM";
  }
}

function readRecord(s) {
  const file = statePath(STATE_FILE);
  if (!file) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const pid = Number(parsed.pid);
    const childPid = Number(parsed.child_pid);
    const port = Number(parsed.port);
    if (!Number.isFinite(pid) || !Number.isFinite(port)) return null;
    return {
      pid,
      childPid: Number.isFinite(childPid) ? childPid : null,
      port,
      kit: typeof parsed.kit === "string" ? parsed.kit : "",
      startedAt: typeof parsed.started_at === "string" ? parsed.started_at : "",
    };
  } catch {
    return null;
  }
}

function removeRecord() {
  const file = statePath(STATE_FILE);
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== "ENOENT") log("warn", "删除 service.json 失败", { error: error?.message });
  }
}

/** 取命令行做身份核对。读不到就返回空串（宁可不杀，也不误杀）。 */
function commandLineOf(pid) {
  const value = Number(pid);
  if (!Number.isFinite(value) || value <= 0) return "";
  const args = process.platform === "win32"
    ? [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${value}"; if ($p) { [Console]::Out.Write($p.CommandLine) }`,
      ]
    : ["-NoProfile", "-NonInteractive", "-Command", `ps -o args= -p ${value}`];
  const exe = process.platform === "win32" ? "powershell" : "pwsh";
  try {
    const result = spawnSync(exe, args, { encoding: "utf8", timeout: 25_000, windowsHide: true });
    if (result.error || result.status !== 0) {
      log("warn", "读进程命令行失败", {
        pid: value,
        status: result.status,
        error: result.error ? String(result.error.message) : null,
        stderr: String(result.stderr || "").slice(0, 200),
      });
      return "";
    }
    return String(result.stdout || "").trim();
  } catch (error) {
    log("warn", "读进程命令行抛错", { pid: value, error: error?.message });
    return "";
  }
}

function isKitProcess(pid) {
  if (!pidAlive(pid)) return false;
  const line = commandLineOf(pid);
  if (!line) return false;
  return line.toLowerCase().includes(KIT_MARKER);
}

function treeKill(pid) {
  const value = Number(pid);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (process.platform !== "win32") {
    try {
      process.kill(-value, "SIGKILL");
      return true;
    } catch {
      try {
        process.kill(value, "SIGKILL");
        return true;
      } catch {
        return false;
      }
    }
  }
  try {
    const result = spawnSync("taskkill", ["/PID", String(value), "/T", "/F"], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function waitExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (!pidAlive(pid)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

// ---------------------------------------------------------------- 活跃时间

/** 每次真正解析前 touch 一次：supervisor 只看它的 mtime。 */
export function touch(settings) {
  const dir = stateDir();
  if (!dir) return false;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ACTIVITY_FILE), new Date().toISOString(), "utf8");
    return true;
  } catch (error) {
    log("warn", "更新 activity 失败", { error: error?.message });
    return false;
  }
}

function lastActivityAt() {
  const file = statePath(ACTIVITY_FILE);
  if (!file) return null;
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 拉起

function openLogFd() {
  const file = statePath(LOG_FILE);
  if (!file) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return fs.openSync(file, "a");
  } catch (error) {
    log("warn", "打开 service.log 失败", { error: error?.message });
    return null;
  }
}

function kitPathValid(kitPath) {
  if (!kitPath) return false;
  try {
    return fs.statSync(kitPath).isFile();
  } catch {
    return false;
  }
}

/** 起守护脚本。失败只回报原因，不抛。 */
function spawnSupervisor(s) {
  const dir = stateDir();
  if (!dir) return { ok: false, reason: "宿主没有给出 dataDir，无法记录自管实例" };
  if (!s.pythonPath) return { ok: false, reason: "没有配置 pythonPath，起不了守护脚本" };
  if (!kitPathValid(s.mineruKitPath)) {
    return { ok: false, reason: "没有配置有效的 mineru-kit 路径（或填的是目录）" };
  }

  const fd = openLogFd();
  // 每次拉起前先 touch：否则 activity 还是上一轮的旧 mtime，新守护脚本一上来就判定空闲。
  touch(s);
  let child;
  try {
    child = spawn(
      s.pythonPath,
      [
        SUPERVISOR_SCRIPT,
        "--kit", s.mineruKitPath,
        "--port", String(s.mineruLocalPort),
        "--idle-seconds", String(s.mineruLocalIdleSeconds),
        "--state-dir", dir,
      ],
      {
        // detached + unref：App 进程退出不该顺手把它带走，它自己盯父进程。
        detached: true,
        stdio: fd === null ? "ignore" : ["ignore", fd, fd],
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      },
    );
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 关不掉也无所谓 */ }
    }
    return { ok: false, reason: `拉起守护脚本失败：${error?.message || error}` };
  }
  if (fd !== null) {
    try { fs.closeSync(fd); } catch { /* 子进程已继承，父侧可以关 */ }
  }
  child.unref();
  log("info", "已拉起 MinerU 守护脚本", {
    supervisorPid: child.pid,
    port: s.mineruLocalPort,
    idleSeconds: s.mineruLocalIdleSeconds,
  });
  return { ok: true, pid: child.pid, child };
}

async function resolveManaged(s) {
  const endpoint = ownEndpoint(s);

  // 分支 2：自己的端口已经有人应答，且 service.json 记的 pid 还活着 = 上一轮留下的实例。
  if (await probeHealth(endpoint) && recordBelongsToUs(s)) {
    log("info", "复用自管 MinerU 实例", { endpoint });
    return { endpoint, managed: true, reason: "复用上一轮留下的自管实例" };
  }

  if (!s.mineruLocalAutoStart) {
    return {
      endpoint: null,
      managed: false,
      reason: `「需要时自动启动」已关，${endpoint} 上没有可用的服务`,
    };
  }

  // 端口上有人应答但不是我们拉起的：不接管、也不在上面再起一个。
  if (await probeHealth(endpoint)) {
    return {
      endpoint: null,
      managed: false,
      reason: `${endpoint} 已被其它进程占用（没有对应的 service.json），未接管`,
    };
  }

  const started = spawnSupervisor(s);
  if (!started.ok) return { endpoint: null, managed: false, reason: started.reason };

  // 守护脚本自己退出了就不必再等满 90 秒：kit 路径不对、端口被占、模型炸了，
  // 这些都会在几秒内表现为子进程退出，再干等下去只是让用户多等一分钟。
  const supervisorExited = () => started.child.exitCode !== null || started.child.signalCode !== null;
  const healthy = await waitHealth(endpoint, START_HEALTH_TIMEOUT_MS, supervisorExited);
  if (!healthy) {
    const tail = tailLog(4);
    const suffix = tail ? `；service.log 末行：${tail}` : "";
    return {
      endpoint: null,
      managed: false,
      reason: supervisorExited()
        ? `守护脚本已退出（退出码 ${started.child.exitCode ?? "?"}）${suffix}`
        : `已拉起自管实例，但 ${Math.round(START_HEALTH_TIMEOUT_MS / 1000)} 秒内 /v1/health 没通，看 ${statePath(LOG_FILE)}`,
    };
  }
  return { endpoint, managed: true, reason: "已拉起自管实例" };
}

/** service.json 记的 pid 活着，且记的端口就是当前配置的端口。 */
function recordBelongsToUs(s) {
  const record = readRecord(s);
  if (!record) return false;
  if (record.port !== s.mineruLocalPort) return false;
  return pidAlive(record.pid);
}

// ---------------------------------------------------------------- 对外四个口

/**
 * 决定这一次解析用哪个 MinerU 地址。
 * 永远不抛：拿不到就回 endpoint: null 加一句人话。
 */
export function resolveEndpoint(settings) {
  const s = normalize(settings);

  // 分支 1：设置里填了地址 → 只探活。通了用，不通就说清楚，不改用自管实例。
  const explicit = trimEndpoint(s.mineruLocalEndpoint);
  if (explicit) {
    return probeHealth(explicit).then((ok) => (ok
      ? { endpoint: explicit, managed: false, reason: "使用设置里填的地址" }
      : {
          endpoint: null,
          managed: false,
          reason: `设置里的地址 ${explicit} 不通（/v1/health 未通过），没有改用自管实例`,
        }));
  }

  if (!inflight) {
    inflight = resolveManaged(s).finally(() => { inflight = null; });
  }
  return inflight;
}

/** 按 service.json 停掉自己那一个。用户自起的实例不在射程内。 */
export async function stop(settings) {
  const s = normalize(settings);
  const record = readRecord(s);
  if (!record) return { ok: true, stopped: [], reason: "没有 service.json，没有自管实例可停" };
  if (record.port !== s.mineruLocalPort) {
    return {
      ok: true,
      stopped: [],
      reason: `service.json 记的端口是 ${record.port}，与当前配置的 ${s.mineruLocalPort} 不一致，不动它`,
    };
  }

  const stopped = [];
  const supervisorAlive = pidAlive(record.pid);

  // 先礼后兵：SIGTERM 让守护脚本自己收工（它会树杀子进程、删记录）。
  if (supervisorAlive) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch (error) {
      log("warn", "向守护脚本发 SIGTERM 失败", { error: error?.message });
    }
    await waitExit(record.pid, STOP_GRACE_MS);
    if (!pidAlive(record.pid)) stopped.push(record.pid);
  }

  // 到这儿还活着（Windows 上 SIGTERM 通常直接被 TerminateProcess，来不及收工），
  // 或者守护脚本已经没了但子进程还在 —— 两种都得树杀，杀之前逐项验身份。
  if (pidAlive(record.pid)) {
    if (isKitProcess(record.pid)) {
      if (treeKill(record.pid)) stopped.push(record.pid);
    } else {
      log("warn", "service.json 里的 supervisor pid 命令行不含 mineru-kit，不动它", { pid: record.pid });
    }
  }
  if (record.childPid && pidAlive(record.childPid) && isKitProcess(record.childPid)) {
    if (treeKill(record.childPid)) stopped.push(record.childPid);
  }

  removeRecord();
  log("info", "已停止自管 MinerU 实例", { stopped });
  return { ok: true, stopped, reason: stopped.length ? "已停止" : "记录的实例已退出，只清了记录" };
}

/** 设置页 / 日志用。纯读，不启动也不杀。 */
export async function status(settings) {
  const s = normalize(settings);
  const record = readRecord(s);
  const endpoint = ownEndpoint(s);
  const explicit = trimEndpoint(s.mineruLocalEndpoint);
  const alive = await probeHealth(explicit || endpoint);
  return {
    endpoint: explicit || endpoint,
    alive,
    managed: Boolean(record && record.port === s.mineruLocalPort && pidAlive(record.pid)),
    port: record?.port ?? s.mineruLocalPort,
    idleSeconds: s.mineruLocalIdleSeconds,
    lastActivityAt: lastActivityAt(),
    kit: record?.kit ?? "",
    startedAt: record?.startedAt ?? "",
  };
}
