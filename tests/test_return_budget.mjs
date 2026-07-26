import assert from "node:assert/strict";

import { buildResult } from "../tools/doc_intake.js";

function success(source, markdown, extra = {}) {
  return {
    ok: true,
    source,
    result: {
      markdown,
      metadata: {},
      ...extra,
    },
  };
}

function toolPayload(result) {
  return result.details.data;
}

function toolText(result) {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function testManyShortFilesReturnFully() {
  const sources = ["a.docx", "b.docx", "c.docx", "d.docx"];
  const result = buildResult(
    sources,
    sources.map((source) => success(source, `内容-${source}`)),
  );
  const payload = toolPayload(result);

  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, sources.length);
  assert.match(toolText(result), /## a\.docx/);
  assert.match(toolText(result), /内容-d\.docx/);
  assert.equal(payload[0].metadata.contentTruncated, undefined);
}

function testConfiguredBlocksPreserveCompleteUtf8Text() {
  const sourceMarkdown = "开头\n" + "中文内容".repeat(1800) + "\n结尾";
  const result = buildResult(
    ["configured.docx"],
    [success("configured.docx", sourceMarkdown)],
    { inlineBlockBytes: 8192, inlineBlockCount: 4 },
  );
  const payload = toolPayload(result);
  const blocks = result.content.filter((block) => block.type === "text");

  assert.equal(payload.metadata.contentTruncated, undefined);
  assert.equal(toolText(result), sourceMarkdown);
  assert.ok(blocks.length >= 2);
  assert.ok(blocks.every((block) => Buffer.byteLength(block.text, "utf8") <= 8192));
}

function testOversizedSavedResultReturnsPathsOnly() {
  const result = buildResult(
    ["long.docx"],
    [success("long.docx", "长内容".repeat(50000), {
      outputDir: "D:\\Agent\\输出",
      metadata: {
        mdPath: "D:\\Agent\\输出\\long.docx.md",
        imagesDir: "D:\\Agent\\输出\\long_media",
      },
    })],
  );
  const payload = toolPayload(result);

  assert.equal(payload.metadata.contentOmitted, true);
  assert.equal(payload.files[0].metadata.mdPath, "D:\\Agent\\输出\\long.docx.md");
  assert.equal(payload.files[0].markdown, undefined);
  assert.match(toolText(result), /long\.docx/);
}

function testUtf8ContentAtMinimumConfiguredBlock() {
  const sourceMarkdown = "中文字符";
  const result = buildResult(
    ["tiny.docx"],
    [success("tiny.docx", sourceMarkdown)],
    { inlineBlockBytes: 4096, inlineBlockCount: 1 },
  );
  assert.equal(toolText(result), sourceMarkdown);
}

function testOversizedUnsavedResultKeepsHeadAndTailAcrossBlocks() {
  const sourceMarkdown = "开头标记\n" + "中间内容".repeat(50000) + "\n结尾标记";
  const result = buildResult(
    ["long.docx"],
    [success("long.docx", sourceMarkdown)],
  );
  const payload = toolPayload(result);
  const blocks = result.content.filter((block) => block.type === "text");
  const returnedText = toolText(result);

  assert.equal(payload.metadata.contentTruncated, true);
  assert.match(returnedText, /开头标记/);
  assert.match(returnedText, /结尾标记/);
  assert.match(returnedText, /中间内容已省略/);
  assert.match(returnedText, /返回内容超过 4 × 28 KiB/);
  assert.equal(blocks.length, 4);
  assert.ok(blocks.every((block) => Buffer.byteLength(block.text, "utf8") <= 28 * 1024));
  assert.ok(returnedText.length < sourceMarkdown.length);
}

testManyShortFilesReturnFully();
testConfiguredBlocksPreserveCompleteUtf8Text();
testOversizedSavedResultReturnsPathsOnly();
testUtf8ContentAtMinimumConfiguredBlock();
testOversizedUnsavedResultKeepsHeadAndTailAcrossBlocks();
console.log("return-budget-tests-ok (5 tests)");
