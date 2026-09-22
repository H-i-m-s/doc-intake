import type { ChalkboardCardInstanceId, ChalkboardChildSizing, ChalkboardLayoutDocument } from './layout-document.js';
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
export declare function explicitDefaultInsertedChildSizing(definitionId?: string): ChalkboardChildSizing | null;
/**
 * 卡的宽度契约：定义默认 sizing，若卡持有 cardSizeIntents（用户拖宽过的
 * 意图宽）且定义是 fixed，则用意图宽（经定义 min/max 钳制）覆盖 px。
 * row 轴插入新卡（attachNodeToSurfaceRoot 等）与 column 分支折算
 * （cardWidthContractOfChild）共用本函数。
 */
export declare function insertedChildSizing(doc: ChalkboardLayoutDocument, definitionId?: string, cardInstanceId?: ChalkboardCardInstanceId): ChalkboardChildSizing;
//# sourceMappingURL=layout-card-width-contracts.d.ts.map