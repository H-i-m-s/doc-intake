/**
 * chalkboard-layout/layout-document-factory.ts — generated from shared/chalkboard-layout/layout-document-factory.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { CHALKBOARD_CHANNELS_PAGE_ID, CHALKBOARD_CHANNELS_STACK_DEFAULT_PX, CHALKBOARD_CHANNELS_STACK_MIN_PX, CHALKBOARD_CHAT_MIN_PX, CHALKBOARD_CHAT_PAGE_ID, CHALKBOARD_CODE_CHANGES_RENDERER_KIND, CHALKBOARD_CODE_PAGE_ID, CHALKBOARD_HOME_CHAT_TILE_ID, CHALKBOARD_PREVIEW_TILE_ID, CHALKBOARD_STUDIO_FOLDER_RENDERER_KIND, CHALKBOARD_STUDIO_HOME_RENDERER_KIND, CHALKBOARD_STUDIO_LIBRARY_RENDERER_KIND, CHALKBOARD_STUDIO_PAGE_ID, CHALKBOARD_STUDIO_PREVIEW_RENDERER_KIND, CHALKBOARD_STUDIO_ROOT_NODE_ID, CHALKBOARD_STUDIO_SURFACE_ID, CHALKBOARD_TILE_CHANNEL_CHAT, CHALKBOARD_TILE_CHANNEL_STACK, CHALKBOARD_TILE_WORKSPACE_DESK, CHALKBOARD_WORKSPACE_MIN_PX, } from './chalkboard-builtin-ids.js';
export const CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID = 'card:code-chat';
export const CHALKBOARD_LAYOUT_CODE_WORKSPACE_CARD_ID = 'card:code-workspace-desk';
/** Code 页自己的终端卡实例（定义仍是终端卡，身份与首页的 card:terminal 分开）。 */
export const CHALKBOARD_LAYOUT_CODE_TERMINAL_CARD_ID = 'card:code-terminal';
/** Code 页的改动卡实例：只在新建 Code 页模板时放入，之后由菜单开关，不随 reconcile 回填。 */
export const CHALKBOARD_LAYOUT_CODE_CHANGES_CARD_ID = 'card:code-changes';
export const CHALKBOARD_LAYOUT_CODE_ACTIONS_CARD_ID = 'card:code-actions';
export const CHALKBOARD_LAYOUT_HOME_SURFACE_ID = 'surface:home';
export const CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID = 'card:home-chat';
export const CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID = 'card:workspace-desk';
export const CHALKBOARD_LAYOUT_TERMINAL_CARD_ID = 'card:terminal';
export const CHALKBOARD_LAYOUT_CHANNELS_PAGE_ID = CHALKBOARD_CHANNELS_PAGE_ID;
export const CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID = `card:page:${CHALKBOARD_CHANNELS_PAGE_ID}:chat`;
export const CHALKBOARD_LAYOUT_CHANNEL_STACK_CARD_ID = `card:page:${CHALKBOARD_CHANNELS_PAGE_ID}:stack`;
const CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID = 'node:home-root';
const CHALKBOARD_LAYOUT_HOME_CHAT_SLOT_ID = 'node:home-chat-slot';
const CHALKBOARD_LAYOUT_HOME_CHAT_CARD_NODE_ID = 'node:home-chat-card';
const CHALKBOARD_LAYOUT_HOME_WORKSPACE_SLOT_ID = 'node:home-workspace-slot';
const CHALKBOARD_LAYOUT_HOME_WORKSPACE_CARD_NODE_ID = 'node:home-workspace-card';
/**
 * Home surface 的能力集是跨呈现的唯一定义源：桌面出厂文档和手机档案文档
 * 都用它声明各自的 home surface，禁止在别处复制字面量。
 */
