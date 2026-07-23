// doc-intake 共享 helper,给 JS 端用。
//
// buildAgentPayload: 把 extractor 出来的 result( markdown / images / warnings )
// 拼成给 Agent 看的纯文本,统一追加引导词和媒体提示。
// appendMediaGuide: 给 markdown 追加媒体引导词(用于 batch 单文件输出)。

const KIND_ICON = {
  image: "📷",
  video: "🎬",
  audio: "🎵",
  other: "📎",
};

const KIND_LABEL = {
  image: "图片",
  video: "视频",
  audio: "音频",
  other: "媒体",
};

const IMAGE_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "svg",
  "tif", "tiff", "emf", "wmf", "wdp",
]);
const VIDEO_EXT = new Set([
  "mp4", "mov", "webm", "m4v", "avi", "wmv",
]);
const AUDIO_EXT = new Set([
  "mp3", "wav", "m4a", "ogg", "flac", "aac",
]);

/**
 * 按文件扩展名推断媒体类型。不依赖上游传 kind 字段。
 * @param {string} path 媒体路径
 * @returns {"image"|"video"|"audio"|"other"}
 */
function classifyByExt(path) {
  const m = String(path).toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? m[1] : "";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "other";
}

/**
 * 统计媒体按 kind 分组的数量。
 * @param {string[]} paths 媒体路径列表
 * @returns {{image:number, video:number, audio:number, other:number}}
 */
function countByKind(paths) {
  const counts = { image: 0, video: 0, audio: 0, other: 0 };
  for (const p of paths) {
    counts[classifyByExt(p)] += 1;
  }
  return counts;
}

/**
 * 构建媒体引导文字。
 * @param {number} totalCount 媒体总数
 * @param {object} kindCounts 按 kind 计数 {image: N, video: N, audio: N, other: N}
 * @param {boolean} savedToLocal 是否已保存到本地
 */
function buildMediaGuide(totalCount, kindCounts, savedToLocal) {
  if (!totalCount || totalCount === 0) return "";
  const parts = [];
  for (const k of ["image", "video", "audio", "other"]) {
    if (kindCounts[k] > 0) {
      parts.push(`${KIND_ICON[k]} ${kindCounts[k]} ${KIND_LABEL[k]}`);
    }
  }
  const breakdown = parts.length > 1 ? `（${parts.join("、")}）` : "";
  const saved = savedToLocal ? "，已保存到本地" : "";
  return `\n\n---\n\n📎 提取了 ${totalCount} 个媒体文件${breakdown}${saved}。请先阅读以上媒体，再结合文档内容回复。`;
}

export function buildAgentPayload(result) {
  const lines = [];
  if (result.markdown) {
    lines.push(result.markdown);
  }
  const media = result.images || [];
  if (media.length > 0) {
    const kindCounts = countByKind(media);
    lines.push(buildMediaGuide(media.length, kindCounts, !!result.outputDir));
    if (result.outputDir) {
      lines.push(`媒体已保存到: ${result.outputDir}`);
    } else {
      lines.push(`媒体路径: ${media.join(", ")}`);
    }
  }
  if (result.warnings && result.warnings.length > 0) {
    lines.push("");
    lines.push("⚠️ 警告:");
    result.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  return lines.join("\n");
}

/**
 * 给 markdown 追加媒体引导词。
 * @param {string} markdown
 * @param {number} mediaCount 媒体总数
 * @param {object} [kindCounts] 可选,按 kind 计数 {image, video, audio, other}
 */
export function appendMediaGuide(markdown, mediaCount, kindCounts, savedToLocal = true) {
  if (!mediaCount || mediaCount === 0) return markdown;
  const kc = kindCounts || { image: mediaCount };
  return markdown + buildMediaGuide(mediaCount, kc, savedToLocal);
}

// 向后兼容(部分旧调用方可能还在用)
export function appendImageGuide(markdown, imageCount) {
  return appendMediaGuide(markdown, imageCount, { image: imageCount });
}