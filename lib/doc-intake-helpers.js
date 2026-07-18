// doc-intake 共享 helper,给 JS 端用。
//
// buildAgentPayload: 把 extractor 出来的 result( markdown / images / warnings )
// 拼成给 Agent 看的纯文本,统一追加引导词和图片提示。
// appendImageGuide: 给 markdown 追加图片引导词(用于 batch 单文件输出)。

const IMG_GUIDE = (count, outputDir) => `\n\n---\n\n📷 提取了 ${count} 张图片${
  outputDir ? "，已保存到本地" : ""
}。请先阅读以上图片，再结合文档内容回复。`;

export function buildAgentPayload(result) {
  const lines = [];
  if (result.markdown) {
    lines.push(result.markdown);
  }
  if (result.images && result.images.length > 0) {
    lines.push(IMG_GUIDE(result.images.length, result.outputDir));
    if (result.outputDir) {
      lines.push(`图片已保存到: ${result.outputDir}`);
    } else {
      lines.push(`图片路径: ${result.images.join(", ")}`);
    }
  }
  if (result.warnings && result.warnings.length > 0) {
    lines.push("");
    lines.push("⚠️ 警告:");
    result.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  return lines.join("\n");
}

export function appendImageGuide(markdown, imageCount) {
  if (!imageCount || imageCount === 0) return markdown;
  return markdown + IMG_GUIDE(imageCount, true);
}