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

function testSummaryOnlyReturnsPerFileStatusWithoutMarkdown() {
  const result = buildResult(
    ["ok.docx", "warn.pdf", "failed.xlsx"],
    [
      success("ok.docx", "完整正文"),
      success("warn.pdf", "正文", { metadata: { warnings: ["检测到扫描页"] } }),
      {
        ok: false,
        source: "failed.xlsx",
        error: new Error("解析失败原因"),
      },
    ],
    {},
    { summaryOnly: true },
  );
  const payload = toolPayload(result);

  assert.equal(payload.metadata.summaryOnly, true);
  assert.equal(payload.metadata.contentOmitted, true);
  assert.equal(payload.metadata.success, 2);
  assert.equal(payload.metadata.failed, 1);
  assert.deepEqual(
    payload.files.map((file) => [file.name, file.status]),
    [["ok.docx", "success"], ["warn.pdf", "success"], ["failed.xlsx", "failed"]],
  );
  assert.equal(payload.files[0].markdown, undefined);
  assert.deepEqual(payload.files[1].metadata.warnings, ["检测到扫描页"]);
  assert.match(payload.markdown, /✅ ok\.docx/);
  assert.match(payload.markdown, /✅ warn\.pdf/);
  assert.match(payload.markdown, /❌ failed\.xlsx — 解析失败原因/);
  assert.doesNotMatch(toolText(result), /完整正文/);
}

function testSummaryOnlyPreservesSavedPaths() {
  const result = buildResult(
    ["saved.docx"],
    [success("saved.docx", "正文", {
      outputDir: "D:\\Agent\\输出",
      metadata: {
        mdPath: "D:\\Agent\\输出\\saved.docx.md",
        mediaDir: "D:\\Agent\\输出\\saved_media",
        mediaPaths: [
          "D:\\Agent\\输出\\saved_media\\image_001.png",
          "D:\\Agent\\输出\\saved_media\\image_002.png",
        ],
        jsonPath: "D:\\Agent\\输出\\saved.docx.json",
      },
    })],
    { mediaPathReturnLimit: 20 },
    { summaryOnly: true },
  );
  const payload = toolPayload(result);
  const pathBlock = JSON.parse(result.content.at(-1).text);

  assert.equal(payload.files[0].status, "success");
  assert.equal(payload.files[0].metadata.mdPath, "D:\\Agent\\输出\\saved.docx.md");
  assert.equal(payload.files[0].metadata.mediaDir, "D:\\Agent\\输出\\saved_media");
  assert.deepEqual(payload.files[0].metadata.mediaPaths, [
    "D:\\Agent\\输出\\saved_media\\image_001.png",
    "D:\\Agent\\输出\\saved_media\\image_002.png",
  ]);
  assert.equal(payload.files[0].metadata.jsonPath, "D:\\Agent\\输出\\saved.docx.json");
  assert.deepEqual(pathBlock.doc_intake_paths[0].mediaPaths, payload.files[0].metadata.mediaPaths);
}

