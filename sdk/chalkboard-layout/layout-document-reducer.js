/**
 * chalkboard-layout/layout-document-reducer.ts — generated from shared/chalkboard-layout/layout-document-reducer.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { ChalkboardLayoutError } from './layout-errors.js';
import { CHALKBOARD_CARD_CHANNELS_PAGE, CHALKBOARD_CHAT_PAGE_ID, CHALKBOARD_HOME_CHAT_TILE_ID, CHALKBOARD_TILE_CHANNEL_CHAT, } from './chalkboard-builtin-ids.js';
import { CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID, CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID, CHALKBOARD_LAYOUT_HOME_SURFACE_ID, ensureChalkboardPageTemplate, } from './layout-document-factory.js';
import { explicitDefaultInsertedChildSizing, insertedChildSizing } from './layout-card-width-contracts.js';
function requireCard(doc, cardInstanceId) {
    const card = doc.cards[cardInstanceId];
    if (!card)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout card not found: ${cardInstanceId}`);
    return card;
}
function requireSurface(doc, surfaceId) {
    const surface = doc.surfaces[surfaceId];
    if (!surface)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout surface not found: ${surfaceId}`);
    return surface;
}
function requireSurfaceByPage(doc, pageId) {
    const surface = Object.values(doc.surfaces).find((item) => item.pageId === pageId);
    if (!surface)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout page not found: ${pageId}`);
    return surface;
}
function collectNodeSubtree(nodes, nodeId, out = new Set()) {
    const node = nodes[nodeId];
    if (!node || out.has(nodeId))
        return out;
    out.add(nodeId);
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        for (const childId of node.children)
            collectNodeSubtree(nodes, childId, out);
    }
    return out;
}
function collectCardIdsFromNodes(nodes, nodeIds) {
    const cardIds = new Set();
    for (const nodeId of nodeIds) {
        const node = nodes[nodeId];
        if (node?.kind === 'card')
            cardIds.add(node.cardInstanceId);
    }
    return cardIds;
}
function firstCardIdInSubtree(doc, nodeId) {
    const node = doc.nodes[nodeId];
    if (!node)
        return null;
    if (node.kind === 'card')
        return node.cardInstanceId;
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        for (const childId of node.children) {
            const cardId = firstCardIdInSubtree(doc, childId);
            if (cardId)
                return cardId;
        }
    }
    return null;
}
function surfaceContainsCard(doc, surface, cardInstanceId) {
    const nodeIds = collectNodeSubtree(doc.nodes, surface.rootNodeId);
    for (const nodeId of nodeIds) {
        const node = doc.nodes[nodeId];
        if (node?.kind === 'card' && node.cardInstanceId === cardInstanceId)
            return true;
    }
    return false;
}
function setFocus(doc, focus) {
    const surface = requireSurface(doc, focus.surfaceId);
    if (focus.kind !== 'surface') {
        requireCard(doc, focus.cardInstanceId);
        if (!surfaceContainsCard(doc, surface, focus.cardInstanceId)) {
            throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout focus card ${focus.cardInstanceId} is not on surface ${focus.surfaceId}`);
        }
    }
    return {
        ...doc,
        activeSurfaceId: surface.id,
        activePageId: surface.pageId ?? doc.activePageId,
        focus,
    };
}
function removePage(doc, pageId) {
    const surface = requireSurfaceByPage(doc, pageId);
    if (surface.capabilities.locked || !surface.capabilities.canClose) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout page cannot be removed: ${pageId}`);
    }
    const nodeIds = collectNodeSubtree(doc.nodes, surface.rootNodeId);
    const cardIds = collectCardIdsFromNodes(doc.nodes, nodeIds);
    const nodes = { ...doc.nodes };
    const cards = { ...doc.cards };
    const surfaces = { ...doc.surfaces };
    for (const nodeId of nodeIds)
        delete nodes[nodeId];
    for (const cardId of cardIds)
        delete cards[cardId];
    delete surfaces[surface.id];
    const activeSurfaceRemoved = doc.activeSurfaceId === surface.id;
    const focusSurfaceRemoved = doc.focus.surfaceId === surface.id;
    return {
        ...doc,
        surfaces,
        nodes,
        cards,
        activeSurfaceId: activeSurfaceRemoved ? CHALKBOARD_LAYOUT_HOME_SURFACE_ID : doc.activeSurfaceId,
        activePageId: doc.activePageId === pageId ? CHALKBOARD_CHAT_PAGE_ID : doc.activePageId,
        focus: focusSurfaceRemoved
            ? { kind: 'surface', surfaceId: CHALKBOARD_LAYOUT_HOME_SURFACE_ID }
            : doc.focus,
    };
}
function setCardLineage(doc, cardInstanceId, lineage) {
    const card = requireCard(doc, cardInstanceId);
    if (lineage) {
        if (lineage.parentCardInstanceId === cardInstanceId) {
            throw new ChalkboardLayoutError('SAME_NODE', `layout card cannot parent itself: ${cardInstanceId}`);
        }
        requireCard(doc, lineage.parentCardInstanceId);
        if (lineageCreatesCycle(doc, cardInstanceId, lineage.parentCardInstanceId)) {
            throw new ChalkboardLayoutError('SAME_NODE', `layout card lineage cannot form a cycle: ${cardInstanceId}`);
        }
    }
    const nextCard = { ...card };
    if (lineage)
        nextCard.lineage = lineage;
    else
        delete nextCard.lineage;
    return { ...doc, cards: { ...doc.cards, [card.id]: nextCard } };
}
function lineageCreatesCycle(doc, cardInstanceId, parentCardInstanceId) {
    const seen = new Set();
    let current = parentCardInstanceId;
    while (current) {
        if (current === cardInstanceId)
            return true;
        if (seen.has(current))
            return true;
        seen.add(current);
        current = doc.cards[current]?.lineage?.parentCardInstanceId;
    }
    return false;
}
function collectLifecycleDescendantCardIds(doc, parentCardInstanceId) {
    const descendants = [];
    const stack = [parentCardInstanceId];
    const seen = new Set(stack);
    while (stack.length) {
        const parentId = stack.pop();
        for (const card of Object.values(doc.cards)) {
            if (card.lineage?.parentCardInstanceId !== parentId || seen.has(card.id))
                continue;
            seen.add(card.id);
            descendants.push(card.id);
            stack.push(card.id);
        }
    }
    return descendants;
}
function nextCardInstanceId(doc, definitionId) {
    const prefix = `card:${definitionId}:`;
    let index = 1;
    while (doc.cards[`${prefix}${index}`])
        index += 1;
    return `${prefix}${index}`;
}
function cardNodeId(cardId) {
    return `node:${cardId}`;
}
function slotNodeIdForCard(cardId) {
    return `node:slot:${cardId}`;
}
function detachedRootNodeId(cardId) {
    return `node:detached:${cardId}:root`;
}
function detachedSurfaceId(cardId) {
    return `surface:detached:${cardId}`;
}
function requireNode(doc, nodeId) {
    const node = doc.nodes[nodeId];
    if (!node)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout node not found: ${nodeId}`);
    return node;
}
/** export 供 离场重称（chalkboard-slice 的 settleDepartureRowWeights）
 *  定位被移卡节点；卡不存在时抛 ChalkboardLayoutError，调用侧自行 catch。 */
