import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSettings, parseCredentials, parseTokens } from "../lib/settings.js";
import { toToolError, toToolResult } from "../lib/tool-output.js";
import { DocIntakeError } from "../lib/errors.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const name = "doc_intake_validate";
export const description =
  "验证 MinerU 和 PaddleOCR 的 Token 是否有效。支持多个 Token 逐一验证，返回每个 Token 的状态。当用户要测试凭证、验证 Token、检查 API Key 是否可用时调用。";

export const parameters = {
  type: "object",
  properties: {
    backend: {
      type: "string",
      enum: ["all", "mineru", "paddleocr"],
      description: "要验证的后端（可选，默认 all）",
    },
  },
};

export async function execute(input = {}, ctx) {
  try {
    const settings = getSettings(ctx);
    const backend = input.backend || "all";
    const pythonExe = settings.pythonPath;
    if (!pythonExe) {
      throw new DocIntakeError(
        "未在插件配置中指定 Python 环境 (pythonPath)。请打开插件配置面板填写。",
        {
          code: "PYTHON_PATH_NOT_CONFIGURED",
          details: { configKey: "pythonPath" },
        },
      );
    }
    const scriptPath = path.join(CURRENT_DIR, "..", "python", "validate.py");

    // 准备参数
    const args = [scriptPath];

    if (backend === "all" || backend === "mineru") {
      const mineruCreds = settings.mineruCredentials || [];
      if (mineruCreds.length > 0) {
        args.push("--mineru-creds", JSON.stringify(mineruCreds));
      }
    }

    if (backend === "all" || backend === "paddleocr") {
      const paddleTokens = settings.paddleTokens || [];
      if (paddleTokens.length > 0) {
        const tokensStr = Array.isArray(paddleTokens)
          ? paddleTokens.join(";")
          : String(paddleTokens);
        args.push("--paddle-tokens", tokensStr);
      }
    }

    // 没有配置任何凭证
    if (args.length === 1) {
      const text = "⚠️ 未配置任何 Token，请先在插件设置中配置 MinerU 或 PaddleOCR 的凭证。\n\n" +
        "在设置 → 插件 → Doc Intake 中配置：\n" +
        "- mineruCredentials：MinerU Token（获取地址：https://mineru.net/apiManage/token）\n" +
        "- paddleTokens：PaddleOCR Token（获取地址：https://aistudio.baidu.com/account/accessToken）\n" +
        "多个 Token 用分号（;）分隔。";
      return toToolResult({ ok: true, note: "未配置 Token" }, text);
    }

    // 调 Python 脚本验证
    const result = await runPython(pythonExe, args);

    if (!result.ok) {
      return toToolResult(
        result,
        `验证脚本执行失败:\n${result.error}`
      );
    }

    // 格式化结果
    const text = formatResults(result.data);

    return toToolResult(result.data, text);
  } catch (error) {
    return toToolError(error, {
      action: name,
    });
  }
}

function runPython(pythonExe, args) {
  return new Promise((resolve) => {
    const child = spawn(pythonExe, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
      timeout: 120000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      resolve({ ok: false, error: `Python 执行失败: ${error.message}` });
    });

    child.on("close", (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(stdout);
          resolve({ ok: true, data });
        } catch {
          resolve({ ok: false, error: `解析输出失败: ${stdout.slice(0, 200)}` });
        }
      } else {
        const errMsg = stderr.slice(0, 500) || stdout.slice(0, 500);
        resolve({ ok: false, error: `退出码 ${code}: ${errMsg}` });
      }
    });
  });
}

function formatResults(data) {
  const lines = [];

  if (data.mineru && data.mineru.length > 0) {
    lines.push("## MinerU Token");
    data.mineru.forEach((r, i) => {
      const icon = r.ok ? "✅" : "❌";
      lines.push(`  Token ${i + 1} (${r.key}): ${icon} ${r.message}`);
    });
  }

  if (data.paddle && data.paddle.length > 0) {
    lines.push("## PaddleOCR Token");
    data.paddle.forEach((r, i) => {
      const icon = r.ok ? "✅" : "❌";
      lines.push(`  Token ${i + 1} (${r.key}): ${icon} ${r.message}`);
    });
  }

  if ((!data.mineru || data.mineru.length === 0) && (!data.paddle || data.paddle.length === 0)) {
    lines.push("⚠️ 未配置任何 Token，请先在插件设置中配置凭证。");
  }

  const summary = data.summary || { total: 0, valid: 0 };
  lines.push("");
  lines.push(`**结果**: ${summary.valid}/${summary.total} 个 Token 有效`);

  return lines.join("\n");
}