export const CHALKBOARD_LAYOUT_HOME_SURFACE_CAPABILITIES = {
    acceptsCards: true,
    acceptsFunctionPanelContributions: false,
    acceptsDragDrop: true,
    persistsLayout: true,
    canDetachCards: true,
    canClose: false,
    locked: true,
};
const homeCapabilities = CHALKBOARD_LAYOUT_HOME_SURFACE_CAPABILITIES;
/** @deprecated Old page fixture id; read-time migration folds this into the Preview page card. */
export const CHALKBOARD_LAYOUT_STUDIO_HOME_CARD_ID = 'card:studio-home';
/** @deprecated Old home-card node id; kept so persisted documents can be recognized. */
export const CHALKBOARD_LAYOUT_STUDIO_HOME_CARD_NODE_ID = 'node:studio-window:home';
export const CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID = 'card:studio-page';
export const CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID = 'node:studio-window:page';
export const STUDIO_PAGE_MIGRATED_TABS_KEY = 'studioPageTabs';
export const STUDIO_PAGE_MIGRATED_HOME_PAGE_KEY = 'studioHomePage';
const STUDIO_PAGE_MIN_PX = 320;
const STUDIO_CARDS_FOLDED_INTO_PAGE = new Set([
    CHALKBOARD_STUDIO_HOME_RENDERER_KIND,
    CHALKBOARD_STUDIO_LIBRARY_RENDERER_KIND,
    CHALKBOARD_STUDIO_FOLDER_RENDERER_KIND,
    CHALKBOARD_STUDIO_PREVIEW_RENDERER_KIND,
]);
function studioPageCardInstance(rendererState) {
    return {
        id: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID,
        definitionId: CHALKBOARD_PREVIEW_TILE_ID,
        kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_PREVIEW_TILE_ID },
        renderer: { lane: 'native', rendererKind: CHALKBOARD_PREVIEW_TILE_ID },
        source: { kind: 'card-center' },
        createdAt: 0,
        lifecycle: 'active',
        ...(rendererState ? { rendererState } : {}),
    };
}
function studioPageFillSizing() {
    return { kind: 'fill', minPx: STUDIO_PAGE_MIN_PX };
}
function studioCompanionSizing() {
    return { kind: 'elastic', weight: 0.5, minPx: STUDIO_PAGE_MIN_PX };
}
function collectCardInstanceIdsFromNode(nodes, nodeId, out = [], seen = new Set()) {
    if (seen.has(nodeId))
        return out;
    seen.add(nodeId);
    const node = nodes[nodeId];
    if (!node)
        return out;
    if (node.kind === 'card') {
        out.push(node.cardInstanceId);
        return out;
    }
    if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
        for (const childId of node.children)
            collectCardInstanceIdsFromNode(nodes, childId, out, seen);
    }
    return out;
}
function collectMigratedStudioPageTabs(cards, cardIds) {
    const tabs = [];
    let hasLibrary = false;
    const folders = new Set();
    for (const id of cardIds) {
        if (id === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID)
            continue;
        const card = cards[id];
        if (!card)
            continue;
        if (card.definitionId === CHALKBOARD_STUDIO_LIBRARY_RENDERER_KIND && !hasLibrary) {
            hasLibrary = true;
            tabs.push({ kind: 'library' });
        }
        else if (card.definitionId === CHALKBOARD_STUDIO_FOLDER_RENDERER_KIND && card.binding?.kind === 'studio-folder') {
            const mountId = card.binding.mountId.trim();
            if (mountId && !folders.has(mountId)) {
                folders.add(mountId);
                tabs.push({ kind: 'folder', mountId });
            }
        }
    }
    return tabs;
}
function wrapStudioCompanion(nodes, childId) {
    const child = nodes[childId];
    if (!child || childId === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID)
        return { id: childId, nodes };
    if (child.kind === 'card' && child.cardInstanceId === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID) {
        return { id: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID, nodes };
    }
    if (child.kind === 'card') {
        const slotId = `node:slot:${child.cardInstanceId}`;
        return {
            id: slotId,
            nodes: {
                ...nodes,
                [slotId]: {
                    id: slotId,
                    kind: 'slot',
                    children: [childId],
                    activeChildId: childId,
                    titlebarMode: 'compact',
                },
            },
        };
    }
    return { id: childId, nodes };
}
function studioPageInstalled(doc) {
    const card = doc.cards[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID];
    if (!card || card.definitionId !== CHALKBOARD_PREVIEW_TILE_ID)
        return false;
    const surface = doc.surfaces[CHALKBOARD_STUDIO_SURFACE_ID];
    if (!surface)
        return false;
    const root = doc.nodes[surface.rootNodeId];
    if (root?.kind !== 'row' || root.children[0] !== CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID)
        return false;
    const pageNode = doc.nodes[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID];
    return pageNode?.kind === 'card' && pageNode.cardInstanceId === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID;
}
export const CHALKBOARD_LAYOUT_STUDIO_SURFACE_CAPABILITIES = {
    acceptsCards: true,
    acceptsFunctionPanelContributions: false,
    acceptsDragDrop: true,
    persistsLayout: true,
    canDetachCards: true,
    canClose: false,
};
const pageCapabilities = {
    acceptsCards: true,
    acceptsFunctionPanelContributions: true,
    acceptsDragDrop: true,
    persistsLayout: true,
    canDetachCards: true,
    canClose: true,
};
export function chalkboardLayoutPageSurfaceId(pageId) {
    return `surface:page:${pageId}`;
}
function pageRootNodeId(pageId) {
    return `node:page:${pageId}:root`;
}
function pageCardNodeId(pageId, cardKind) {
    return `node:page:${pageId}:card:${cardKind}`;
}
function assertPageId(pageId, context) {
    if (!pageId.trim())
        throw new Error(`${context} requires a non-empty pageId`);
}
export function createDefaultChalkboardLayoutDocument(now = 0) {
    const surfaces = {};
    const nodes = {};
    const cards = {};
    cards[CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID,
        definitionId: CHALKBOARD_HOME_CHAT_TILE_ID,
        kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_HOME_CHAT_TILE_ID },
        renderer: { lane: 'native', rendererKind: CHALKBOARD_HOME_CHAT_TILE_ID },
        source: { kind: 'card-center' },
        createdAt: now,
        lifecycle: 'active',
    };
    cards[CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID] = {
        id: CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID,
        definitionId: CHALKBOARD_TILE_WORKSPACE_DESK,
        kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_TILE_WORKSPACE_DESK },
        renderer: { lane: 'native', rendererKind: CHALKBOARD_TILE_WORKSPACE_DESK },
        source: { kind: 'card-center' },
        lineage: {
            parentCardInstanceId: CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID,
            relationship: 'workspace',
            detachBehavior: 'keep-lineage',
        },
        createdAt: now,
        lifecycle: 'active',
    };
    nodes[CHALKBOARD_LAYOUT_HOME_CHAT_CARD_NODE_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_CHAT_CARD_NODE_ID,
        kind: 'card',
        cardInstanceId: CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID,
    };
    nodes[CHALKBOARD_LAYOUT_HOME_WORKSPACE_CARD_NODE_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_WORKSPACE_CARD_NODE_ID,
        kind: 'card',
        cardInstanceId: CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID,
    };
    nodes[CHALKBOARD_LAYOUT_HOME_CHAT_SLOT_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_CHAT_SLOT_ID,
        kind: 'slot',
        children: [CHALKBOARD_LAYOUT_HOME_CHAT_CARD_NODE_ID],
        activeChildId: CHALKBOARD_LAYOUT_HOME_CHAT_CARD_NODE_ID,
        titlebarMode: 'hidden',
    };
    nodes[CHALKBOARD_LAYOUT_HOME_WORKSPACE_SLOT_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_WORKSPACE_SLOT_ID,
        kind: 'slot',
        children: [CHALKBOARD_LAYOUT_HOME_WORKSPACE_CARD_NODE_ID],
        activeChildId: CHALKBOARD_LAYOUT_HOME_WORKSPACE_CARD_NODE_ID,
        titlebarMode: 'compact',
    };
    nodes[CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID,
        kind: 'row',
        children: [CHALKBOARD_LAYOUT_HOME_CHAT_SLOT_ID, CHALKBOARD_LAYOUT_HOME_WORKSPACE_SLOT_ID],
        sizing: [
            { kind: 'fill', minPx: CHALKBOARD_CHAT_MIN_PX },
            {
                kind: 'elastic',
                weight: 0.5,
                minPx: CHALKBOARD_WORKSPACE_MIN_PX,
            },
        ],
    };
    surfaces[CHALKBOARD_LAYOUT_HOME_SURFACE_ID] = {
        id: CHALKBOARD_LAYOUT_HOME_SURFACE_ID,
        kind: 'home',
        role: 'persistent',
        rootNodeId: CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID,
        pageId: CHALKBOARD_CHAT_PAGE_ID,
        capabilities: homeCapabilities,
    };
    return {
        version: 1,
        activeSurfaceId: CHALKBOARD_LAYOUT_HOME_SURFACE_ID,
        activePageId: CHALKBOARD_CHAT_PAGE_ID,
        surfaces,
        nodes,
        cards,
        focus: { kind: 'surface', surfaceId: CHALKBOARD_LAYOUT_HOME_SURFACE_ID },
    };
}
/**
 * Read-time migration: the Studio surface's page fixture is one Preview card.
 * Older documents used a home card (sometimes in a hidden-titlebar slot) and
 * extra Studio cards to the right; those become tabs of the page card.
 */
