// 统一日志模块 - Node 端
//
// 设计:
// - 同名 context 共享一个 logger 实例(handler 不重复)
// - 所有级别一律走 console.error (避免污染 stdout,JS 端 spawn 也会写到 JSON)
// - 与 python/logger.py 的格式对齐: [time] [LEVEL] [context] msg [k=v k=v]

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
  CRITICAL: 4,
};

class DocIntakeLogger {
  constructor(context = "doc-intake") {
    this.context = context;
    this.level = this._getLogLevel();
  }

  _getLogLevel() {
    const levelStr = (process.env.DOC_INTAKE_LOG_LEVEL || "INFO").toUpperCase();
    return LOG_LEVELS[levelStr] ?? LOG_LEVELS.INFO;
  }

  _formatKwargs(data) {
    if (!data || typeof data !== "object") return "";
    return Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
  }

  _emit(levelName, msg, data = null) {
    if (LOG_LEVELS[levelName] < this.level) return;

    const ts = new Date().toISOString();
    const kw = this._formatKwargs(data);
    const line = kw
      ? `[${ts}] [${levelName}] [${this.context}] ${msg} ${kw}`
      : `[${ts}] [${levelName}] [${this.context}] ${msg}`;

    // 一律走 stderr:避免污染 stdout,JS 端 spawn stdout 通常承载 JSON 协议
    console.error(line);
  }

  debug(msg, data = null) { this._emit("DEBUG", msg, data); }
  info(msg, data = null) { this._emit("INFO", msg, data); }
  warning(msg, data = null) { this._emit("WARNING", msg, data); }
  error(msg, data = null) { this._emit("ERROR", msg, data); }
  critical(msg, data = null) { this._emit("CRITICAL", msg, data); }

  exception(msg, err, data = null) {
    this.error(msg, { ...(data || {}), error: err?.message, stack: err?.stack });
  }

  logRequest(source, backend, outputDir = null) {
    this.info("请求开始", { source, backend, outputDir: outputDir || "None" });
  }

  logResponse(markdownLength, imageCount, durationMs) {
    this.info("请求完成", { markdownLength, imageCount, durationMs: `${durationMs.toFixed(1)}` });
  }

  logFallback(fromBackend, toBackend, reason) {
    this.warning("后端降级", { fromBackend, toBackend, reason });
  }

  logApiCall(apiName, success, durationMs, error = null) {
    if (success) {
      this.info(`${apiName} 调用成功`, { durationMs: `${durationMs.toFixed(1)}` });
    } else {
      this.error(`${apiName} 调用失败`, { durationMs: `${durationMs.toFixed(1)}`, error: error || "未知错误" });
    }
  }

  logFileOperation(operation, path, success, size = null) {
    if (success) {
      this.info(`文件${operation}成功`, { path, size: size || "unknown" });
    } else {
      this.error(`文件${operation}失败`, { path });
    }
  }
}

// 同名 logger 共享一个实例(handler 不重复添加)
const _instances = new Map();
export function createLogger(context) {
  const key = context || "doc-intake";
  if (!_instances.has(key)) {
    _instances.set(key, new DocIntakeLogger(key));
  }
  return _instances.get(key);
}

export const defaultLogger = createLogger("doc-intake");