export function findCardNodeId(doc, cardInstanceId) {
    requireCard(doc, cardInstanceId);
    const found = Object.values(doc.nodes)
        .find((node) => node.kind === 'card' && node.cardInstanceId === cardInstanceId);
    if (!found)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout card node not found: ${cardInstanceId}`);
    return found.id;
}
/** export 供 离场重称沿 parent 链收集祖先 row；无父返回 null。 */
export function findParentNodeId(nodes, childId) {
    for (const node of Object.values(nodes)) {
        if ((node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') && node.children.includes(childId)) {
            return node.id;
        }
    }
    return null;
}
function surfaceContainingNode(doc, nodeId) {
    for (const surface of Object.values(doc.surfaces)) {
        if (collectNodeSubtree(doc.nodes, surface.rootNodeId).has(nodeId))
            return surface;
    }
    throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout surface containing node not found: ${nodeId}`);
}
function surfaceContainingCard(doc, cardInstanceId) {
    return surfaceContainingNode(doc, findCardNodeId(doc, cardInstanceId));
}
function removeNodeFromParent(nodes, childId) {
    const parentId = findParentNodeId(nodes, childId);
    if (!parentId)
        return nodes;
    const parent = nodes[parentId];
    if (!parent || (parent.kind !== 'row' && parent.kind !== 'column' && parent.kind !== 'slot'))
        return nodes;
    const children = parent.children.filter((id) => id !== childId);
    const nextParent = parent.kind === 'slot'
        ? {
            ...parent,
            children,
            activeChildId: parent.activeChildId === childId
                ? children[0] ?? null
                : parent.activeChildId,
        }
        : {
            ...parent,
            children,
            sizing: parent.sizing.filter((_, index) => parent.children[index] !== childId),
        };
    return { ...nodes, [parentId]: nextParent };
}
function uniqueLayoutNodeId(nodes, base) {
    if (!nodes[base])
        return base;
    let index = 1;
    while (nodes[`${base}:${index}`])
        index += 1;
    return `${base}:${index}`;
}
function layoutAxisForEdge(edge) {
    return edge === 'left' || edge === 'right' ? 'row' : 'column';
}
function edgeInsertIndex(edge, referenceIndex) {
    return edge === 'left' || edge === 'top' ? referenceIndex : referenceIndex + 1;
}
function cardDefinitionForNode(doc, nodes, nodeId) {
    const cardId = firstCardInstanceIdForNode(doc, nodes, nodeId);
    return cardId ? doc.cards[cardId]?.definitionId : undefined;
}
function firstCardInstanceIdForNode(doc, nodes, nodeId) {
    const node = nodes[nodeId];
    if (!node)
        return undefined;
    if (node.kind === 'card')
        return doc.cards[node.cardInstanceId] ? node.cardInstanceId : undefined;
    if (node.kind === 'slot') {
        const child = node.children
            .map((childId) => nodes[childId])
            .find((candidate) => candidate?.kind === 'card');
        return child?.kind === 'card' && doc.cards[child.cardInstanceId] ? child.cardInstanceId : undefined;
    }
    if (node.kind === 'row' || node.kind === 'column') {
        for (const childId of node.children) {
            const cardId = firstCardInstanceIdForNode(doc, nodes, childId);
            if (cardId)
                return cardId;
        }
    }
    return undefined;
}
function childSizingForNode(doc, nodes, nodeId) {
    const cardId = firstCardInstanceIdForNode(doc, nodes, nodeId);
    return insertedChildSizing(doc, cardDefinitionForNode(doc, nodes, nodeId), cardId);
}
/** 插入条目的轴默认：row 轴 = 定义默认（含宽度意图）；column 轴 =
 *  elastic weight 1（等权分配；高度轴无定义契约可查）。 */
function childSizingForAxis(axis, widthDefault) {
    return axis === 'column' ? { kind: 'elastic', weight: 1 } : widthDefault;
}
/**
 * 定义驱动的 sizing 读时迁移，承担两类归一：
 * 1. kind 收敛：卡定义的宽度角色变更后（如工作台 desk fixed → elastic），
 *    老档案 row.sizing 里残留的旧 fixed 条目转成定义默认。只处理"条目
 *    fixed 而定义默认非 fixed"的方向。
 * 2. minPx 双向钉定义值：条目 minPx 是定义契约的投影，唯一源是定义表。
 *    显式内置卡的 row 条目 minPx 与定义值不一致时
 *    一律钉回定义值，不分抬升/下压方向（如工作台历次定义调整的历史沿革
 *    中，任一旧值都会被钉到当前定义值）。旧版（a385cabfd）曾是"只抬
 *    不降"：条目 minPx ≥ 定义值就原样保留——这个单向语义放过了竖排实验
 *    误伤的泄漏（mergePromotedChildSizing 的 max 合并把 preview/editor
 *    家族的定义 min 320 混进了 workspace 条目，见该函数的 minPx 取
 *    max 合并逻辑），泄漏值一旦 ≥ 定义值就永远洗不掉。双向钉定义值后，
 *    盘点过的全部写入方里，显式内置卡条目上任何 ≠ 定义值的 minPx 都没有
 *    合法来源（只能是定义变更历史残留或容器合并泄漏），钉回即可自愈。
 *    其余字段（weight/px/maxPx/kind）原样保留。
 * 两类都定义驱动、仅作用于显式内置卡（未知 definitionId 的 fallback 卡
 * 不参与），且仅当该 child 能唯一归属到一张卡（card 节点或单卡 slot）
 * ——多卡 tab slot 的活动卡会变，不做猜测。
 */
function reconcileChildSizingKind(doc, nodes, nodeId, sizing) {
    const definitionId = soleCardDefinitionForChild(doc, nodes, nodeId);
    if (!definitionId)
        return sizing;
    const base = explicitDefaultInsertedChildSizing(definitionId);
    if (!base)
        return sizing;
    if (sizing.kind === 'fixed' && base.kind !== 'fixed')
        return { ...base };
    const pinPx = base.minPx;
    if (typeof pinPx !== 'number' || !Number.isFinite(pinPx))
        return sizing;
    if (typeof sizing.minPx === 'number' && Number.isFinite(sizing.minPx) && sizing.minPx === pinPx)
        return sizing;
    return { ...sizing, minPx: pinPx };
}
/** column 轴条目读时收敛：
 *  高度轴迄今没有任何合法的 fixed/minPx/maxPx 写入来源——存量 column 条目
 *  里的这些字段全部是宽度语义污染（跨轴组排继承、同轴插入的定义默认、
 *  reconcile 的定义 minPx 抬升）。一刀切收敛：
 *  - fixed → { kind: 'elastic', weight: max(px, 1) }（fixed 兄弟间 px 比例
 *    即权重比例，视觉连续）
 *  - elastic/fill → 保留 kind 与 weight，剥除 minPx/maxPx
 *  已合法的条目原样返回（迁移幂等）。未来卡定义声明高度契约时（填表日），
 *  本函数与 column-axis-sizing 不变式测试一并修订。 */