export function migrateChalkboardStudioHomePage(doc) {
    const surface = doc.surfaces[CHALKBOARD_STUDIO_SURFACE_ID];
    if (!surface)
        return doc;
    let surfaces = doc.surfaces;
    let nodes = doc.nodes;
    let cards = doc.cards;
    let changed = false;
    if (surface.pageId !== CHALKBOARD_STUDIO_PAGE_ID) {
        surfaces = {
            ...surfaces,
            [CHALKBOARD_STUDIO_SURFACE_ID]: { ...surface, pageId: CHALKBOARD_STUDIO_PAGE_ID },
        };
        changed = true;
    }
    if (studioPageInstalled({ ...doc, surfaces, nodes, cards })) {
        return changed ? { ...doc, surfaces, nodes, cards } : doc;
    }
    const root = nodes[surface.rootNodeId] ?? nodes[CHALKBOARD_STUDIO_ROOT_NODE_ID];
    const existingCardIds = root ? collectCardInstanceIdsFromNode(nodes, root.id) : [];
    const migratedTabs = collectMigratedStudioPageTabs(cards, existingCardIds);
    const keepCardIds = new Set([CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID]);
    for (const id of existingCardIds) {
        const card = cards[id];
        if (!card)
            continue;
        if (id === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID)
            continue;
        if (STUDIO_CARDS_FOLDED_INTO_PAGE.has(card.definitionId))
            continue;
        keepCardIds.add(id);
    }
    const nextCards = {};
    for (const [id, card] of Object.entries(cards)) {
        if (id === CHALKBOARD_LAYOUT_STUDIO_HOME_CARD_ID) {
            changed = true;
            continue;
        }
        if (existingCardIds.includes(id) && !keepCardIds.has(id) && id !== CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID) {
            changed = true;
            continue;
        }
        nextCards[id] = card;
    }
    const pageState = migratedTabs.length > 0 ? { [STUDIO_PAGE_MIGRATED_TABS_KEY]: migratedTabs } : undefined;
    const existingPage = nextCards[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID];
    if (!existingPage || existingPage.definitionId !== CHALKBOARD_PREVIEW_TILE_ID) {
        nextCards[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID] = studioPageCardInstance(pageState);
        changed = true;
    }
    else if (pageState && !existingPage.rendererState?.[STUDIO_PAGE_MIGRATED_TABS_KEY]) {
        nextCards[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID] = {
            ...existingPage,
            rendererState: { ...(existingPage.rendererState ?? {}), ...pageState },
        };
        changed = true;
    }
    cards = nextCards;
    const pageNode = nodes[CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID];
    if (pageNode?.kind !== 'card' || pageNode.cardInstanceId !== CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID) {
        nodes = {
            ...nodes,
            [CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID]: {
                id: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID,
                kind: 'card',
                cardInstanceId: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID,
            },
        };
        changed = true;
    }
    const rootNode = nodes[surface.rootNodeId] ?? nodes[CHALKBOARD_STUDIO_ROOT_NODE_ID];
    if (!rootNode)
        return changed ? { ...doc, surfaces, nodes, cards } : doc;
    const companionNodeIds = [];
    const walkKeep = (nodeId, seen = new Set()) => {
        if (seen.has(nodeId))
            return;
        seen.add(nodeId);
        const node = nodes[nodeId];
        if (!node)
            return;
        if (node.kind === 'card') {
            if (keepCardIds.has(node.cardInstanceId) && node.cardInstanceId !== CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID) {
                companionNodeIds.push(node.id);
            }
            return;
        }
        if (node.kind === 'row' || node.kind === 'column' || node.kind === 'slot') {
            for (const childId of node.children)
                walkKeep(childId, seen);
        }
    };
    walkKeep(rootNode.id);
    const nextChildren = [CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID];
    const nextSizing = [studioPageFillSizing()];
    for (const childId of companionNodeIds) {
        const wrapped = wrapStudioCompanion(nodes, childId);
        nodes = wrapped.nodes;
        if (wrapped.id === CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID)
            continue;
        if (nextChildren.includes(wrapped.id))
            continue;
        nextChildren.push(wrapped.id);
        nextSizing.push(studioCompanionSizing());
    }
    const alreadyPageOnly = rootNode.kind === 'row'
        && rootNode.children.length === nextChildren.length
        && rootNode.children.every((id, index) => id === nextChildren[index])
        && rootNode.sizing[0]?.kind === 'fill';
    if (!alreadyPageOnly) {
        nodes = {
            ...nodes,
            [rootNode.id]: { id: rootNode.id, kind: 'row', children: nextChildren, sizing: nextSizing },
        };
        changed = true;
    }
    if (!changed)
        return doc;
    return { ...doc, surfaces, nodes, cards };
}
export function ensureChalkboardStudioSurface(doc) {
    if (doc.surfaces[CHALKBOARD_STUDIO_SURFACE_ID])
        return migrateChalkboardStudioHomePage(doc);
    return {
        ...doc,
        cards: {
            ...doc.cards,
            [CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID]: studioPageCardInstance(),
        },
        nodes: {
            ...doc.nodes,
            [CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID]: {
                id: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID,
                kind: 'card',
                cardInstanceId: CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID,
            },
            [CHALKBOARD_STUDIO_ROOT_NODE_ID]: {
                id: CHALKBOARD_STUDIO_ROOT_NODE_ID,
                kind: 'row',
                children: [CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID],
                sizing: [studioPageFillSizing()],
            },
        },
        surfaces: {
            ...doc.surfaces,
            [CHALKBOARD_STUDIO_SURFACE_ID]: {
                id: CHALKBOARD_STUDIO_SURFACE_ID,
                kind: 'studio',
                role: 'persistent',
                rootNodeId: CHALKBOARD_STUDIO_ROOT_NODE_ID,
                pageId: CHALKBOARD_STUDIO_PAGE_ID,
                capabilities: CHALKBOARD_LAYOUT_STUDIO_SURFACE_CAPABILITIES,
            },
        },
    };
}
export function ensureChalkboardPageTemplate(doc, spec, now = 0) {
    if (spec.kind === 'code')
        return ensureCodePageTemplate(doc, now);
    return spec.kind === 'channels'
        ? ensureChannelsPageTemplate(doc, now)
        : ensureEmptyPageTemplate(doc, spec, now);
}
/** The same persistent home surface, with no cards selected for its initial contents. */
export function createEmptyChalkboardLayoutDocument() {
    const document = createDefaultChalkboardLayoutDocument();
    return {
        ...document,
        cards: {},
        nodes: {
            [CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID]: {
                id: CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID,
                kind: 'row',
                children: [],
                sizing: [],
            },
        },
    };
}
function ensureEmptyPageTemplate(doc, spec, _now) {
    const pageId = spec.pageId.trim();
    assertPageId(pageId, 'ensureChalkboardPageTemplate empty-page');
    const surfaceId = chalkboardLayoutPageSurfaceId(pageId);
    if (doc.surfaces[surfaceId])
        return doc;
    const rootNodeId = pageRootNodeId(pageId);
    const nodes = {
        ...doc.nodes,
        [rootNodeId]: {
            id: rootNodeId,
            kind: 'slot',
            children: [],
            activeChildId: null,
            titlebarMode: 'compact',
        },
    };
    const surfaces = {
        ...doc.surfaces,
        [surfaceId]: {
            id: surfaceId,
            kind: 'page',
            role: 'persistent',
            rootNodeId,
            pageId,
            capabilities: pageCapabilities,
        },
    };
    return { ...doc, surfaces, nodes };
}
function ensureChannelsPageTemplate(doc, now) {
    const pageId = CHALKBOARD_CHANNELS_PAGE_ID;
    const surfaceId = chalkboardLayoutPageSurfaceId(pageId);
    if (doc.surfaces[surfaceId])
        return doc;
    const rootNodeId = pageRootNodeId(pageId);
    const chatCardId = CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID;
    const stackCardId = CHALKBOARD_LAYOUT_CHANNEL_STACK_CARD_ID;
    const chatNodeId = pageCardNodeId(pageId, 'chat');
    const stackNodeId = pageCardNodeId(pageId, 'stack');
    const chatSlotId = `${rootNodeId}:chat-slot`;
    const stackSlotId = `${rootNodeId}:stack-slot`;
    const cards = {
        ...doc.cards,
        [chatCardId]: {
            id: chatCardId,
            definitionId: CHALKBOARD_TILE_CHANNEL_CHAT,
            kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_TILE_CHANNEL_CHAT },
            renderer: { lane: 'native', rendererKind: CHALKBOARD_TILE_CHANNEL_CHAT },
            source: { kind: 'card-center' },
            binding: { kind: 'channels', channelId: null },
            createdAt: now,
            lifecycle: 'active',
        },
        [stackCardId]: {
            id: stackCardId,
            definitionId: CHALKBOARD_TILE_CHANNEL_STACK,
            kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_TILE_CHANNEL_STACK },
            renderer: { lane: 'native', rendererKind: CHALKBOARD_TILE_CHANNEL_STACK },
            source: { kind: 'card-center' },
            binding: { kind: 'channels', channelId: null },
            lineage: {
                parentCardInstanceId: chatCardId,
                relationship: 'channels-stack',
                detachBehavior: 'keep-lineage',
            },
            createdAt: now,
            lifecycle: 'active',
        },
    };
    const nodes = {
        ...doc.nodes,
        [chatNodeId]: { id: chatNodeId, kind: 'card', cardInstanceId: chatCardId },
        [stackNodeId]: { id: stackNodeId, kind: 'card', cardInstanceId: stackCardId },
        [chatSlotId]: {
            id: chatSlotId,
            kind: 'slot',
            children: [chatNodeId],
            activeChildId: chatNodeId,
            titlebarMode: 'hidden',
        },
        [stackSlotId]: {
            id: stackSlotId,
            kind: 'slot',
            children: [stackNodeId],
            activeChildId: stackNodeId,
            titlebarMode: 'compact',
        },
        [rootNodeId]: {
            id: rootNodeId,
            kind: 'row',
            children: [chatSlotId, stackSlotId],
            sizing: [
                { kind: 'fill' },
                {
                    kind: 'fixed',
                    px: CHALKBOARD_CHANNELS_STACK_DEFAULT_PX,
                    minPx: CHALKBOARD_CHANNELS_STACK_MIN_PX,
                },
            ],
        },
    };
    const surfaces = {
        ...doc.surfaces,
        [surfaceId]: {
            id: surfaceId,
            kind: 'page',
            role: 'persistent',
            rootNodeId,
            pageId,
            capabilities: pageCapabilities,
        },
    };
    return { ...doc, surfaces, nodes, cards };
}
/** Code uses the home composition with its own card and node identities. */
export function ensureCodePageTemplate(doc, now = 0) {
    const pageId = CHALKBOARD_CODE_PAGE_ID;
    const surfaceId = chalkboardLayoutPageSurfaceId(pageId);
    if (doc.surfaces[surfaceId])
        return doc;
    const home = createDefaultChalkboardLayoutDocument(now);
    const idMap = {
        [CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID]: CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID,
        [CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID]: CHALKBOARD_LAYOUT_CODE_WORKSPACE_CARD_ID,
    };
    const nodeId = (id) => `node:page:${pageId}:${id.slice('node:home-'.length)}`;
    const cards = { ...doc.cards };
    for (const card of Object.values(home.cards)) {
        const id = idMap[card.id];
        cards[id] = {
            ...card,
            id,
            ...(card.lineage ? { lineage: { ...card.lineage, parentCardInstanceId: CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID } } : {}),
        };
    }
    const nodes = { ...doc.nodes };
    for (const node of Object.values(home.nodes)) {
        const id = nodeId(node.id);
        nodes[id] = node.kind === 'card'
            ? { ...node, id, cardInstanceId: idMap[node.cardInstanceId] }
            : node.kind === 'slot'
                ? { ...node, id, children: node.children.map(nodeId), activeChildId: node.activeChildId ? nodeId(node.activeChildId) : null }
                : node.kind === 'row' || node.kind === 'column'
                    ? { ...node, id, children: node.children.map(nodeId) }
                    : { ...node, id };
    }
    // 改动卡与工作区同列、叠在工作区上方：工作区槽位从根行搬进一列，列里上为改动、下为工作区。
    const changesCardId = CHALKBOARD_LAYOUT_CODE_CHANGES_CARD_ID;
    cards[changesCardId] = {
        id: changesCardId,
        definitionId: CHALKBOARD_CODE_CHANGES_RENDERER_KIND,
        kernelSource: { kind: 'builtin', builtinId: CHALKBOARD_CODE_CHANGES_RENDERER_KIND },
        renderer: { lane: 'native', rendererKind: CHALKBOARD_CODE_CHANGES_RENDERER_KIND },
        source: { kind: 'card-center' },
        createdAt: now,
        lifecycle: 'active',
    };
    const changesCardNodeId = `node:page:${pageId}:changes-card`;
    const changesSlotNodeId = `node:page:${pageId}:changes-slot`;
    const workspaceColumnNodeId = `node:page:${pageId}:workspace-column`;
    const rootNodeId = nodeId(CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID);
    const workspaceSlotNodeId = nodeId(CHALKBOARD_LAYOUT_HOME_WORKSPACE_SLOT_ID);
    nodes[changesCardNodeId] = { id: changesCardNodeId, kind: 'card', cardInstanceId: changesCardId };
    nodes[changesSlotNodeId] = {
        id: changesSlotNodeId,
        kind: 'slot',
        children: [changesCardNodeId],
        activeChildId: changesCardNodeId,
        titlebarMode: 'compact',
    };
    nodes[workspaceColumnNodeId] = {
        id: workspaceColumnNodeId,
        kind: 'column',
        children: [changesSlotNodeId, workspaceSlotNodeId],
        sizing: [{ kind: 'elastic', weight: 1 }, { kind: 'elastic', weight: 1 }],
    };
    const rootNode = nodes[rootNodeId];
    if (rootNode?.kind !== 'row')
        throw new Error('ensureCodePageTemplate: home root must be a row');
    nodes[rootNodeId] = {
        ...rootNode,
        children: rootNode.children.map((childId) => (childId === workspaceSlotNodeId ? workspaceColumnNodeId : childId)),
    };
    return {
        ...doc,
        cards,
        nodes,
        surfaces: {
            ...doc.surfaces,
            [surfaceId]: {
                id: surfaceId,
                kind: 'page',
                role: 'persistent',
                rootNodeId: nodeId(CHALKBOARD_LAYOUT_HOME_ROOT_NODE_ID),
                pageId,
                capabilities: { ...pageCapabilities },
            },
        },
    };
}
//# sourceMappingURL=layout-document-factory.js.map