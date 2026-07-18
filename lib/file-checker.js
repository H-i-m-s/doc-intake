import fs from "node:fs/promises";
import path from "node:path";
import { DocIntakeError } from "./errors.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx", ".xlsm"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

/**
 * 检测文件类型
 * @param {string} filePath
 * @returns {"pdf"|"image"|"office"|"html"|"unknown"}
 */
export function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  return "unknown";
}

/**
 * 获取文件大小（MB）
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export async function getFileSizeMB(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size / (1024 * 1024);
}

/**
 * 获取 PDF 页数（使用 pypdf）。
 *
 * 不 fallback 到系统 `python` —— 用户没填 pythonPath 一律 throw，
 * 跟 service.js 的 `PYTHON_PATH_NOT_CONFIGURED` 硬校验保持一致。
 *
 * @param {string} filePath
 * @param {string} pythonPath
 * @returns {Promise<number>}
 * @throws {DocIntakeError} PYTHON_PATH_NOT_CONFIGURED when pythonPath missing
 */
export async function getPdfPageCount(filePath, pythonPath) {
  if (!pythonPath) {
    throw new DocIntakeError(
      "未在插件配置中指定 Python 环境 (pythonPath)。请打开插件配置面板填写。",
      {
        code: "PYTHON_PATH_NOT_CONFIGURED",
        details: { configKey: "pythonPath" },
      }
    );
  }
  const script = `
import sys
from pypdf import PdfReader
try:
    reader = PdfReader(sys.argv[1])
    print(len(reader.pages))
except Exception as e:
    print("-1", file=sys.stderr)
    sys.exit(1)
`;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const result = await execFileAsync(pythonPath, ["-c", script, filePath], {
    timeout: 30000,
  });
  return parseInt(result.stdout.trim(), 10);
}
