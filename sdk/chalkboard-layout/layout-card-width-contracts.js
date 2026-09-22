/**
 * chalkboard-layout/layout-card-width-contracts.ts — generated from shared/chalkboard-layout/layout-card-width-contracts.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { CHALKBOARD_CHANNELS_STACK_DEFAULT_PX, CHALKBOARD_CHANNELS_STACK_MIN_PX, CHALKBOARD_CHAT_MIN_PX, CHALKBOARD_HOME_CHAT_TILE_ID, CHALKBOARD_PARALLEL_CHAT_DEFAULT_PX, CHALKBOARD_PARALLEL_CHAT_MIN_PX, CHALKBOARD_PARALLEL_CHAT_RENDERER_KIND, CHALKBOARD_PARALLEL_PREVIEW_RENDERER_KIND, CHALKBOARD_PREVIEW_DEFAULT_PX, CHALKBOARD_PREVIEW_MIN_PX, CHALKBOARD_PREVIEW_TILE_ID, CHALKBOARD_TILE_CHANNEL_CHAT, CHALKBOARD_TILE_CHANNEL_STACK, CHALKBOARD_TILE_WORKSPACE_DESK, CHALKBOARD_WORKSPACE_MIN_PX, } from './chalkboard-builtin-ids.js';
/**
 * 卡定义的宽度契约唯一源表——row 轴插入默认与 column 上卷折算共用（T3/T4）。
 * 从 layout-document-reducer.ts 提取（2026-07-09，T4 刀 2）：提取前这四个
 * 函数是 reducer 的模块私有函数，只服务"插入新卡时给 row 轴条目一个默认
 * sizing"（attachNodeToSurfaceRoot 等）与"定义驱动的读时归一"
 * （reconcileChildSizingKind）。刀 2 新增第三个消费方——
 * layout-document-sizing.ts 的 column 分支折算（cardWidthContractOfChild，
 * T4"跨轴取最大"的实现缺口补全）需要同一张表回答"这张卡的宽度契约
 * （下限 / 意图宽）是什么"。三处消费方共用同一源，任何一处改动立即对齐
 * 其余两处，避免三处字面量漂移。
 *
 * reducer 与 layout-document-sizing.ts 互不 import（无循环依赖）；本模块
 * 只依赖 chalkboard-builtin-ids.ts（常量）与 layout-document.ts（类型），
 * 不反向依赖 reducer 或 sizing，两个消费方分别单向 import 本模块即可。
 */
/**
 * 显式内置卡的定义 sizing；未知 definitionId（插件卡、terminal 等未列入
 * 显式分支的）返回 null，让通用 fallback 不参与读时归一（minPx 抬升只认
 * 显式内置卡，不能无差别抬到 fallback 卡上）。
 */
export function explicitDefaultInsertedChildSizing(definitionId) {
    if (definitionId === CHALKBOARD_HOME_CHAT_TILE_ID || definitionId === CHALKBOARD_TILE_CHANNEL_CHAT) {
        return { kind: 'fill', minPx: CHALKBOARD_CHAT_MIN_PX };
    }
    if (definitionId === CHALKBOARD_PREVIEW_TILE_ID) {
        return { kind: 'fixed', px: CHALKBOARD_PREVIEW_DEFAULT_PX, minPx: CHALKBOARD_PREVIEW_MIN_PX };
    }
    if (definitionId === CHALKBOARD_TILE_WORKSPACE_DESK) {
        // 文件资源管理器是弹性卡：只有硬下限，跟窗口按权重伸缩（chat fill=1，
        // desk 0.5 → 吃 1/3 剩余空间）；用户拖分割线重分配权重后按新值持久化。
        return { kind: 'elastic', weight: 0.5, minPx: CHALKBOARD_WORKSPACE_MIN_PX };
    }
    if (definitionId === CHALKBOARD_TILE_CHANNEL_STACK) {
        return { kind: 'fixed', px: CHALKBOARD_CHANNELS_STACK_DEFAULT_PX, minPx: CHALKBOARD_CHANNELS_STACK_MIN_PX };
    }
    if (definitionId === CHALKBOARD_PARALLEL_CHAT_RENDERER_KIND) {
        return { kind: 'fixed', px: CHALKBOARD_PARALLEL_CHAT_DEFAULT_PX, minPx: CHALKBOARD_PARALLEL_CHAT_MIN_PX };
    }
    if (definitionId === CHALKBOARD_PARALLEL_PREVIEW_RENDERER_KIND) {
        return { kind: 'fixed', px: CHALKBOARD_PREVIEW_DEFAULT_PX, minPx: CHALKBOARD_PREVIEW_MIN_PX };
    }
    return null;
}
function defaultInsertedChildSizing(definitionId) {
    return explicitDefaultInsertedChildSizing(definitionId) ?? { kind: 'fixed', px: 320, minPx: 240 };
}
function boundedIntentWidth(base, widthPx) {
    if (typeof widthPx !== 'number' || !Number.isFinite(widthPx) || widthPx <= 0)
        return null;
    const min = typeof base.minPx === 'number' && Number.isFinite(base.minPx) ? base.minPx : 0;
    const max = typeof base.maxPx === 'number' && Number.isFinite(base.maxPx) ? base.maxPx : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(Math.round(widthPx), min), max);
}
/**
 * 卡的宽度契约：定义默认 sizing，若卡持有 cardSizeIntents（用户拖宽过的
 * 意图宽）且定义是 fixed，则用意图宽（经定义 min/max 钳制）覆盖 px。
 * row 轴插入新卡（attachNodeToSurfaceRoot 等）与 column 分支折算
 * （cardWidthContractOfChild）共用本函数。
 */
export function insertedChildSizing(doc, definitionId, cardInstanceId) {
    const base = defaultInsertedChildSizing(definitionId);
    if (base.kind !== 'fixed' || !cardInstanceId)
        return base;
    const widthPx = boundedIntentWidth(base, doc.cardSizeIntents?.[cardInstanceId]?.widthPx);
    return widthPx === null ? base : { ...base, px: widthPx };
}
//# sourceMappingURL=layout-card-width-contracts.js.map