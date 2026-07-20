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
    const kinds = result.media_kinds || [];
    const kindCounts = { image: 0, video: 0, audio: 0, other: 0 };
    for (const k of kinds) {
      if (kindCounts[k] === undefined) kindCounts.other += 1;
      else kindCounts[k] += 1;
    }
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
export function appendMediaGuide(markdown, mediaCount, kindCounts) {
  if (!mediaCount || mediaCount === 0) return markdown;
  const kc = kindCounts || { image: mediaCount };
  return markdown + buildMediaGuide(mediaCount, kc, true);
}

// 向后兼容(部分旧调用方可能还在用)
export function appendImageGuide(markdown, imageCount) {
  return appendMediaGuide(markdown, imageCount, { image: imageCount });
}