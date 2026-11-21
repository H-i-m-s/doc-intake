import { detectCategory } from "./formats.js";

/**
 * 检测文件类型（纯字符串判断，不触碰文件系统）。
 * 粗类清单来自 lib/formats.js（源自仓库根的 formats.json），这里不再另存一份。
 * @param {string} filePath
 * @returns {"pdf"|"image"|"office"|"html"|"ebook"|"unknown"}
 */
export function detectFileType(filePath) {
  return detectCategory(filePath) ?? "unknown";
}
