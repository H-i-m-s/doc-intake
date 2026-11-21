/**
 * card-renderer-state-budget.ts — generated from shared/card-renderer-state-budget.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * 卡 rendererState 整包预算（Node/browser 纯模块）。
 *
 * 一张卡的 `rendererState` 是**一个**持久化整体：archive 归档它、实例态写它、
 * 视图快照（`appViewState`）也住在它里面。每个子键各有自己的上限（视图快照
 * 24KiB、hana.state 64KiB）时，合起来仍可能越过归档边界——子键预算管不住整包。
 *
 * 本模块只做一件事：量整包。它不校验形状、不猜业务字段、不 trim/截断/删子键，
 * 也不取代视图快照内核的严格 JSON 校验（那是 `appViewState` 自己的契约）。调用
 * 方在**实际写边界**用它兜底，把「各自合规、合并越界」显式拒掉。
 *
 * 纯模块：不碰 fs/env/全局 store，浏览器与隔离 App 子进程都能直接加载。
 */
/** 单张卡 rendererState 序列化后（含 JSON 标点、键名、转义）的 UTF-8 字节上限。 */
export const CARD_RENDERER_STATE_MAX_BYTES = 64 * 1024;
const TEXT_ENCODER = new TextEncoder();
/**
 * 量一份待写的 rendererState 整包。
 *
 * - `undefined` 表示「没有 rendererState 字段」，0 字节；`null` 是真正的 JSON
 *   `null`，按 `"null"`（4 字节）计。
 * - 无法序列化（BigInt、循环引用、顶层函数/符号）显式返回 `invalid-json`，不把
 *   原生 `TypeError` 抛给调用方。
 * - 超限返回 `too-large`，调用方据此报自己的可行动错误码。
 */
export function checkCardRendererStateBudget(value) {
    if (value === undefined)
        return { ok: true, bytes: 0 };
    let json;
    try {
        json = JSON.stringify(value);
    }
    catch {
        return { ok: false, reason: 'invalid-json', maxBytes: CARD_RENDERER_STATE_MAX_BYTES };
    }
    // JSON.stringify 对顶层函数/符号返回 undefined（不是字符串），同样算不可编码。
    if (typeof json !== 'string') {
        return { ok: false, reason: 'invalid-json', maxBytes: CARD_RENDERER_STATE_MAX_BYTES };
    }
    const bytes = TEXT_ENCODER.encode(json).length;
    if (bytes > CARD_RENDERER_STATE_MAX_BYTES) {
        return { ok: false, reason: 'too-large', maxBytes: CARD_RENDERER_STATE_MAX_BYTES };
    }
    return { ok: true, bytes };
}
/**
 * 这份 rendererState 自己是否带 `appViewState` 子键。
 *
 * 只认 record 上的**自有**键：原型链继承来的 `appViewState` 不是这张卡的数据，
 * 不该把它拖进视图快照的共存约束。用于把「从未接入 F 的旧卡」与「已有视图快照
 * 的卡」分开——前者保持原行为，不因新规则突然被拒。
 */
export function hasAppViewState(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    return Object.prototype.hasOwnProperty.call(value, 'appViewState');
}
//# sourceMappingURL=card-renderer-state-budget.js.map