import assert from "node:assert/strict";

import { parsePythonOutput } from "../lib/service.js";
import { buildResult } from "../tools/doc_intake.js";

function testPythonOutputParseFailureIsRejected() {
  assert.throws(
    () => parsePythonOutput("not-json secret-token", { paddleTokens: ["secret-token"] }),
    (error) => {
      assert.equal(error.code, "PYTHON_OUTPUT_PARSE_FAILED");
      assert.match(error.message, /Python 输出解析失败/);
      assert.doesNotMatch(error.details.stdout, /secret-token/);
      return true;
    },
  );
}

function testBatchWarningsDoNotTurnSuccessIntoFailure() {
  const payload = buildResult(
    ["success-with-warning.pdf", "success.pdf", "failed.pdf"],
    [
      {
        ok: true,
        source: "success-with-warning.pdf",
        result: {
          markdown: "内容 A",
          metadata: { warnings: ["后端发生降级，但提取成功"] },
        },
      },
      {
        ok: true,
        source: "success.pdf",
        result: { markdown: "内容 B", metadata: {} },
      },
      {
        ok: false,
        source: "failed.pdf",
        error: new Error("提取失败"),
      },
    ],
    { summaryThreshold: 3 },
  );

  assert.equal(payload.details.data.metadata.success, 2);
  assert.match(payload.details.data.markdown, /处理完成：2\/3 个文件成功/);
  assert.match(payload.details.data.markdown, /✅ success-with-warning\.pdf/);
  assert.match(payload.details.data.markdown, /✅ success\.pdf/);
  assert.match(payload.details.data.markdown, /❌ failed\.pdf/);
}

testPythonOutputParseFailureIsRejected();
testBatchWarningsDoNotTurnSuccessIntoFailure();
console.log("review-js-tests-ok (2 tests)");
