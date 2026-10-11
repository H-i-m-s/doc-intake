// ui/components.mjs — 界面用到的小工具。
//
// 从 magpie-hana 的 ui/components.mjs 拷来（2026-10-11，那份又是从 token-tracker-app 取的）：
// 那边这个文件还装着格式化、胶囊按钮、单位行、排序等一堆东西，本 App 的界面用不到，只搬了 h()。
// 保持同名同签名，是为了让一起拷过来的 ui/assets/update-notice.mjs 一个字都不用改。

/**
 * 造元素。几个约定（跟 token-tracker 那边一致）：
 *   className / dataset 有专门的处理；on* 且值是函数时挂事件；其余当属性写；
 *   null / false 的子节点直接跳过（方便写 `cond ? h(...) : null`）。
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "className") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) el.append(...child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
  return el;
}
