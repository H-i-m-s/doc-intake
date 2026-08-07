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

function determineOutputDir(input, settings) {
  const { outputDir, summaryOnly } = input;

  // 1. 用户明确指定的目录优先
  if (outputDir) {
    return outputDir;
  }

  // 2. 自动保存配置
  if (settings.autoSave) {
    return settings.savePath;
  }

  // 3. summaryOnly 必须留下可读取的完整结果，否则 Agent 只有状态而没有路径
  if (summaryOnly === true) {
    return settings.savePath;
  }

  // 4. 普通提取不指定输出目录时只返回内联内容
  return null;
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
  const outputDir = determineOutputDir(input, settings);
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
  };
  if (language != null) mergedSettings.defaultLanguage = language;
  // 只在 explicit 后端时写 defaultBackend；auto 时不写，让 Python 端按 settings.pdfBackendChain 选 chain。
  if (backend !== "auto") mergedSettings.defaultBackend = backend;

  // 记录请求开始（auto 时带上 file_type 便于看）
  const displayBackend = backend === "auto" ? `auto(${detectFileType(source)})` : backend;
  logger.logRequest(source, displayBackend, outputDir);

  const pythonExe = settings.pythonPath;
  if (!pythonExe) {
    throw new DocIntakeError(
      "未在插件配置中指定 Python 环境 (pythonPath)。请打开插件配置面板填写,默认或意外的 PATH python 不再作为 fallback。",
      {
        code: "PYTHON_PATH_NOT_CONFIGURED",
        details: {
          configKey: "pythonPath",
          hint: "例如 conda 环境填 E:\\Conda\\envs_dirs\\Agent\\python.exe,或系统 python 填 C:\\Python311\\python.exe。完全按用户设置走。",
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

    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
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