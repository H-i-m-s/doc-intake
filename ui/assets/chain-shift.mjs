// 降级链拖拽的让位位移：纯函数，不碰 DOM，可以直接单测。
//
// 返回每个行索引该让开几个「行距」的倍数：负数向上让、正数向下让、0 不动。
// from 是被拖行当前所在的索引；to 是它松手后要落进去的索引。
// 两个索引都按「被拖行还占着坑的那份列表」来算，所以 to 已经做过往它后面插时减一的修正
// （见 chainDragTo）。行距（行高 + 行间距）由调用方乘上去，这里只谈格数。
export function chainShiftOffsets(from, to, count) {
  const out = new Array(count).fill(0);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return out;
  if (to > from) {
    // 往下拖：被让开的是它跨过去的那几行，整段上移一格
    for (let i = from + 1; i <= to && i < count; i += 1) out[i] = -1;
  } else if (to < from) {
    // 往上拖：被让开的那几行下移一格
    for (let i = to; i < from && i < count; i += 1) {
      if (i >= 0) out[i] = 1;
    }
  }
  return out;
}

// 落点参照元素 → 插入索引。被拖行自己还在列表里占着位置，
// 所以参照元素排在它后面时，真正插进去的索引要比 children 的索引小一。
export function chainDragTo(children, row, ref) {
  const from = children.indexOf(row);
  const raw = ref ? children.indexOf(ref) : children.length;
  return { from, to: raw > from ? raw - 1 : raw };
}
