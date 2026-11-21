// lib/formats.js — 支持格式的 JS 侧入口。
//
// 唯一权威来源是仓库根的 formats.json（随包发布），这里只是把它读成 JS 想要的三样东西：
// 扁平扩展名数组（describe 报给调用方）、扩展名 -> 粗类、以及按路径取粗类。
// file-checker 的 detectFileType 也走这里，所以「哪些扩展名算哪个粗类」不再另有一份。
//
// 读不到就退到下面的内联镜像：Node 侧读不到文件时不该让整个 App 起不来，但也绝不能
// 悄悄用一份和 json 不一样的清单，所以 FORMAT_MIRROR 与 formats.json 的一致性由
// release/selfcheck.mjs 第 8 节机器判定（它用正则把这段字面量抽出来逐项比对）。

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/** 读不到 formats.json 时用的镜像。必须与 formats.json 完全一致，自检会比对这段字面量。 */
const FORMAT_MIRROR = {
  "pdf": { ".pdf": "pdf" },
  "image": {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".bmp": "image",
    ".tiff": "image",
    ".tif": "image",
    ".webp": "image",
    ".gif": "image"
  },
  "office": {
    ".doc": "doc",
    ".docx": "docx",
    ".ppt": "ppt",
    ".pptx": "pptx",
    ".xls": "xls",
    ".xlsx": "xlsx",
    ".xlsm": "xlsm"
  },
  "html": {
    ".html": "html",
    ".htm": "html"
  },
  "ebook": {
    ".epub": "epub",
    ".fb2": "fb2",
    ".fbz": "fb2",
    ".cbz": "cbz",
    ".mobi": "mobi",
    ".azw": "mobi",
    ".azw3": "mobi",
    ".prc": "mobi"
  }
};

const FORMATS_JSON = fileURLToPath(new URL("../formats.json", import.meta.url));

/** 模块加载时读一次：这份清单是静态数据，没有热更新的需求。 */
const TABLE = (() => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(FORMATS_JSON, "utf8"));
  } catch (e) {
    console.warn(
      `[doc-intake] 读不到格式清单 ${FORMATS_JSON}（${(e && e.message) || e}），改用内置镜像；` +
        `镜像与 json 的一致性由 release/selfcheck.mjs 兜住`,
    );
    return FORMAT_MIRROR;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.warn(`[doc-intake] 格式清单 ${FORMATS_JSON} 的外层不是对象，改用内置镜像`);
    return FORMAT_MIRROR;
  }
  return parsed;
})();

/**
 * 全部受支持的扩展名，顺序稳定：先按 json 里粗类的顺序，再按粗类里的顺序。
 * 调用方（describe）按数组顺序展示，所以顺序算行为的一部分。
 * @type {string[]}
 */
export const FORMATS = Object.values(TABLE).flatMap((table) => Object.keys(table));

/**
 * 扩展名 -> 粗类（pdf / image / office / html / ebook）。
 * @type {Record<string, string>}
 */
export const CATEGORY_BY_EXT = Object.fromEntries(
  Object.entries(TABLE).flatMap(([category, table]) => Object.keys(table).map((ext) => [ext, category])),
);

/**
 * 按路径取粗类（只看字符串，不碰文件系统）。
 * 取后缀用 path.extname，与 file-checker 原来的判定逐字一致（`.bashrc` 这类没有后缀）。
 * @param {string} filePath
 * @returns {"pdf"|"image"|"office"|"html"|"ebook"|null}
 */
export function detectCategory(filePath) {
  const ext = extname(String(filePath ?? "")).toLowerCase();
  return CATEGORY_BY_EXT[ext] ?? null;
}