export function reconcileColumnAxisSizing(sizing) {
    if (sizing.kind === 'fixed') {
        const px = typeof sizing.px === 'number' && Number.isFinite(sizing.px) ? sizing.px : 1;
        return { kind: 'elastic', weight: Math.max(px, 1) };
    }
    if (sizing.minPx === undefined && sizing.maxPx === undefined)
        return sizing;
    const next = { ...sizing };
    delete next.minPx;
    delete next.maxPx;
    return next;
}
function soleCardDefinitionForChild(doc, nodes, nodeId) {
    const node = nodes[nodeId] ?? doc.nodes[nodeId];
    if (!node)
        return undefined;
    if (node.kind === 'card')
        return doc.cards[node.cardInstanceId]?.definitionId;
    if (node.kind === 'slot' && node.children.length === 1) {
        return soleCardDefinitionForChild(doc, nodes, node.children[0]);
    }
    return undefined;
}
function slotNodeIdForChildNode(nodes, childNodeId) {
    const child = nodes[childNodeId];
    if (child?.kind === 'card')
        return slotNodeIdForCard(child.cardInstanceId);
    return slotNodeIdForCard(childNodeId.replace(/^node:/, ''));
}
function ensureSlotForNode(nodes, childNodeId) {
    const child = requireNode({ nodes }, childNodeId);
    if (child.kind === 'slot')
        return { nodes, slotNodeId: childNodeId };
    if (child.kind !== 'card') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout edge insertion requires card or slot: ${childNodeId}`);
    }
    const slotId = slotNodeIdForChildNode(nodes, childNodeId);
    const existing = nodes[slotId];
    return {
        nodes: {
            ...nodes,
            [slotId]: {
                ...(existing?.kind === 'slot' ? existing : {}),
                id: slotId,
                kind: 'slot',
                children: existing?.kind === 'slot' && existing.children.includes(childNodeId)
                    ? existing.children
                    : [...(existing?.kind === 'slot' ? existing.children : []), childNodeId],
                activeChildId: childNodeId,
                titlebarMode: existing?.kind === 'slot' ? existing.titlebarMode : 'compact',
            },
        },
        slotNodeId: slotId,
    };
}
function referenceSlotOrNodeId(nodes, referenceNodeId) {
    const reference = requireNode({ nodes }, referenceNodeId);
    if (reference.kind !== 'card')
        return referenceNodeId;
    const parentId = findParentNodeId(nodes, reference.id);
    const parent = parentId ? nodes[parentId] : null;
    return parent?.kind === 'slot' ? parent.id : referenceNodeId;
}
function surfaceRootOwner(doc, nodeId) {
    return Object.values(doc.surfaces).find((surface) => surface.rootNodeId === nodeId) ?? null;
}
function removeNodeFromLayoutPosition(doc, nodeId) {
    const parentId = findParentNodeId(doc.nodes, nodeId);
    let nodes = removeNodeFromParent(doc.nodes, nodeId);
    const nextNodes = { ...nodes };
    const parent = parentId ? nextNodes[parentId] : null;
    const parentIsSurfaceRoot = !!parentId && !!surfaceRootOwner(doc, parentId);
    if (parentId
        && parent?.kind === 'slot'
        && parent.children.length === 0
        && !parentIsSurfaceRoot) {
        nodes = removeNodeFromParent(nextNodes, parentId);
        Object.assign(nextNodes, nodes);
        delete nextNodes[parentId];
    }
    return nextNodes;
}
function collectCardIdsFromNormalizedRoot(nodes, rootNodeId) {
    const cardIds = new Set();
    const visit = (nodeId) => {
        const node = nodes[nodeId];
        if (!node)
            return;
        if (node.kind === 'card') {
            cardIds.add(node.cardInstanceId);
            return;
        }
        if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
            for (const childId of node.children)
                visit(childId);
        }
    };
    visit(rootNodeId);
    return cardIds;
}
function layoutSurfaceContainsCard(nodes, surface, cardInstanceId) {
    return collectCardIdsFromNormalizedRoot(nodes, surface.rootNodeId).has(cardInstanceId);
}
function normalizeSizingLimit(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** 合并基底选择：有 elastic 一侧就以 elastic 为主，
    双方同类时沿用调用方原有的优先侧。 */
function elasticFirstBase(preferred, other) {
    if (preferred.kind !== 'fixed')
        return preferred;
    if (other.kind !== 'fixed')
        return other;
    return preferred;
}
export function mergeCollapsedChildSizing(parentSizing, childSizing) {
    if (!parentSizing)
        return childSizing;
    if (!childSizing)
        return parentSizing;
    const minPx = Math.max(normalizeSizingLimit(parentSizing.minPx) ?? 0, normalizeSizingLimit(childSizing.minPx) ?? 0);
    const maxValues = [
        normalizeSizingLimit(parentSizing.maxPx),
        normalizeSizingLimit(childSizing.maxPx),
    ].filter((value) => value !== undefined);
    const maxPx = maxValues.length > 0 ? Math.max(minPx, Math.min(...maxValues)) : undefined;
    const next = { ...elasticFirstBase(parentSizing, childSizing) };
    if (minPx > 0)
        next.minPx = minPx;
    else
        delete next.minPx;
    if (maxPx !== undefined)
        next.maxPx = maxPx;
    else
        delete next.maxPx;
    return next;
}
export function mergePromotedChildSizing(childSizing, parentSizing) {
    // 拍平（同轴 wrapper 并入父行）：孙辈带着自己的宽度身份成为父行子项——
    // 孙辈存在自身 sizing 时，min/max/kind/weight/px 全部只取孙辈自身值，
    // 不与容器壳的宽度契约做任何数值合并。容器条目（parentSizing）是壳
    // 自己的约束，不是孙辈的；孙辈无自身条目时才占位回落容器条目，继承
    // 位置意图（此分支语义不变）。
    //
    // 旧版 minPx 取 max(child, parent)、
    // maxPx 取交集的数值合并，是把容器壳的宽度契约强加给搬出来的孙辈——
    // 320 泄漏事故的源头公式（见 reconcileChildSizingKind 注释：泄漏值
    // 混进 workspace 条目后靠"双向钉定义值"读时自愈）。显式内置卡有
    // reconcileChildSizingKind 的定义驱动安全网能洗掉泄漏，插件/fallback
    // 卡（未知 definitionId，不在 explicitDefaultInsertedChildSizing 白
    // 名单）没有安全网，脏值会永久沉淀。保留孙辈自身尺寸可阻止污染：
    // 每一张卡的尺寸都不应该被污染。塌缩继承（wrapper 单孩子上抛）是
    // mergeCollapsedChildSizing 的语义，不参与这里的同轴拍平。
    return childSizing ?? parentSizing;
}
export function normalizeChalkboardLayoutDocument(doc) {
    const rootNodeIds = new Set(Object.values(doc.surfaces).map((surface) => surface.rootNodeId));
    const nodes = {};
    const visiting = new Set();
    const visit = (nodeId, isSurfaceRoot) => {
        const node = doc.nodes[nodeId];
        if (!node || visiting.has(nodeId))
            return null;
        visiting.add(nodeId);
        if (node.kind === 'card') {
            visiting.delete(nodeId);
            if (!doc.cards[node.cardInstanceId])
                return null;
            nodes[nodeId] = node;
            return { nodeId };
        }
        if (node.kind === 'slot') {
            const children = node.children
                .map((childId) => visit(childId, false))
                .filter((child) => !!child)
                .map((child) => child.nodeId);
            visiting.delete(nodeId);
            if (children.length === 0 && !isSurfaceRoot)
                return null;
            nodes[nodeId] = {
                ...node,
                children,
                activeChildId: node.activeChildId && children.includes(node.activeChildId)
                    ? node.activeChildId
                    : children[0] ?? null,
            };
            return { nodeId };
        }
        if (node.kind === 'row' || node.kind === 'column') {
            // 轴分流 reconcile：row 维持定义驱动的
            // kind 收敛 + minPx 抬升（宽度契约有定义表可查）；column 走轴收敛，
            // 只保证条目落在合法的高度轴取值域，不做定义驱动的抬升（高度轴
            // 没有任何定义表列可查，抬升等于把宽度语义误当高度语义搬运）。
            const reconcileForAxis = (childNodeId, candidate) => (node.kind === 'row'
                ? reconcileChildSizingKind(doc, nodes, childNodeId, candidate)
                : reconcileColumnAxisSizing(candidate));
            const children = [];
            const sizing = [];
            node.children.forEach((childId, index) => {
                const normalizedChild = visit(childId, false);
                if (!normalizedChild)
                    return;
                const childNode = nodes[normalizedChild.nodeId];
                // 跨轴塌缩合并禁止：塌缩容器（normalizedChild.sizingAxis）与
                // 本容器（node.kind）异轴时，塌缩上抛的 sizing 是另一条物理轴的
                // 权重/像素契约，禁止参与 mergeCollapsedChildSizing 的数值合并
                // （row[A, column[B]] 中 column 塌缩，column 轴条目的高度权重/min
                // 混进 row 的宽度条目没有物理意义）。异轴时父轴原条目优先，缺失
                // 回落定义默认——定义默认在 row 语境合法；column 父轴的输出随后
                // 经 reconcileColumnAxisSizing 收敛，自然落回合法域。
                const sameAxisOrUnknown = !normalizedChild.sizingAxis || normalizedChild.sizingAxis === node.kind;
                const mergedSizing = sameAxisOrUnknown
                    ? mergeCollapsedChildSizing(node.sizing[index], normalizedChild.sizing)
                        ?? childSizingForNode(doc, nodes, normalizedChild.nodeId)
                    : node.sizing[index] ?? childSizingForNode(doc, nodes, normalizedChild.nodeId);
                const nextSizing = reconcileForAxis(normalizedChild.nodeId, mergedSizing);
                if (childNode?.kind === node.kind) {
                    childNode.children.forEach((grandchildId, grandchildIndex) => {
                        children.push(grandchildId);
                        sizing.push(reconcileForAxis(grandchildId, mergePromotedChildSizing(childNode.sizing[grandchildIndex], nextSizing)
                            ?? childSizingForNode(doc, nodes, grandchildId)));
                    });
                    return;
                }
                children.push(normalizedChild.nodeId);
                sizing.push(nextSizing);
            });
            visiting.delete(nodeId);
            if (children.length === 0 && !isSurfaceRoot)
                return null;
            if (children.length === 1 && isSurfaceRoot) {
                const onlyChild = nodes[children[0]];
                if (onlyChild?.kind === 'row' || onlyChild?.kind === 'column') {
                    nodes[nodeId] = { ...onlyChild, id: node.id };
                    return { nodeId };
                }
            }
            if (children.length === 1 && !isSurfaceRoot) {
                return { nodeId: children[0], sizing: sizing[0], sizingAxis: node.kind };
            }
            // 单卡行的 fixed 兜底：行内没有竞争者时
            // 固定意图宽只会在行尾留白，收敛为吃满行的 elastic（min 保留）
            if (node.kind === 'row' && children.length === 1 && sizing[0]?.kind === 'fixed') {
                const solo = sizing[0];
                sizing[0] = {
                    kind: 'elastic',
                    weight: 1,
                    ...(solo.minPx !== undefined ? { minPx: solo.minPx } : {}),
                    ...(solo.maxPx !== undefined ? { maxPx: solo.maxPx } : {}),
                };
            }
            nodes[nodeId] = { ...node, children, sizing };
            return { nodeId };
        }
        visiting.delete(nodeId);
        nodes[nodeId] = node;
        return { nodeId };
    };
    for (const surface of Object.values(doc.surfaces)) {
        visit(surface.rootNodeId, rootNodeIds.has(surface.rootNodeId));
    }
    const surfaces = {};
    for (const surface of Object.values(doc.surfaces)) {
        if (!nodes[surface.rootNodeId])
            continue;
        if (surface.kind === 'detached'
            && collectCardIdsFromNormalizedRoot(nodes, surface.rootNodeId).size === 0) {
            continue;
        }
        surfaces[surface.id] = surface;
    }
    const reachableNodeIds = new Set();
    for (const surface of Object.values(surfaces)) {
        for (const nodeId of collectNodeSubtree(nodes, surface.rootNodeId))
            reachableNodeIds.add(nodeId);
    }
    const reachableNodes = {};
    for (const nodeId of reachableNodeIds) {
        const node = nodes[nodeId];
        if (node)
            reachableNodes[nodeId] = node;
    }
    const reachableCardIds = collectCardIdsFromNodes(reachableNodes, reachableNodeIds);
    const cards = {};
    for (const [cardId, card] of Object.entries(doc.cards)) {
        if (reachableCardIds.has(cardId))
            cards[cardId] = card;
    }
    // 悬空 lineage 清理。lineage 是卡与卡之间的反向指针，而删页、删卡走的都是
    // 布局子树的物理摘除，谁都不会回头去修别处指向被删卡的这条指针；lineage
    // 又允许跨页面声明父卡，所以父卡所在的页面一被删掉，另一页上的子卡就永久
    // 留着一个指向不存在实例的父指针。必须放在可达性收敛之后跑，这时 cards 已
    // 是终态，才能判断父卡是不是真的还在。
    //
    // 清理方式是整段 lineage 去掉而不是只把父指针置空：lineage 的类型里
    // parentCardInstanceId 是必填的，没有"父已失联"这种合法取值，留一个残缺
    // 对象等于造一个类型上不存在的状态。卡本身保留——断链之后它就是一张独立
    // 卡，不再被任何 closeCard 级联带走，这也正是 collectLifecycleDescendantCardIds
    // 一直以来对断链卡的实际行为。
    for (const [cardId, card] of Object.entries(cards)) {
        const parentCardInstanceId = card.lineage?.parentCardInstanceId;
        if (parentCardInstanceId === undefined || cards[parentCardInstanceId])
            continue;
        const repaired = { ...card };
        delete repaired.lineage;
        cards[cardId] = repaired;
    }
    const vanishedActive = surfaces[doc.activeSurfaceId]
        ? undefined
        : doc.surfaces[doc.activeSurfaceId];
    const fallbackSurface = resolveFocusFallbackSurface(surfaces, {
        activeSurfaceId: doc.activeSurfaceId,
        activePageId: doc.activePageId,
        vanishedReturnSurfaceId: vanishedActive?.returnSurfaceId,
    });
    if (!fallbackSurface) {
        return { ...doc, surfaces, nodes: reachableNodes, cards };
    }
    let focus = doc.focus;
    const focusSurface = surfaces[focus.surfaceId];
    if (!focusSurface) {
        focus = { kind: 'surface', surfaceId: fallbackSurface.id };
    }
    else if (focus.kind !== 'surface') {
        const currentFocus = focus;
        const card = cards[currentFocus.cardInstanceId];
        const cardValid = !!card && layoutSurfaceContainsCard(reachableNodes, focusSurface, currentFocus.cardInstanceId);
        if (!cardValid)
            focus = { kind: 'surface', surfaceId: focusSurface.id };
    }
    return {
        ...doc,
        surfaces,
        nodes: reachableNodes,
        cards,
        activeSurfaceId: fallbackSurface.id,
        activePageId: fallbackSurface.pageId ?? doc.activePageId,
        focus,
    };
}
function attachNodeToSurfaceRoot(doc, nodes, surface, childNodeId, childSizing = childSizingForNode(doc, nodes, childNodeId)) {
    const root = nodes[surface.rootNodeId];
    if (!root)
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout surface root not found: ${surface.rootNodeId}`);
    if (root.kind === 'slot') {
        // 单格根（空白页模板的初始形态）已有内容时，不把新卡并进根格的
        // tabs——"落到页面根"的语义是独立成格，不是钉进已有组。走
        // insertSiblingAtEdge 的 root 提升分支：根被包装成 row [旧格, 新卡]，
        // 根 id 保持不变，新卡独立落在最右。空根维持原状直接填入。
        if (root.children.length > 0 && !root.children.includes(childNodeId)) {
            return insertSiblingAtEdge(doc, nodes, childNodeId, root.id, 'right');
        }
        const children = root.children.includes(childNodeId) ? root.children : [...root.children, childNodeId];
        return {
            ...nodes,
            [root.id]: { ...root, children, activeChildId: childNodeId },
        };
    }
    if (root.kind === 'row' || root.kind === 'column') {
        const slotId = slotNodeIdForChildNode(nodes, childNodeId);
        const existingSlot = nodes[slotId];
        const rootChildren = root.children.includes(slotId) ? root.children : [...root.children, slotId];
        // 插入条目的轴默认：root 是 column 时不沿用 childSizing 的宽度
        // 契约默认，走 childSizingForAxis 收敛为 elastic weight 1。
        const rootSizing = root.children.includes(slotId)
            ? root.sizing
            : [...root.sizing, childSizingForAxis(root.kind, childSizing)];
        const nextNodes = {
            ...nodes,
            [slotId]: {
                ...(existingSlot?.kind === 'slot' ? existingSlot : {}),
                id: slotId,
                kind: 'slot',
                children: existingSlot?.kind === 'slot' && existingSlot.children.includes(childNodeId)
                    ? existingSlot.children
                    : [...(existingSlot?.kind === 'slot' ? existingSlot.children : []), childNodeId],
                activeChildId: childNodeId,
                titlebarMode: 'compact',
            },
        };
        return {
            ...nextNodes,
            [root.id]: {
                ...root,
                children: rootChildren,
                sizing: rootSizing,
            },
        };
    }
    throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout surface root cannot accept cards: ${root.kind}`);
}
function insertNodeIntoSlot(doc, nodes, slotNodeId, childNodeId, index) {
    const slot = requireNode({ ...doc, nodes }, slotNodeId);
    if (slot.kind !== 'slot') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout target is not a slot: ${slotNodeId}`);
    }
    const children = slot.children.filter((id) => id !== childNodeId);
    const insertAt = index === undefined
        ? children.length
        : Math.max(0, Math.min(index, children.length));
    children.splice(insertAt, 0, childNodeId);
    return {
        ...nodes,
        [slot.id]: {
            ...slot,
            children,
            activeChildId: childNodeId,
            titlebarMode: children.length > 1 ? 'tabs' : slot.titlebarMode,
        },
    };
}
function insertSiblingAtEdge(doc, nodes, childNodeId, referenceNodeId, edge) {
    const wantedKind = layoutAxisForEdge(edge);
    const referenceWrapperId = referenceSlotOrNodeId(nodes, referenceNodeId);
    const { nodes: nodesWithSlot, slotNodeId } = ensureSlotForNode(nodes, childNodeId);
    const childSizing = childSizingForNode(doc, nodesWithSlot, slotNodeId);
    const reference = requireNode({ ...doc, nodes: nodesWithSlot }, referenceWrapperId);
    const parentId = findParentNodeId(nodesWithSlot, referenceWrapperId);
    if (parentId) {
        const parent = requireNode({ ...doc, nodes: nodesWithSlot }, parentId);
        if (parent.kind !== 'row' && parent.kind !== 'column') {
            throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout edge reference parent cannot accept siblings: ${parentId}`);
        }
        const referenceIndex = parent.children.indexOf(referenceWrapperId);
        if (referenceIndex < 0) {
            throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout edge reference not found in parent: ${referenceWrapperId}`);
        }
        if (parent.kind === wantedKind) {
            // 同轴插入 column 时不沿用 childSizing 的宽度契约默认，
            // 改用 elastic weight 1，与跨轴新建 column 的高度分配保持一致。
            const insertAt = edgeInsertIndex(edge, referenceIndex);
            const children = parent.children.filter((id) => id !== slotNodeId);
            const sizing = parent.sizing.filter((_, index) => parent.children[index] !== slotNodeId);
            const nextInsertAt = Math.max(0, Math.min(insertAt, children.length));
            children.splice(nextInsertAt, 0, slotNodeId);
            sizing.splice(nextInsertAt, 0, childSizingForAxis(wantedKind, childSizing));
            return {
                ...nodesWithSlot,
                [parent.id]: { ...parent, children, sizing },
            };
        }
        const groupId = uniqueLayoutNodeId(nodesWithSlot, `node:split:${slotNodeId}:${referenceWrapperId}:${edge}`);
        const orderedChildren = edge === 'left' || edge === 'top'
            ? [slotNodeId, referenceWrapperId]
            : [referenceWrapperId, slotNodeId];
        // 跨轴新建 split 的内部条目不再跨轴继承：
        // ChalkboardChildSizing 是宽度契约，横排条目/宽度 px 进 column 会被当
        // 高度分配（曾致竖排交换回弹到无规律的"出生比例"）。column 内部一律
        // 50/50 elastic；row 内部两侧都取定义默认（宽度语义正确）。
        // 外层 parent 在原位置的条目不动（下方 children.map 替换逻辑）——
        // 那是本轴（parent 自身的轴）的合法值，不受这里的轴变更影响。
        const referenceSizing = childSizingForAxis(wantedKind, childSizingForNode(doc, nodesWithSlot, referenceWrapperId));
        const insertedSizing = childSizingForAxis(wantedKind, childSizing);
        const orderedSizing = edge === 'left' || edge === 'top'
            ? [insertedSizing, referenceSizing]
            : [referenceSizing, insertedSizing];
        return {
            ...nodesWithSlot,
            [groupId]: {
                id: groupId,
                kind: wantedKind,
                children: orderedChildren,
                sizing: orderedSizing,
            },
            [parent.id]: {
                ...parent,
                children: parent.children.map((id) => (id === referenceWrapperId ? groupId : id)),
            },
        };
    }
    const rootSurface = surfaceRootOwner(doc, referenceWrapperId);
    if (!rootSurface) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout edge reference has no parent or surface: ${referenceWrapperId}`);
    }
    if (reference.kind === 'row' || reference.kind === 'column') {
        if (reference.kind === wantedKind) {
            // 同轴插入 column 的轴默认（见上方嵌套分支同款注释）。
            const insertAt = edge === 'left' || edge === 'top' ? 0 : reference.children.length;
            const children = reference.children.filter((id) => id !== slotNodeId);
            const sizing = reference.sizing.filter((_, index) => reference.children[index] !== slotNodeId);
            children.splice(insertAt, 0, slotNodeId);
            sizing.splice(insertAt, 0, childSizingForAxis(wantedKind, childSizing));
            return {
                ...nodesWithSlot,
                [reference.id]: { ...reference, children, sizing },
            };
        }
        const oldRootId = uniqueLayoutNodeId(nodesWithSlot, `${reference.id}:content`);
        // 同一原则：wrap 出的新 root 是 wantedKind 轴，
        // 被拖入的新卡若落在 column 轴，不能沿用 childSizing 这份宽度契约默认——
        // 换成 50/50 elastic。旧 root 整体（oldRootId）那一侧本就是轴无关的
        // 'fill'（≈elastic weight 1），不是从某条具体轴的宽度/高度条目继承来的，
        // 维持不变。
        const wrappedInsertedSizing = childSizingForAxis(wantedKind, childSizing);
        const orderedChildren = edge === 'left' || edge === 'top'
            ? [slotNodeId, oldRootId]
            : [oldRootId, slotNodeId];
        const orderedSizing = edge === 'left' || edge === 'top'
            ? [wrappedInsertedSizing, { kind: 'fill' }]
            : [{ kind: 'fill' }, wrappedInsertedSizing];
        return {
            ...nodesWithSlot,
            [oldRootId]: { ...reference, id: oldRootId },
            [rootSurface.rootNodeId]: {
                id: rootSurface.rootNodeId,
                kind: wantedKind,
                children: orderedChildren,
                sizing: orderedSizing,
            },
        };
    }
    const oldRootId = uniqueLayoutNodeId(nodesWithSlot, `${reference.id}:content`);
    const wrappedInsertedSizingSolo = childSizingForAxis(wantedKind, childSizing);
    const orderedChildren = edge === 'left' || edge === 'top'
        ? [slotNodeId, oldRootId]
        : [oldRootId, slotNodeId];
    const orderedSizing = edge === 'left' || edge === 'top'
        ? [wrappedInsertedSizingSolo, { kind: 'fill' }]
        : [{ kind: 'fill' }, wrappedInsertedSizingSolo];
    return {
        ...nodesWithSlot,
        [oldRootId]: { ...reference, id: oldRootId },
        [rootSurface.rootNodeId]: {
            id: rootSurface.rootNodeId,
            kind: wantedKind,
            children: orderedChildren,
            sizing: orderedSizing,
        },
    };
}
function resolvePlacementSurface(doc, target) {
    if (target.kind === 'surface')
        return requireSurface(doc, target.surfaceId);
    if (target.kind === 'active-page')
        return requireSurface(doc, doc.activeSurfaceId);
    if (target.kind === 'home')
        return requireSurface(doc, CHALKBOARD_LAYOUT_HOME_SURFACE_ID);
    throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout placement target is not a surface: ${target.kind}`);
}
/** 数一个子树里有多少张卡。
 *
 *  默认落位靠它区分「页面上还只有一张卡」与「已经有两张以上」——这两种情形
 *  第一次分裂的方向不同（见 DEFAULT_PLACEMENT_STACK_CAP 注释）。数的是 card
 *  节点本身而不是 slot：一个 slot 里可能叠着多张标签卡，那也算多张。 */