function testMediaPathReturnLimitUsesDirectoryAndCount() {
  const mediaPaths = Array.from({ length: 21 }, (_, index) =>
    `D:\\Agent\\输出\\saved_media\\image_${String(index + 1).padStart(3, "0")}.png`,
  );
  const result = buildResult(
    ["many-media.docx"],
    [success("many-media.docx", "正文", {
      metadata: {
        mdPath: "D:\\Agent\\输出\\many-media.docx.md",
        mediaDir: "D:\\Agent\\输出\\many-media_media",
        mediaPaths,
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  const pathBlock = JSON.parse(result.content.at(-1).text);

  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\many-media_media");
  assert.equal(payload.metadata.mediaCount, 21);
  assert.equal(payload.metadata.mediaPaths, undefined);
  assert.equal(pathBlock.doc_intake_paths[0].mediaCount, 21);
  assert.equal(pathBlock.doc_intake_paths[0].mediaPaths, undefined);
}

function testOversizedSavedResultReturnsPathsOnly() {
  const result = buildResult(
    ["long.docx"],
    [success("long.docx", "长内容".repeat(50000), {
      outputDir: "D:\\Agent\\输出",
      metadata: {
        mdPath: "D:\\Agent\\输出\\long.docx.md",
        mediaDir: "D:\\Agent\\输出\\long_media",
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

function testZeroMediaStillReturnsMediaDirWithoutCount() {
  const result = buildResult(
    ["no-media.docx"],
    [success("no-media.docx", "正文", {
      metadata: { mediaDir: "D:\\Agent\\输出\\no-media_media", mediaPaths: [] },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\no-media_media");
  assert.deepEqual(payload.metadata.mediaPaths, []);
  assert.equal(payload.metadata.mediaCount, undefined);
}

function testRelativeOutputPathsBecomeAbsolute() {
  const result = buildResult(
    ["relative.docx"],
    [success("relative.docx", "正文", {
      metadata: {
        mdPath: "out\\relative.docx.md",
        mediaDir: "out\\relative_media",
        mediaPaths: ["out\\relative_media\\image.png"],
        jsonPath: "out\\relative.docx.json",
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  const paths = JSON.parse(result.content.at(-1).text).doc_intake_paths[0];
  assert.ok(payload.metadata.mdPath.includes("relative.docx.md"));
  assert.ok(payload.metadata.mediaDir.includes("relative_media"));
  assert.ok(payload.metadata.mediaPaths[0].includes("image.png"));
  assert.ok(payload.metadata.jsonPath.includes("relative.docx.json"));
  assert.equal(paths.mdPath, payload.metadata.mdPath);
}

function testMediaPathWithoutDirUsesAbsolutePathDirectory() {
  const result = buildResult(
    ["absolute-media.docx"],
    [success("absolute-media.docx", "正文", {
      metadata: {
        mdPath: "D:\\Agent\\输出\\absolute-media.docx.md",
        mediaPaths: ["D:\\Agent\\输出\\absolute-media_media\\image.png"],
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\absolute-media_media");
  assert.deepEqual(payload.metadata.mediaPaths, [
    "D:\\Agent\\输出\\absolute-media_media\\image.png",
  ]);
  assert.equal(payload.metadata.mediaCount, undefined);
}

function testRelativeMediaWithoutDirUsesMarkdownDirectory() {
  const result = buildResult(
    ["relative-media.docx"],
    [success("relative-media.docx", "正文", {
      outputDir: "D:\\Agent\\输出",
      metadata: {
        mdPath: "D:\\Agent\\输出\\relative-media.docx.md",
        mediaPaths: ["relative-media_media\\image.png"],
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\relative-media_media");
  assert.deepEqual(payload.metadata.mediaPaths, [
    "D:\\Agent\\输出\\relative-media_media\\image.png",
  ]);
  assert.equal(payload.metadata.mediaCount, undefined);
}

function testMixedMediaPathsUseInferredDirectory() {
  const result = buildResult(
    ["mixed-media.docx"],
    [success("mixed-media.docx", "正文", {
      metadata: {
        mediaPaths: [
          "D:\\Agent\\输出\\mixed-media_media\\image_001.png",
          "image_002.png",
        ],
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\mixed-media_media");
  assert.deepEqual(payload.metadata.mediaPaths, [
    "D:\\Agent\\输出\\mixed-media_media\\image_001.png",
    "D:\\Agent\\输出\\mixed-media_media\\image_002.png",
  ]);
  assert.equal(payload.metadata.mediaCount, undefined);
}

function testPartiallyResolvedMediaReturnsTotalCount() {
  const unresolvedResult = buildResult(
    ["partial-media.docx"],
    [success("partial-media.docx", "正文", {
      metadata: {
        mediaDir: "D:\\Agent\\输出\\partial-media_media",
        mediaPaths: [
          "D:\\Agent\\输出\\partial-media_media\\image_001.png",
          { invalid: true },
        ],
      },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const unresolvedPayload = unresolvedResult.details.data;
  assert.equal(unresolvedPayload.metadata.mediaCount, 2);
  assert.equal(unresolvedPayload.metadata.mediaPaths, undefined);
  assert.match(unresolvedPayload.metadata.warnings[0], /缺少可用的绝对路径基准/);
}

function testRelativeMediaWithoutAnyBaseKeepsUnresolvedCount() {
  const result = buildResult(
    ["unresolved-media.docx"],
    [success("unresolved-media.docx", "正文", {
      metadata: { mediaPaths: ["image.png", "table.png"] },
    })],
    { mediaPathReturnLimit: 20 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, undefined);
  assert.equal(payload.metadata.mediaPaths, undefined);
  assert.equal(payload.metadata.mediaCount, 2);
  assert.match(payload.metadata.warnings[0], /缺少可用的绝对路径基准/);
}

function testMediaPathReturnLimitZeroReturnsCount() {
  const result = buildResult(
    ["zero-limit.docx"],
    [success("zero-limit.docx", "正文", {
      metadata: {
        mediaDir: "D:\\Agent\\输出\\zero_media",
        mediaPaths: ["D:\\Agent\\输出\\zero_media\\image.png"],
      },
    })],
    { mediaPathReturnLimit: 0 },
  );
  const payload = toolPayload(result);
  assert.equal(payload.metadata.mediaDir, "D:\\Agent\\输出\\zero_media");
  assert.equal(payload.metadata.mediaCount, 1);
  assert.equal(payload.metadata.mediaPaths, undefined);
}

testManyShortFilesReturnFully();
testConfiguredBlocksPreserveCompleteUtf8Text();
testSummaryOnlyReturnsPerFileStatusWithoutMarkdown();
testSummaryOnlyPreservesSavedPaths();
testMediaPathReturnLimitUsesDirectoryAndCount();
testZeroMediaStillReturnsMediaDirWithoutCount();
testRelativeOutputPathsBecomeAbsolute();
testMediaPathWithoutDirUsesAbsolutePathDirectory();
testRelativeMediaWithoutDirUsesMarkdownDirectory();
testMixedMediaPathsUseInferredDirectory();
testPartiallyResolvedMediaReturnsTotalCount();
testRelativeMediaWithoutAnyBaseKeepsUnresolvedCount();
testMediaPathReturnLimitZeroReturnsCount();
testOversizedSavedResultReturnsPathsOnly();
testUtf8ContentAtMinimumConfiguredBlock();
testOversizedUnsavedResultKeepsHeadAndTailAcrossBlocks();
console.log("return-budget-tests-ok (16 tests)");
