/**
 * Token 验证模块
 * 支持 MinerU 和 PaddleOCR 两种后端的 token/credential 验证
 */
import https from "node:https";
import http from "node:http";

const MINERU_TASK_URL = "https://mineru.net/api/v4/extract/task";
const PADDLE_JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";

/**
 * 对单个 MinerU token 做验证
 * 提交一个极小的任务看 auth 是否通过
 * @param {string} credential - MinerU credential (accessKey 或 {accessKey, secretKey} 对象)
 * @returns {Promise<{ok: boolean, key: string, message: string}>}
 */
export async function validateMineruCredential(credential) {
  const token = typeof credential === "string"
    ? credential
    : (credential.accessKey || credential.secretKey || "");

  if (!token) {
    return { ok: false, key: maskKey(token), message: "空的 Token" };
  }

  try {
    const result = await httpsRequest(MINERU_TASK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        url: "https://cdn-mineru.openxlab.org.cn/demo/example.pdf",
        model_version: "vlm",
        is_ocr: false,
        enable_formula: false,
        enable_table: false,
        language: "ch",
        page_ranges: "1",
      }),
      timeout: 15000,
    });

    if (result.statusCode === 200) {
      return { ok: true, key: maskKey(token), message: "Token 有效" };
    }

    let body = {};
    try { body = JSON.parse(result.body); } catch {}

    const code = body.code || body.error?.code || "";
    const msg = body.msg || body.error?.message || result.statusMessage || "未知错误";

    if (code === "A0202" || result.statusCode === 401) {
      return { ok: false, key: maskKey(token), message: `Token 无效` };
    }
    if (code === "A0211") {
      return { ok: false, key: maskKey(token), message: `Token 已过期` };
    }
    // 其他错误（如配额不足等）也标记为无效
    return { ok: false, key: maskKey(token), message: `${msg} (${result.statusCode})` };
  } catch (err) {
    return { ok: false, key: maskKey(token), message: `验证失败: ${err.message}` };
  }
}

/**
 * 对单个 PaddleOCR token 做验证
 * 提交一个极小的 OCR 任务看 auth 是否通过
 * @param {string} token
 * @returns {Promise<{ok: boolean, key: string, message: string}>}
 */
export async function validatePaddleToken(token) {
  if (!token) {
    return { ok: false, key: maskKey(token), message: "空的 Token" };
  }

  try {
    const result = await httpsRequest(PADDLE_JOB_URL, {
      method: "POST",
      headers: {
        "Authorization": `bearer ${token}`,
      },
      body: JSON.stringify({
        model: "PaddleOCR-VL-1.6",
        optionalPayload: JSON.stringify({}),
      }),
      timeout: 15000,
    });

    if (result.statusCode === 200) {
      return { ok: true, key: maskKey(token), message: "Token 有效" };
    }

    if (result.statusCode === 401 || result.statusCode === 403) {
      return { ok: false, key: maskKey(token), message: "Token 无效" };
    }

    if (result.statusCode === 400) {
      return { ok: true, key: maskKey(token), message: "Token 有效（认证通过，但请求参数不完整）" };
    }

    const msg = result.statusMessage || "未知错误";
    return { ok: false, key: maskKey(token), message: `${msg} (${result.statusCode})` };
  } catch (err) {
    return { ok: false, key: maskKey(token), message: `验证失败: ${err.message}` };
  }
}

/**
 * 验证所有已配置的凭证
 * @param {object} settings - 插件设置
 * @returns {Promise<{mineru: Array, paddle: Array}>}
 */
export async function validateAllCredentials(settings) {
  const mineruCreds = settings.mineruCredentials || [];
  const paddleTokens = settings.paddleTokens || [];

  const mineruResults = await Promise.allSettled(
    mineruCreds.map((c) => validateMineruCredential(c))
  );

  const paddleResults = await Promise.allSettled(
    paddleTokens.map((t) => validatePaddleToken(t))
  );

  return {
    mineru: mineruResults.map((r, i) =>
      r.status === "fulfilled" ? r.value : { ok: false, key: maskKey(String(mineruCreds[i])), message: r.reason?.message || "验证异常" }
    ),
    paddle: paddleResults.map((r, i) =>
      r.status === "fulfilled" ? r.value : { ok: false, key: maskKey(String(paddleTokens[i])), message: r.reason?.message || "验证异常" }
    ),
  };
}

/**
 * 格式化验证结果为可读文本
 */
export function formatValidationResult(results) {
  const lines = [];

  if (results.mineru.length > 0) {
    lines.push("## MinerU Token");
    results.mineru.forEach((r, i) => {
      const icon = r.ok ? "✅" : "❌";
      lines.push(`  Token ${i + 1} (${r.key}): ${icon} ${r.message}`);
    });
  }

  if (results.paddle.length > 0) {
    lines.push("## PaddleOCR Token");
    results.paddle.forEach((r, i) => {
      const icon = r.ok ? "✅" : "❌";
      lines.push(`  Token ${i + 1} (${r.key}): ${icon} ${r.message}`);
    });
  }

  if (results.mineru.length === 0 && results.paddle.length === 0) {
    lines.push("⚠️ 未配置任何 Token，请先在插件设置中配置 MinerU 或 PaddleOCR 的凭证。");
  }

  const validCount = [...results.mineru, ...results.paddle].filter((r) => r.ok).length;
  const totalCount = results.mineru.length + results.paddle.length;
  lines.push("");
  lines.push(`**结果**: ${validCount}/${totalCount} 个 Token 有效`);

  return lines.join("\n");
}

// ---- 工具函数 ----

function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function httpsRequest(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const mod = isHttps ? https : http;

    const req = mod.request(
      urlObj,
      {
        method: options.method || "GET",
        headers: {
          ...options.headers,
          ...(options.body ? { "Content-Length": Buffer.byteLength(options.body) } : {}),
        },
        timeout: options.timeout || 10000,
        rejectUnauthorized: true,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            body: data,
            headers: res.headers,
          });
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时"));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
