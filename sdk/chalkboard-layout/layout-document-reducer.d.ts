import type { ChalkboardCardInstanceId, ChalkboardChildSizing, ChalkboardLayoutCommand, ChalkboardLayoutDocument, ChalkboardLayoutNode, ChalkboardLayoutNodeId, ChalkboardLayoutSurface } from './layout-document.js';
import type { ChalkboardCardContentBinding } from './chalkboard-card-types.js';
/** export 供 离场重称（chalkboard-slice 的 settleDepartureRowWeights）
 *  定位被移卡节点；卡不存在时抛 ChalkboardLayoutError，调用侧自行 catch。 */
export declare function findCardNodeId(doc: ChalkboardLayoutDocument, cardInstanceId: ChalkboardCardInstanceId): ChalkboardLayoutNodeId;
/** export 供 离场重称沿 parent 链收集祖先 row；无父返回 null。 */
export declare function findParentNodeId(nodes: Record<ChalkboardLayoutNodeId, ChalkboardLayoutNode>, childId: ChalkboardLayoutNodeId): ChalkboardLayoutNodeId | null;
/** column 轴条目读时收敛：
 *  高度轴迄今没有任何合法的 fixed/minPx/maxPx 写入来源——存量 column 条目
 *  里的这些字段全部是宽度语义污染（跨轴组排继承、同轴插入的定义默认、
 *  reconcile 的定义 minPx 抬升）。一刀切收敛：
 *  - fixed → { kind: 'elastic', weight: max(px, 1) }（fixed 兄弟间 px 比例
 *    即权重比例，视觉连续）
 *  - elastic/fill → 保留 kind 与 weight，剥除 minPx/maxPx
 *  已合法的条目原样返回（迁移幂等）。未来卡定义声明高度契约时（填表日），
 *  本函数与 column-axis-sizing 不变式测试一并修订。 */
export declare function reconcileColumnAxisSizing(sizing: ChalkboardChildSizing): ChalkboardChildSizing;
export declare function mergeCollapsedChildSizing(parentSizing: ChalkboardChildSizing | undefined, childSizing: ChalkboardChildSizing | undefined): ChalkboardChildSizing | undefined;
export declare function mergePromotedChildSizing(childSizing: ChalkboardChildSizing | undefined, parentSizing: ChalkboardChildSizing | undefined): ChalkboardChildSizing | undefined;
export declare function normalizeChalkboardLayoutDocument(doc: ChalkboardLayoutDocument): ChalkboardLayoutDocument;
/** export 供测试直接单元验证（见 defaultPlacementStackReference 同款理由），
 *  也供调用侧判断某节点子树是否含指定卡实例（如聊天主卡永不被竖切判断）。 */
export declare function subtreeContainsCardInstance(nodes: Record<ChalkboardLayoutNodeId, ChalkboardLayoutNode>, nodeId: ChalkboardLayoutNodeId, cardInstanceId: ChalkboardCardInstanceId): boolean;
export interface DefaultPlacementStackTarget {
    referenceNodeId: ChalkboardLayoutNodeId;
    edge: 'bottom' | 'right';
}
/**
 * insertCard 默认落位（default placement）的参照解析：单卡页先向右分栏，
 * 多卡页优先放到最右卡下方，竖排封顶 2 张，host 主卡永不被竖切。
 * 返回非空时，调用侧走 insertSiblingAtEdge(referenceNodeId, edge)；返回
 * null 时回退 attachNodeToSurfaceRoot（空页填满 / 另起最右新列）。
 * 按 root 形态分流：
 * - row root（主页 / 群聊页 / 多格页）：
 *   1. 空 → null；最右子项子树含受保护 host 主卡 → null（优先于封顶）
 *   2. 最右子项是 children >= CAP 的 column（已封顶）→ null（另起新列）
 *   3. 最右子项是未封顶 column → 该 column 末 child + bottom（同轴续叠）
 *   4. 其余单格 → 最右子项 + bottom（跨轴 wrap 成竖列）
 * - slot root（空白页模板的单格形态）：空 → null（attach 填满）；已有
 *   内容 → root + bottom（insertSiblingAtEdge 的 root 提升分支把根包装成
 *   column [旧格, 新卡]，根 id 不变）
 * - column root（单格页叠过一次后的形态）：未封顶 → 末 child + bottom；
 *   已封顶 → root + right（root 提升包装成 row [旧竖列, 新卡]，另起新列，
 *   此后回到 row root 分流）
 */
/** export 供测试直接单元验证 row 分支 rule 3（列内单孩子同轴 append）——
 *  该状态在真实命令流水线里不可持久存在（normalize 会把非根、单孩子的
 *  column 折叠掉，见 normalizeChalkboardLayoutDocument 的 "!isSurfaceRoot"
 *  折叠分支），只能靠直接单元调用验证这条分支的返回值契约。 */
export declare function defaultPlacementStackReference(nodes: Record<ChalkboardLayoutNodeId, ChalkboardLayoutNode>, surface: ChalkboardLayoutSurface): DefaultPlacementStackTarget | null;
/**
 * 卡内容级 doc 助手：binding 属于卡内容，只写 doc.cards 上的字段，不属于
 * ChalkboardLayoutCommand 词汇表——命令式布局变换（reduceChalkboardLayoutCommands）
 * 之外允许直调，唯一生产调用方是 chalkboard-slice.ts 的
 * updateChalkboardCardContent / rebindChalkboardPreviewCard。卡不存在时
 * 经 requireCard 抛 NODE_NOT_FOUND，不吞不兜底。
 */
export declare function updateCardBinding(doc: ChalkboardLayoutDocument, cardInstanceId: ChalkboardCardInstanceId, binding: ChalkboardCardContentBinding | null): ChalkboardLayoutDocument;
/** 卡内容级 doc 助手：title 版本，语义同 updateCardBinding（见其注释）。 */
export declare function updateCardTitle(doc: ChalkboardLayoutDocument, cardInstanceId: ChalkboardCardInstanceId, title: string | null): ChalkboardLayoutDocument;
export declare function applyChalkboardLayoutCommand(doc: ChalkboardLayoutDocument, command: ChalkboardLayoutCommand): ChalkboardLayoutDocument;
//# sourceMappingURL=layout-document-reducer.d.ts.map