function countCardsInSubtree(nodes, nodeId) {
    const node = nodes[nodeId];
    if (!node)
        return 0;
    if (node.kind === 'card')
        return 1;
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        return node.children.reduce((sum, childId) => sum + countCardsInSubtree(nodes, childId), 0);
    }
    return 0;
}
/** export 供测试直接单元验证（见 defaultPlacementStackReference 同款理由），
 *  也供调用侧判断某节点子树是否含指定卡实例（如聊天主卡永不被竖切判断）。 */
export function subtreeContainsCardInstance(nodes, nodeId, cardInstanceId) {
    const node = nodes[nodeId];
    if (!node)
        return false;
    if (node.kind === 'card')
        return node.cardInstanceId === cardInstanceId;
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        return node.children.some((childId) => subtreeContainsCardInstance(nodes, childId, cardInstanceId));
    }
    return false;
}
/** 竖排堆叠封顶：最右竖列达到这个孩子数就不再同轴 append，回退另起新列。
 *
 *  默认落位语义：**页面上只有
 *  一张卡时，第一次分裂朝右**——横着开出第二列，而不是把唯一那张卡竖切成上下
 *  两半；**两张及以上才落最右列下方**。旧规则一律先竖切，结果是用户开第二张
 *  卡时拿到的是被压扁的上下两半，而不是自然的左右分栏。
 *
 *  本常量只管「竖列堆到几张就换列」，与上面那条「第一刀往哪切」正交：
 *  方向由 countCardsInSubtree 的结果决定，见 defaultPlacementStackReference。 */
