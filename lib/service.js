import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { getSettings, parseCredentials, parseTokens } from "./settings.js";
export { parseCredentials, parseTokens };
import { detectFileType } from "./file-checker.js";
import { DocIntakeError } from "./errors.js";
import { createLogger } from "./logger.js";
import { buildAgentPayload } from "./doc-intake-helpers.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('service');

/** Python 侧进度行的固定前缀，两边必须逐字一致（见 python/main.py 的 _PROGRESS_PREFIX）。 */
const PROGRESS_PREFIX = "@@PROGRESS ";

/** 解析一条进度行。解析不了就返回 null，调用方当作普通 stderr 日志处理。 */
function parseProgressLine(line) {
  const at = line.indexOf(PROGRESS_PREFIX);
  if (at < 0) return null;
  try {
    const parsed = JSON.parse(line.slice(at + PROGRESS_PREFIX.length));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeProcessOutput(text, settings) {
  let value = String(text || "");
  const secrets = [];
  for (const token of settings?.paddleTokens || []) {
    if (token) secrets.push(String(token));
  }
  for (const credential of settings?.mineruCredentials || []) {
    if (typeof credential === "string") {
      secrets.push(credential);
    } else if (credential && typeof credential === "object") {
      if (credential.accessKey) secrets.push(String(credential.accessKey));
      if (credential.secretKey) secrets.push(String(credential.secretKey));
    }
  }
  for (const secret of secrets) {
    value = value.split(secret).join("[REDACTED]");
  }
  // 自建 MinerU 的 API Key 也可能随服务端报错回显。
  const localKey = settings?.mineruLocalApiKey;
  if (typeof localKey === "string" && localKey) {
    value = value.split(localKey).join("[REDACTED]");
  }
  return value;
}

function selectBackend(source, explicitBackend) {
  if (explicitBackend && explicitBackend !== "auto") {
    return explicitBackend;
  }
  // auto: 透传给 Python 端，让 select_backend_chain 按 file_type + settings.pdfBackendChain 选 chain。
  // 这里同时返回 file_type 给 logger 显示，不走 mergedSettings.defaultBackend。
  return "auto";
}

// 这里只传递调用方明确指定的目录；「这次要不要落盘、落在哪」整体交给 Python 决定。
//
// 为什么不在 JS 侧算：JS 进程受 Node Permission Model 限制，只能读安装目录、app-data
// 和宿主 locales。savePath 留空时要判断「系统文档目录在不在」，这个探测在 JS 侧必然抛
// ERR_ACCESS_DENIED（是抛异常，不是返回 false），于是每次读设置都会炸，哪怕这次调用
// 根本不落盘。Python 子进程不受该模型限制，由它在真正要写的那一刻判断，既合法，
// 也省掉一次提前猜测。落盘与否、默认位置都由 python/main.py 的 determine_output_dir
// 统一裁决（含 autoSave 与 summaryOnly）。
function determineOutputDir(input) {
  return input.outputDir || null;
}

export async function extractDocument(input, ctx) {
  const startTime = Date.now();

  const {
    source,
    backend: explicitBackend,
    pageRange,
    language,
    includeMedia,
    saveJson,
    splitOnly,
    summaryOnly,
  } = input;

  if (!source || typeof source !== "string") {
    throw new DocIntakeError("source 必须是文件路径或 URL", { code: "INVALID_SOURCE" });
  }

  const settings = getSettings(ctx);
  const backend = selectBackend(source, explicitBackend);
  const outputDir = determineOutputDir(input);
  const shouldIncludeMedia = includeMedia !== undefined ? includeMedia : settings.includeMedia;
  const shouldSaveJson = saveJson !== undefined ? saveJson : settings.saveJson;

  // 调参数覆盖 settings：不要直接修改 getSettings 返回的对象（多文件并发会污染），用副本。
  // 同时保留 includeImages 别名,extractor 内部仍在用 include_images 参数,
  // 但 settings 是 includeMedia 字段,这里同步一下避免 main.py 读不到。
  const mergedSettings = {
    ...settings,
    includeMedia: shouldIncludeMedia,
    includeImages: shouldIncludeMedia,
    saveJson: shouldSaveJson,
    // 落盘决策已下放到 Python，summaryOnly 必须一起透传：否则「只要状态」这一档
    // 在 Python 侧认不出来，会出现摘要里没有 mdPath 的空档。
    summaryOnly: summaryOnly === true,
  };
  if (language != null) mergedSettings.defaultLanguage = language;
  // 只在 explicit 后端时写 defaultBackend；auto 时不写，让 Python 端按 settings.pdfBackendChain 选 chain。
  if (backend !== "auto") mergedSettings.defaultBackend = backend;

  // 记录请求开始（auto 时带上 file_type 便于看）
  const displayBackend = backend === "auto" ? `auto(${detectFileType(source)})` : backend;
  // 实际落点由 Python 决定，这里只记 JS 侧已知的：显式目录，或「按配置自动落盘」。
  const logSaveTarget = outputDir
    || (settings.autoSave || summaryOnly === true ? "auto" : null);
  logger.logRequest(source, displayBackend, logSaveTarget);

  const pythonExe = settings.pythonPath;
  if (!pythonExe) {
    throw new DocIntakeError(
      "未在应用设置中指定 Python 环境 (pythonPath)。请打开 App 设置面板填写,默认或意外的 PATH python 不再作为 fallback。",
      {
        code: "PYTHON_PATH_NOT_CONFIGURED",
        details: {
          configKey: "pythonPath",
          hint: "例如 conda 环境填 <conda 目录>/envs/<环境名>/python.exe，或系统 python 填 <安装目录>/python.exe。填你机器上的实际路径。",
        },
      }
    );
  }
  const scriptPath = path.join(CURRENT_DIR, "..", "python", "main.py");

  const args = [
    scriptPath,
    "--source", source,
  ];

  if (outputDir) args.push("--output-dir", outputDir);
  if (pageRange) args.push("--page-range", pageRange);
  if (splitOnly) args.push("--split-only");

  logger.debug("启动 Python 进程", {
    pythonExe,
    scriptPath,
    args: args.slice(1) // 移除脚本路径，只记录参数
  });

  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        DOC_INTAKE_LOG_LEVEL: mergedSettings.logLevel || "INFO",
        ...(mergedSettings.logFile
          ? { DOC_INTAKE_LOG_FILE: mergedSettings.logFile }
          : {}),
      },
      windowsHide: true,
      // PaddleOCR 轮询最长 600 秒，给 Python 留出完整执行窗口。
      timeout: 660000,
    });

    // 敏感凭证通过一次性 stdin 管道传递，不进入 Python 子进程环境块。
    child.stdin.end(JSON.stringify(mergedSettings));

    let stdout = "";
    let stderr = "";
    let progressBuffer = "";

    // 进度行和第三方日志共用 stderr，只能按行切开：带前缀的交给回调，
    // 其余的照旧累积进 stderr —— 出错时的错误信息一点都不能丢。
    const emitProgress = typeof ctx?.onProgress === "function" ? ctx.onProgress : null;
    const consumeStderrLine = (rawLine) => {
      const line = rawLine.replace(/\r$/, "");
      if (line.includes(PROGRESS_PREFIX)) {
        const payload = parseProgressLine(line);
        if (payload) {
          if (emitProgress) {
            try {
              emitProgress(payload);
            } catch (error) {
              // 回调是上层的代码，它抛错不能把提取结果一起拖垮。
              logger.debug("进度回调抛错", { error: error?.message || String(error) });
            }
          }
          return;
        }
      }
      stderr += line + "\n";
    };

    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });
    child.stderr.on("data", chunk => {
      progressBuffer += String(chunk);
      let newline = progressBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = progressBuffer.slice(0, newline);
        progressBuffer = progressBuffer.slice(newline + 1);
        consumeStderrLine(line);
        newline = progressBuffer.indexOf("\n");
      }
    });

    child.on("error", error => {
      logger.exception("Python 进程启动失败", error);
      reject(new DocIntakeError(`Python 执行失败: ${error.message}`, {
        code: "SPAWN_FAILED",
        details: {
          spawnError: error.message,
          spawnCode: error.code,
        },
      }));
    });

    child.on("close", code => {
      // 最后一行可能没有换行符，close 之前得把它冲出来，否则会静默丢一条进度或一行报错。
      if (progressBuffer) {
        consumeStderrLine(progressBuffer);
        progressBuffer = "";
      }
      const duration = Date.now() - startTime;

      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout);
          const result = {
            markdown: parsed.markdown || '',
            images: Array.isArray(parsed.images) ? parsed.images : [],
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
            metadata: parsed.metadata || {},
            outputDir: parsed.outputDir || null,
          };

          // 记录响应
          logger.logResponse(
            result.markdown.length,
            result.images.length,
            duration
          );

          resolve(result);
        } catch (parseError) {
          logger.error("解析 Python 输出失败", {
            stdout: stdout.slice(0, 200),
            error: parseError.message
          });
          resolve({ markdown: stdout, images: [], warnings: [] });
        }
        return;
      }

      logger.error("Python 提取失败", {
        exitCode: code,
        stderr: sanitizeProcessOutput(stderr, mergedSettings).slice(0, 2000),
        stdout: stdout.slice(0, 500),
        duration
      });

      reject(new DocIntakeError(`Python 提取失败，退出码 ${code}。`, {
        code: "PYTHON_ERROR",
        details: {
          exitCode: code,
          stderr: sanitizeProcessOutput(stderr, mergedSettings).slice(0, 2000),
          stdout: stdout.slice(0, 500),
          durationMs: duration,
        },
      }));
    });
  });
}

export function formatAgentPayload(result) {
  return buildAgentPayload(result);
}