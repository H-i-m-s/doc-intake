// 降级链拖拽让位的位移算法：只测纯函数，不碰 DOM。
// 跑法：node --test test/chain-shift.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { chainShiftOffsets, chainDragTo } from "../ui/assets/chain-shift.mjs";

// 行距按 1 个单位记：断言里 1 = 往下让一格，-1 = 往上让一格。
test("from=0 to=2：向下拖，跨过的行上移一格", () => {
  assert.deepEqual(chainShiftOffsets(0, 2, 5), [0, -1, -1, 0, 0]);
});

test("from=2 to=0：向上拖，让开的行下移一格", () => {
  assert.deepEqual(chainShiftOffsets(2, 0, 5), [1, 1, 0, 0, 0]);
});

test("from=1 to=1：原地不动，谁都不让", () => {
  assert.deepEqual(chainShiftOffsets(1, 1, 5), [0, 0, 0, 0, 0]);
});

test("from=0 to=4：一直拖到末尾", () => {
  assert.deepEqual(chainShiftOffsets(0, 4, 5), [0, -1, -1, -1, -1]);
});

test("from=4 to=0：从末尾拖到最前", () => {
  assert.deepEqual(chainShiftOffsets(4, 0, 5), [1, 1, 1, 1, 0]);
});

test("被拖行自己永远是 0", () => {
  for (let from = 0; from < 5; from += 1) {
    for (let to = 0; to < 5; to += 1) {
      assert.equal(chainShiftOffsets(from, to, 5)[from], 0, `from=${from} to=${to}`);
    }
  }
});

test("越界的 from / to 不产生越界写入", () => {
  assert.deepEqual(chainShiftOffsets(NaN, 2, 3), [0, 0, 0]);
  assert.deepEqual(chainShiftOffsets(0, 9, 3), [0, -1, -1]);
});

// DOM 那一步的索引换算：列表里有被拖行自己，插到它后面时索引要减一。
test("chainDragTo：ref 排在前面 → 索引不变", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const kids = [a, b, c];
  assert.deepEqual(chainDragTo(kids, c, a), { from: 2, to: 0 });
});

test("chainDragTo：ref 排在后面 → 索引减一", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const kids = [a, b, c];
  assert.deepEqual(chainDragTo(kids, a, c), { from: 0, to: 1 });
});

test("chainDragTo：落末尾且已经在末尾 → from 等于 to（不重排）", () => {
  const a = { id: "a" }, b = { id: "b" };
  const kids = [a, b];
  assert.deepEqual(chainDragTo(kids, b, null), { from: 1, to: 1 });
});

test("chainDragTo：落末尾但从中间来 → 插到最后", () => {
  const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
  const kids = [a, b, c];
  assert.deepEqual(chainDragTo(kids, a, null), { from: 0, to: 2 });
});
