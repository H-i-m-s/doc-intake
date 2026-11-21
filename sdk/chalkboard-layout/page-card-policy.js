/**
 * chalkboard-layout/page-card-policy.ts — generated from shared/chalkboard-layout/page-card-policy.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { CHALKBOARD_CHANNELS_PAGE_ID, CHALKBOARD_CHAT_PAGE_ID, CHALKBOARD_CODE_PAGE_ID, CHALKBOARD_STUDIO_PAGE_ID } from './chalkboard-builtin-ids.js';
import { CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID, CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID, CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID, CHALKBOARD_LAYOUT_HOME_SURFACE_ID, CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID, } from './layout-document-factory.js';
/**
 * 系统级 page / card 抽象（chalkboard 的唯一一处定义）。
 *
 * 黑板上只有两种东西：
 *   · page —— 一页。页可以向功能面板 / 侧边栏贡献内容，可以有自己的标题与
 *     图标；是否能被用户删掉，是**页**的属性（见 isChalkboardPageRemovable）。
 *   · card —— 页上的一张卡。卡可以被关闭、拖到别的页、拆成独立窗口。
 *
 * 一页可以由它的**页面配置**带出一张卡（page fixture，"配置级主卡"）：主页的
 * 聊天卡、群聊页的频道聊天卡、整页插件 / App（realization: "page"）那一页上的
 * 那张卡。这张卡不是一张可以拿走的普通卡，它就是这一页的正文，所以：
 *   · 不能关（要它消失，删掉它的页——若页本身可删）；
 *   · 不能离开它的页（拖去别的页、停靠到别的页都拒绝）；
 *   · 不能拆窗（想要独立窗口的内容，应当声明成普通 card，而不是 page）。
 * 在**同一页内**换位置、调宽度不受影响。
 *
 * 识别完全从布局文档推导，不依赖任何目录 / 运行时：卡的身份（内建固定 id 或
 * 插件绑定）决定它"声称"属于哪一页，卡当前所在的页（拆窗中的历史卡按其
 * returnSurfaceId 归页）与之相符，才算该页的配置级主卡。同一插件卡被当作普通
 * 卡落在别处时不受保护。
 */
/**
 * 不可删除的页：仅主页（聊天页）与工作室窗口。内置群聊页与 Code 页与普通页一样
 * 可以删除，删除后经卡片中心「应用 → 内置」重新打开（墓碑见 chalkboard-slice）。
 */
export const CHALKBOARD_UNREMOVABLE_PAGE_IDS = [
    CHALKBOARD_CHAT_PAGE_ID,
    CHALKBOARD_STUDIO_PAGE_ID,
];
/** realization: "page" 的插件卡（v1 / v2 同一规则）所占页面的 id。 */
export function chalkboardPluginCardPageId(pluginId, cardId) {
    return `plugin-page:${pluginId}:${cardId}`;
}
/** v1 插件 contributes.page 所占页面的 id。 */
export function chalkboardPluginSurfacePageId(pluginId) {
    return `plugin:${pluginId}:page`;
}
/**
 * 按卡自身身份推出它若是配置级主卡、应属于哪一页；普通卡返回 null。
 * 只看身份，不看位置——位置核对在 resolveChalkboardPageFixture 里做。
 */
export function chalkboardPageFixtureClaimedPageId(card) {
    if (!card?.id)
        return null;
    if (card.id === CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID)
        return CHALKBOARD_CODE_PAGE_ID;
    if (card.id === CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID)
        return CHALKBOARD_CHAT_PAGE_ID;
    if (card.id === CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID)
        return CHALKBOARD_CHANNELS_PAGE_ID;
    if (card.id === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID)
        return CHALKBOARD_STUDIO_PAGE_ID;
    const binding = card.binding;
    if (binding?.kind === 'plugin-webview') {
        return chalkboardPluginCardPageId(binding.pluginId, binding.cardId);
    }
    if (binding?.kind === 'plugin-surface' && binding.surface === 'page') {
        return chalkboardPluginSurfacePageId(binding.pluginId);
    }
    return null;
}
function subtreeHasCard(nodes, nodeId, cardInstanceId, seen = new Set()) {
    const node = nodes[nodeId];
    if (!node || seen.has(nodeId))
        return false;
    seen.add(nodeId);
    if (node.kind === 'card')
        return node.cardInstanceId === cardInstanceId;
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        return node.children.some((childId) => subtreeHasCard(nodes, childId, cardInstanceId, seen));
    }
    return false;
}
function surfaceHoldingCard(doc, cardInstanceId) {
    for (const surface of Object.values(doc.surfaces)) {
        if (subtreeHasCard(doc.nodes, surface.rootNodeId, cardInstanceId))
            return surface;
    }
    return null;
}
/** 一页的 page id；主页 surface 也带 pageId（聊天页）。 */
export function chalkboardSurfacePageId(surface) {
    if (!surface)
        return null;
    if (surface.id === CHALKBOARD_LAYOUT_HOME_SURFACE_ID)
        return CHALKBOARD_CHAT_PAGE_ID;
    if (surface.kind === 'studio')
        return surface.pageId ?? CHALKBOARD_STUDIO_PAGE_ID;
    if (surface.kind !== 'page' && surface.kind !== 'home')
        return null;
    return surface.pageId ?? null;
}
/** 卡若是某页的配置级主卡，返回归属；否则 null。 */
export function resolveChalkboardPageFixture(doc, cardInstanceId) {
    const card = doc.cards[cardInstanceId];
    const claimed = chalkboardPageFixtureClaimedPageId(card);
    if (!claimed)
        return null;
    const surface = surfaceHoldingCard(doc, cardInstanceId);
    if (!surface)
        return null;
    const pageSurface = surface.kind === 'detached' && surface.returnSurfaceId
        ? doc.surfaces[surface.returnSurfaceId]
        : surface;
    if (!pageSurface || chalkboardSurfacePageId(pageSurface) !== claimed)
        return null;
    return {
        cardInstanceId,
        pageId: claimed,
        pageSurfaceId: pageSurface.id,
        detachedSurfaceId: surface.kind === 'detached' ? surface.id : null,
    };
}
export function isChalkboardPageFixtureCard(doc, cardInstanceId) {
    return !!cardInstanceId && resolveChalkboardPageFixture(doc, cardInstanceId) !== null;
}
/**
 * 页能不能被用户删掉。主页、工作室窗口永不可删；其余页看自身能力（locked /
 * canClose）。页不存在时返回 false。
 */
export function isChalkboardPageRemovable(doc, pageId) {
    if (CHALKBOARD_UNREMOVABLE_PAGE_IDS.includes(pageId))
        return false;
    const surface = Object.values(doc.surfaces).find((item) => item.pageId === pageId);
    if (!surface)
        return false;
    return !surface.capabilities.locked && surface.capabilities.canClose;
}
/** 页是否列在不可删清单里（不需要文档即可判定的那部分）。 */
export function isChalkboardUnremovablePageId(pageId) {
    return CHALKBOARD_UNREMOVABLE_PAGE_IDS.includes(pageId);
}
//# sourceMappingURL=page-card-policy.js.map