const DEFAULT_PLACEMENT_STACK_CAP = 2;
/** 内建 host 主卡（主页聊天卡、群聊页聊天卡）是页面家具的主体，永不作为
 *  堆叠参照被竖切——它们所在的格保持设计好的横排构图（如群聊页的
 *  固定宽频道面板贴在聊天卡右侧）。 */
const DEFAULT_PLACEMENT_PROTECTED_HOST_CARD_IDS = [
    CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID,
    CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID,
];
function subtreeContainsProtectedHostCard(nodes, nodeId) {
    return DEFAULT_PLACEMENT_PROTECTED_HOST_CARD_IDS.some((cardInstanceId) => subtreeContainsCardInstance(nodes, nodeId, cardInstanceId));
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
export function defaultPlacementStackReference(nodes, surface) {
    const root = nodes[surface.rootNodeId];
    if (!root)
        return null;
    // 第一刀的方向：页面上还只有一张卡时朝右（横着开第二列），两张之后才朝下。
    // 见 DEFAULT_PLACEMENT_STACK_CAP 注释中的默认落位规则。
    const firstEdge = countCardsInSubtree(nodes, surface.rootNodeId) <= 1
        ? 'right'
        : 'bottom';
    if (root.kind === 'slot') {
        if (root.children.length === 0)
            return null;
        if (subtreeContainsProtectedHostCard(nodes, root.id))
            return null;
        return { referenceNodeId: root.id, edge: firstEdge };
    }
    if (root.kind === 'column') {
        if (root.children.length === 0)
            return null;
        if (subtreeContainsProtectedHostCard(nodes, root.id))
            return null;
        if (root.children.length < DEFAULT_PLACEMENT_STACK_CAP) {
            return { referenceNodeId: root.children[root.children.length - 1], edge: firstEdge };
        }
        return { referenceNodeId: root.id, edge: 'right' };
    }
    if (root.kind !== 'row' || root.children.length === 0)
        return null;
    const lastId = root.children[root.children.length - 1];
    if (subtreeContainsProtectedHostCard(nodes, lastId))
        return null;
    const last = nodes[lastId];
    if (!last)
        return null;
    if (last.kind === 'column') {
        if (last.children.length === 0)
            return null;
        return last.children.length < DEFAULT_PLACEMENT_STACK_CAP
            ? { referenceNodeId: last.children[last.children.length - 1], edge: 'bottom' }
            : null;
    }
    return { referenceNodeId: lastId, edge: firstEdge };
}
function insertCard(doc, request) {
    if (request.target === 'auto' || request.target === undefined) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout insertCard requires an explicit target: ${request.definitionId}`);
    }
    const cardId = request.instanceId ?? nextCardInstanceId(doc, request.definitionId);
    if (doc.cards[cardId]) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout card already exists: ${cardId}`);
    }
    const nodeId = cardNodeId(cardId);
    const card = {
        id: cardId,
        definitionId: request.definitionId,
        source: request.source,
        ...(request.kernelSource ? { kernelSource: request.kernelSource } : {}),
        ...(request.renderer ? { renderer: request.renderer } : {}),
        ...(request.diagnostics ? { diagnostics: request.diagnostics } : {}),
        binding: request.binding === 'auto' ? null : request.binding ?? null,
        title: request.title ?? null,
        createdAt: 0,
        lifecycle: 'active',
    };
    if (request.rendererState && Object.keys(request.rendererState).length > 0) {
        card.rendererState = request.rendererState;
    }
    if (request.target.kind !== 'detached') {
        const surface = resolvePlacementSurface(doc, request.target);
        const nodesWithCard = {
            ...doc.nodes,
            [nodeId]: { id: nodeId, kind: 'card', cardInstanceId: cardId },
        };
        const docWithCard = {
            ...doc,
            nodes: nodesWithCard,
            cards: { ...doc.cards, [cardId]: card },
        };
        let nodes;
        if (request.target.placement.kind === 'slot') {
            nodes = insertNodeIntoSlot(docWithCard, nodesWithCard, request.target.placement.slotNodeId, nodeId);
        }
        else if (request.target.placement.kind === 'edge' && request.target.placement.referenceNodeId) {
            nodes = insertSiblingAtEdge(docWithCard, nodesWithCard, nodeId, request.target.placement.referenceNodeId, request.target.placement.edge);
        }
        else {
            // default placement：单卡页先向右分栏，多卡页优先落最右卡下方，
            // 封顶 2 张（避免无限竖切），host 主卡子树永不被竖切——见
            // defaultPlacementStackReference 注释。stackRef 为 null 时回退
            // attachNodeToSurfaceRoot（空页填满 / 另起最右新列）。
            const stackRef = defaultPlacementStackReference(nodesWithCard, surface);
            nodes = stackRef
                ? insertSiblingAtEdge(docWithCard, nodesWithCard, nodeId, stackRef.referenceNodeId, stackRef.edge)
                : attachNodeToSurfaceRoot(docWithCard, nodesWithCard, surface, nodeId, insertedChildSizing(docWithCard, request.definitionId, cardId));
        }
        return {
            ...doc,
            activeSurfaceId: surface.id,
            activePageId: surface.pageId ?? doc.activePageId,
            nodes,
            cards: { ...doc.cards, [cardId]: card },
            focus: { kind: 'card', surfaceId: surface.id, cardInstanceId: cardId },
        };
    }
    const rootNodeId = detachedRootNodeId(cardId);
    const surfaceId = detachedSurfaceId(cardId);
    return {
        ...doc,
        activeSurfaceId: surfaceId,
        surfaces: {
            ...doc.surfaces,
            [surfaceId]: {
                id: surfaceId,
                kind: 'detached',
                role: 'floating',
                rootNodeId,
                bounds: request.target.bounds,
                returnSurfaceId: CHALKBOARD_LAYOUT_HOME_SURFACE_ID,
                capabilities: {
                    acceptsCards: true,
                    acceptsFunctionPanelContributions: false,
                    acceptsDragDrop: true,
                    persistsLayout: true,
                    canDetachCards: true,
                    canClose: true,
                },
            },
        },
        nodes: {
            ...doc.nodes,
            [rootNodeId]: {
                id: rootNodeId,
                kind: 'slot',
                children: [nodeId],
                activeChildId: nodeId,
                titlebarMode: 'compact',
            },
            [nodeId]: { id: nodeId, kind: 'card', cardInstanceId: cardId },
        },
        cards: { ...doc.cards, [cardId]: card },
        focus: { kind: 'card', surfaceId, cardInstanceId: cardId },
    };
}
/**
 * 卡内容级 doc 助手：binding 属于卡内容，只写 doc.cards 上的字段，不属于
 * ChalkboardLayoutCommand 词汇表——命令式布局变换（reduceChalkboardLayoutCommands）
 * 之外允许直调，唯一生产调用方是 chalkboard-slice.ts 的
 * updateChalkboardCardContent / rebindChalkboardPreviewCard。卡不存在时
 * 经 requireCard 抛 NODE_NOT_FOUND，不吞不兜底。
 */
