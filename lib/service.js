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

function selectBackend(source, explicitBackend) {
  if (explicitBackend && explicitBackend !== "auto") {
    return explicitBackend;
  }
  // auto: 透传给 Python 端，让 select_backend_chain 按 file_type + settings.pdfBackendChain 选 chain。
  // 这里同时返回 file_type 给 logger 显示，不走 mergedSettings.defaultBackend。
  return "auto";
}

function determineOutputDir(input, settings) {
  const { outputDir } = input;

  // 1. 命令行参数优先
  if (outputDir) {
    return outputDir;
  }

  // 2. 自动保存配置
  if (settings.autoSave) {
    return settings.savePath;
  }

  // 3. 无输出目录
  return null;
}

export async function extractDocument(input, ctx) {
  const startTime = Date.now();

  const { source, backend: explicitBackend, pageRange, language, includeImages, saveJson, splitOnly } = input;

  if (!source || typeof source !== "string") {
    throw new DocIntakeError("source 必须是文件路径或 URL", { code: "INVALID_SOURCE" });
  }

  const settings = getSettings(ctx);
  const backend = selectBackend(source, explicitBackend);
  const outputDir = determineOutputDir(input, settings);
  const shouldIncludeImages = includeImages !== undefined ? includeImages : settings.includeImages;
  const shouldSaveJson = saveJson !== undefined ? saveJson : settings.saveJson;

  // 调参数覆盖 settings：不要直接修改 getSettings 返回的对象（多文件并发会污染），用副本。
  const mergedSettings = {
    ...settings,
    includeImages: shouldIncludeImages,
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
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", DOC_INTAKE_SETTINGS: JSON.stringify(mergedSettings) },
      windowsHide: true,
      timeout: 300000,
    });

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
        stderr: stderr.slice(0, 2000),
        stdout: stdout.slice(0, 500),
        duration
      });

      reject(new DocIntakeError(`Python 提取失败，退出码 ${code}。`, {
        code: "PYTHON_ERROR",
        details: {
          exitCode: code,
          stderr: stderr.slice(0, 2000),
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