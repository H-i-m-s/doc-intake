/**
 * 卡片三态形态（v2 推荐的新作者路径）。内容与卡体的关系：
 *   · framed        内容内缩，卡体里有一层内缩 frame；标题区占位、默认显示
 *   · structural    内容直接构成卡体，不额外套内层 frame；标题区占位、默认显示
 *   · edge-to-edge  内容铺满整个卡体（含顶部）；Chrome 悬浮，标题默认隐藏
 * 相对旧的两轴（`cardForm: framed|flush` × `titlebar: solid|translucent`），三态把
 * 形态收敛到一个字段；标题显示策略独立由 `titleMode` 控制。
 */
export const APP_CARD_FORMS = ["framed", "structural", "edge-to-edge"];
/** 标题显示策略：auto 由三态派生；show / hide 显式覆盖。 */
export const APP_CARD_TITLE_MODES = ["auto", "show", "hide"];
/**
 * 历史 `cardForm` 写法。读时仍被接受并映射回旧观感（新作者不要使用）：
 *   · fill    = flush + 透明标题带
 *   · unified = flush（标题带那一维交还给 `titlebar`）
 *   · flush   内容贴卡体
 * @deprecated 用三态值（如 `cardForm: "structural"`）声明形态，标题策略改用 `titleMode`。
 */
export const APP_CARD_FORMS_LEGACY = ["flush", "fill", "unified"];
//# sourceMappingURL=manifest.js.map