export function updateCardBinding(doc, cardInstanceId, binding) {
    const card = requireCard(doc, cardInstanceId);
    return {
        ...doc,
        cards: {
            ...doc.cards,
            [card.id]: { ...card, binding },
        },
    };
}
/** 卡内容级 doc 助手：title 版本，语义同 updateCardBinding（见其注释）。 */
export function updateCardTitle(doc, cardInstanceId, title) {
    const card = requireCard(doc, cardInstanceId);
    return {
        ...doc,
        cards: {
            ...doc.cards,
            [card.id]: { ...card, title },
        },
    };
}
function updateCardRendererState(doc, cardInstanceId, rendererState) {
    const card = requireCard(doc, cardInstanceId);
    const nextCard = { ...card };
    if (rendererState && Object.keys(rendererState).length > 0) {
        nextCard.rendererState = rendererState;
    }
    else {
        delete nextCard.rendererState;
    }
    return {
        ...doc,
        cards: {
            ...doc.cards,
            [card.id]: nextCard,
        },
    };
}
function resizeContainer(doc, nodeId, sizing) {
    const node = requireNode(doc, nodeId);
    if (node.kind !== 'row' && node.kind !== 'column') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout resize requires row/column: ${nodeId}`);
    }
    if (node.children.length !== sizing.length) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout resize ${nodeId} expected ${node.children.length} sizing entries, got ${sizing.length}`);
    }
    let cardSizeIntents = doc.cardSizeIntents;
    let intentsChanged = false;
    node.children.forEach((childId, index) => {
        const item = sizing[index];
        if (!item || item.kind !== 'fixed')
            return;
        const cardId = firstCardInstanceIdForNode(doc, doc.nodes, childId);
        if (!cardId || !(item.px > 0))
            return;
        const widthPx = Math.round(item.px);
        if (doc.cardSizeIntents?.[cardId]?.widthPx === widthPx)
            return;
        cardSizeIntents = {
            ...(cardSizeIntents ?? {}),
            [cardId]: { ...(cardSizeIntents?.[cardId] ?? {}), widthPx },
        };
        intentsChanged = true;
    });
    return {
        ...doc,
        ...(intentsChanged ? { cardSizeIntents } : {}),
        nodes: { ...doc.nodes, [node.id]: { ...node, sizing: [...sizing] } },
    };
}
function reorderContainerChild(doc, nodeId, childNodeId, toIndex) {
    const node = requireNode(doc, nodeId);
    if (node.kind !== 'row' && node.kind !== 'column') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout reorder requires row/column: ${nodeId}`);
    }
    const fromIndex = node.children.indexOf(childNodeId);
    if (fromIndex < 0) {
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout reorder child not found: ${childNodeId}`);
    }
    const children = [...node.children];
    const sizing = [...node.sizing];
    const [child] = children.splice(fromIndex, 1);
    const [childSizing] = sizing.splice(fromIndex, 1);
    const insertAt = Math.max(0, Math.min(toIndex, children.length));
    children.splice(insertAt, 0, child);
    // fallback 走轴默认：childSizing 理应恒非空（splice 取自等长数组），
    // 这里只是兜底缺口，同样按目标容器轴分流。
    sizing.splice(insertAt, 0, childSizing ?? childSizingForAxis(node.kind, childSizingForNode(doc, doc.nodes, child)));
    return {
        ...doc,
        nodes: {
            ...doc.nodes,
            [node.id]: { ...node, children, sizing },
        },
    };
}
function removeCardFromLayout(doc, cardInstanceId) {
    const nodeId = findCardNodeId(doc, cardInstanceId);
    const nextNodes = { ...removeNodeFromLayoutPosition(doc, nodeId) };
    delete nextNodes[nodeId];
    const nextCards = { ...doc.cards };
    delete nextCards[cardInstanceId];
    return { ...doc, nodes: nextNodes, cards: nextCards };
}
function closeCard(doc, cardInstanceId) {
    if (cardInstanceId === CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', 'layout home chat card cannot be closed');
    }
    let next = doc;
    const descendantIds = collectLifecycleDescendantCardIds(doc, cardInstanceId);
    for (const descendantId of descendantIds) {
        if (next.cards[descendantId])
            next = removeCardFromLayout(next, descendantId);
    }
    if (next.cards[cardInstanceId])
        next = removeCardFromLayout(next, cardInstanceId);
    return normalizeChalkboardLayoutDocument(next);
}
function assertCardCanDetach(card) {
    if (card.definitionId === CHALKBOARD_HOME_CHAT_TILE_ID || card.definitionId === CHALKBOARD_TILE_CHANNEL_CHAT) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout chat card cannot be detached: ${card.id}`);
    }
}
function detachCard(doc, cardInstanceId, bounds) {
    const card = requireCard(doc, cardInstanceId);
    assertCardCanDetach(card);
    const nodeId = findCardNodeId(doc, cardInstanceId);
    const oldSurface = surfaceContainingNode(doc, nodeId);
    const nodesWithoutCard = removeNodeFromLayoutPosition(doc, nodeId);
    const rootNodeId = detachedRootNodeId(cardInstanceId);
    const surfaceId = detachedSurfaceId(cardInstanceId);
    const nodes = {
        ...nodesWithoutCard,
        [rootNodeId]: {
            id: rootNodeId,
            kind: 'slot',
            children: [nodeId],
            activeChildId: nodeId,
            titlebarMode: 'compact',
        },
    };
    return {
        ...doc,
        activeSurfaceId: surfaceId,
        surfaces: {
            ...doc.surfaces,
            [surfaceId]: {
                id: surfaceId,
                kind: 'detached',
                role: 'floating',
                rootNodeId,
                bounds,
                returnSurfaceId: oldSurface.id,
                capabilities: {
                    acceptsCards: true,
                    acceptsFunctionPanelContributions: false,
                    acceptsDragDrop: true,
                    persistsLayout: true,
                    canDetachCards: true,
                    canClose: true,
                },
            },
        },
        nodes,
        focus: { kind: 'card', surfaceId, cardInstanceId },
    };
}
function findPageSurface(surfaces, pageId) {
    if (!pageId)
        return undefined;
    if (pageId === CHALKBOARD_CHAT_PAGE_ID)
        return surfaces[CHALKBOARD_LAYOUT_HOME_SURFACE_ID];
    return Object.values(surfaces).find((item) => item.pageId === pageId);
}
function resolveFocusFallbackSurface(surfaces, input) {
    return surfaces[input.activeSurfaceId]
        ?? findPageSurface(surfaces, input.activePageId)
        ?? (input.vanishedReturnSurfaceId ? surfaces[input.vanishedReturnSurfaceId] : undefined)
        ?? surfaces[CHALKBOARD_LAYOUT_HOME_SURFACE_ID]
        ?? Object.values(surfaces)[0]
        ?? null;
}
function removeDetachedSurface(doc, surface) {
    if (surface.kind !== 'detached')
        return doc;
    const nodes = { ...doc.nodes };
    const surfaces = { ...doc.surfaces };
    for (const nodeId of collectNodeSubtree(doc.nodes, surface.rootNodeId))
        delete nodes[nodeId];
    delete surfaces[surface.id];
    const surfaceWasActive = doc.activeSurfaceId === surface.id;
    const fallbackSurface = resolveFocusFallbackSurface(surfaces, {
        activeSurfaceId: surfaceWasActive ? '' : doc.activeSurfaceId,
        activePageId: doc.activePageId,
        vanishedReturnSurfaceId: surface.returnSurfaceId,
    });
    if (!fallbackSurface)
        return { ...doc, nodes, surfaces };
    const focusWasOnSurface = doc.focus.surfaceId === surface.id;
    return {
        ...doc,
        nodes,
        surfaces,
        activeSurfaceId: surfaceWasActive ? fallbackSurface.id : doc.activeSurfaceId,
        activePageId: surfaceWasActive ? fallbackSurface.pageId ?? doc.activePageId : doc.activePageId,
        focus: focusWasOnSurface ? { kind: 'surface', surfaceId: fallbackSurface.id } : doc.focus,
    };
}
function updateSurfaceBounds(doc, surfaceId, bounds) {
    const surface = requireSurface(doc, surfaceId);
    if (surface.kind !== 'detached') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout surface bounds are only mutable for detached surfaces: ${surfaceId}`);
    }
    // bounds 未变则原样返回，避免相等的几何 tick 产生新 doc 引用、触发全画布重渲染。
    const current = surface.bounds;
    if (current
        && current.x === bounds.x
        && current.y === bounds.y
        && current.width === bounds.width
        && current.height === bounds.height) {
        return doc;
    }
    return {
        ...doc,
        surfaces: {
            ...doc.surfaces,
            [surface.id]: { ...surface, bounds },
        },
    };
}
function setDetachedSurfacePinMode(doc, surfaceId, pinMode) {
    const surface = requireSurface(doc, surfaceId);
    if (surface.kind !== 'detached') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout surface pin mode is only mutable for detached surfaces: ${surfaceId}`);
    }
    const nextSurface = { ...surface };
    if (pinMode === 'always-on-top')
        nextSurface.pinMode = pinMode;
    else
        delete nextSurface.pinMode;
    return {
        ...doc,
        surfaces: {
            ...doc.surfaces,
            [surface.id]: nextSurface,
        },
    };
}
function layoutTargetSurface(doc, target) {
    if (target.kind === 'surface-root')
        return requireSurface(doc, target.surfaceId);
    if (target.kind === 'detached') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', 'layout dock target cannot be detached');
    }
    if (target.kind === 'slot' || target.kind === 'edge') {
        return surfaceContainingNode(doc, target.kind === 'slot' ? target.slotNodeId : target.referenceNodeId);
    }
    throw new ChalkboardLayoutError('INVALID_STRUCTURE', `unsupported layout target: ${target.kind}`);
}
function dockCard(doc, cardInstanceId, target) {
    const card = requireCard(doc, cardInstanceId);
    const nodeId = findCardNodeId(doc, cardInstanceId);
    const oldSurface = surfaceContainingNode(doc, nodeId);
    const targetSurface = layoutTargetSurface(doc, target);
    if (cardInstanceId === CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID && targetSurface.id !== oldSurface.id) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout home chat card cannot leave home page: ${cardInstanceId}`);
    }
    let nodes = removeNodeFromLayoutPosition(doc, nodeId);
    const surfaces = { ...doc.surfaces };
    if (oldSurface.kind === 'detached') {
        const oldNodeIds = collectNodeSubtree(nodes, oldSurface.rootNodeId);
        for (const oldNodeId of oldNodeIds) {
            if (oldNodeId !== nodeId)
                delete nodes[oldNodeId];
        }
        delete surfaces[oldSurface.id];
    }
    nodes = attachNodeToSurfaceRoot(doc, nodes, targetSurface, nodeId, insertedChildSizing(doc, card.definitionId, card.id));
    return {
        ...doc,
        surfaces,
        nodes,
        activeSurfaceId: targetSurface.id,
        activePageId: targetSurface.pageId ?? doc.activePageId,
        focus: { kind: 'card', surfaceId: targetSurface.id, cardInstanceId },
    };
}
function cleanupOldDetachedSurface(doc, nodes, surfaces, oldSurface, keptNodeId) {
    if (oldSurface.kind !== 'detached')
        return { nodes, surfaces };
    const nextNodes = { ...nodes };
    for (const oldNodeId of collectNodeSubtree(nodes, oldSurface.rootNodeId)) {
        if (oldNodeId !== keptNodeId)
            delete nextNodes[oldNodeId];
    }
    const nextSurfaces = { ...surfaces };
    delete nextSurfaces[oldSurface.id];
    return { nodes: nextNodes, surfaces: nextSurfaces };
}
function targetSurfaceForMove(doc, target) {
    if (target.kind === 'detached') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', 'layout move target surface is created by detachCard');
    }
    return layoutTargetSurface(doc, target);
}
function attachMovedCardNode(doc, nodes, card, nodeId, target) {
    if (target.kind === 'slot') {
        const surface = surfaceContainingNode({ ...doc, nodes }, target.slotNodeId);
        return {
            nodes: insertNodeIntoSlot(doc, nodes, target.slotNodeId, nodeId, target.index),
            surface,
        };
    }
    if (target.kind === 'edge') {
        const surface = surfaceContainingNode({ ...doc, nodes }, target.referenceNodeId);
        return {
            nodes: insertSiblingAtEdge(doc, nodes, nodeId, target.referenceNodeId, target.edge),
            surface,
        };
    }
    const surface = requireSurface(doc, target.surfaceId);
    if (target.placement.kind === 'slot') {
        const slotSurface = surfaceContainingNode({ ...doc, nodes }, target.placement.slotNodeId);
        return {
            nodes: insertNodeIntoSlot(doc, nodes, target.placement.slotNodeId, nodeId),
            surface: slotSurface,
        };
    }
    if (target.placement.kind === 'edge' && target.placement.referenceNodeId) {
        const edgeSurface = surfaceContainingNode({ ...doc, nodes }, target.placement.referenceNodeId);
        return {
            nodes: insertSiblingAtEdge(doc, nodes, nodeId, target.placement.referenceNodeId, target.placement.edge),
            surface: edgeSurface,
        };
    }
    return {
        nodes: attachNodeToSurfaceRoot(doc, nodes, surface, nodeId, insertedChildSizing(doc, card.definitionId, card.id)),
        surface,
    };
}
function moveCard(doc, cardInstanceId, target) {
    const card = requireCard(doc, cardInstanceId);
    if (target.kind === 'detached')
        return detachCard(doc, cardInstanceId, target.bounds);
    const nodeId = findCardNodeId(doc, cardInstanceId);
    const oldSurface = surfaceContainingNode(doc, nodeId);
    const targetSurface = targetSurfaceForMove(doc, target);
    if (cardInstanceId === CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID && targetSurface.id !== oldSurface.id) {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout home chat card cannot leave home page: ${cardInstanceId}`);
    }
    let nodes = removeNodeFromLayoutPosition(doc, nodeId);
    let surfaces = { ...doc.surfaces };
    ({ nodes, surfaces } = cleanupOldDetachedSurface(doc, nodes, surfaces, oldSurface, nodeId));
    const attached = attachMovedCardNode(doc, nodes, card, nodeId, target);
    return {
        ...doc,
        surfaces,
        nodes: attached.nodes,
        activeSurfaceId: attached.surface.id,
        activePageId: attached.surface.pageId ?? doc.activePageId,
        focus: { kind: 'card', surfaceId: attached.surface.id, cardInstanceId },
    };
}
function moveCardIntoSlot(doc, cardInstanceId, slotNodeId, index) {
    const currentNodeId = findCardNodeId(doc, cardInstanceId);
    if (findParentNodeId(doc.nodes, currentNodeId) === slotNodeId)
        return doc;
    return moveCard(doc, cardInstanceId, { kind: 'slot', slotNodeId, index });
}
function extractCardFromSlot(doc, cardInstanceId, target) {
    const currentNodeId = findCardNodeId(doc, cardInstanceId);
    const parentId = findParentNodeId(doc.nodes, currentNodeId);
    const parent = parentId ? doc.nodes[parentId] : null;
    if (parent?.kind !== 'slot') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout card is not inside a slot: ${cardInstanceId}`);
    }
    return moveCard(doc, cardInstanceId, target);
}
function activateSlotChild(doc, slotNodeId, childNodeId) {
    const slot = requireNode(doc, slotNodeId);
    if (slot.kind !== 'slot') {
        throw new ChalkboardLayoutError('INVALID_STRUCTURE', `layout target is not a slot: ${slotNodeId}`);
    }
    if (!slot.children.includes(childNodeId)) {
        throw new ChalkboardLayoutError('NODE_NOT_FOUND', `layout slot child not found: ${slotNodeId}/${childNodeId}`);
    }
    const surface = surfaceContainingNode(doc, childNodeId);
    const next = {
        ...doc,
        nodes: {
            ...doc.nodes,
            [slot.id]: { ...slot, activeChildId: childNodeId },
        },
        activeSurfaceId: surface.id,
        activePageId: surface.pageId ?? doc.activePageId,
        focus: { kind: 'surface', surfaceId: surface.id },
    };
    const cardInstanceId = firstCardIdInSubtree(next, childNodeId);
    return cardInstanceId
        ? setFocus(next, { kind: 'card', surfaceId: surface.id, cardInstanceId })
        : next;
}
function reduceChalkboardLayoutCommand(doc, command) {
    switch (command.kind) {
        case 'ensurePageTemplate':
            if (command.definitionId === CHALKBOARD_CARD_CHANNELS_PAGE) {
                return ensureChalkboardPageTemplate(doc, { kind: 'channels' });
            }
            throw new ChalkboardLayoutError('INVALID_STRUCTURE', `unsupported page template: ${command.definitionId}`);
        case 'insertCard':
            return insertCard(doc, command.request);
        case 'updateCardRendererState':
            return updateCardRendererState(doc, command.cardInstanceId, command.rendererState);
        case 'resizeContainer':
            return resizeContainer(doc, command.nodeId, command.sizing);
        case 'reorderContainerChild':
            return reorderContainerChild(doc, command.nodeId, command.childNodeId, command.toIndex);
        case 'detachCard':
            return detachCard(doc, command.cardInstanceId, command.bounds);
        case 'updateSurfaceBounds':
            return updateSurfaceBounds(doc, command.surfaceId, command.bounds);
        case 'setDetachedSurfacePinMode':
            return setDetachedSurfacePinMode(doc, command.surfaceId, command.pinMode);
        case 'dockCard':
            return dockCard(doc, command.cardInstanceId, command.target);
        case 'moveCard':
            return moveCard(doc, command.cardInstanceId, command.target);
        case 'moveCardIntoSlot':
            return moveCardIntoSlot(doc, command.cardInstanceId, command.slotNodeId, command.index);
        case 'extractCardFromSlot':
            return extractCardFromSlot(doc, command.cardInstanceId, command.target);
        case 'closeCard':
            return closeCard(doc, command.cardInstanceId);
        case 'activateSlotChild':
            return activateSlotChild(doc, command.slotNodeId, command.childNodeId);
        case 'removePage':
            return removePage(doc, command.pageId);
        case 'setFocus':
            return setFocus(doc, command.target);
        case 'setCardLineage':
            return setCardLineage(doc, command.cardInstanceId, command.lineage);
        default:
            throw new ChalkboardLayoutError('INVALID_STRUCTURE', `unsupported layout command: ${command.kind}`);
    }
}
export function applyChalkboardLayoutCommand(doc, command) {
    const current = normalizeChalkboardLayoutDocument(doc);
    return normalizeChalkboardLayoutDocument(reduceChalkboardLayoutCommand(current, command));
}
//# sourceMappingURL=layout-document-reducer.js.map