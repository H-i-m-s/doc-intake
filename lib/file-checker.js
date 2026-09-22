import path from "node:path";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const OFFICE_EXTENSIONS = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".xlsm"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

/**
 * 检测文件类型（纯字符串判断，不触碰文件系统）。
 * @param {string} filePath
 * @returns {"pdf"|"image"|"office"|"html"|"unknown"}
 */
export function detectFileType(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (PDF_EXTENSIONS.has(ext)) return "pdf";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (OFFICE_EXTENSIONS.has(ext)) return "office";
  if (HTML_EXTENSIONS.has(ext)) return "html";
  return "unknown";
}
