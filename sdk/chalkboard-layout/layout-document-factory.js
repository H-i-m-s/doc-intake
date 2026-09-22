/**
 * chalkboard-layout/layout-document-factory.ts — generated from shared/chalkboard-layout/layout-document-factory.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { CHALKBOARD_CHANNELS_PAGE_ID, CHALKBOARD_CHANNELS_STACK_DEFAULT_PX, CHALKBOARD_CHANNELS_STACK_MIN_PX, CHALKBOARD_CHAT_MIN_PX, CHALKBOARD_CHAT_PAGE_ID, CHALKBOARD_HOME_CHAT_TILE_ID, CHALKBOARD_TILE_CHANNEL_CHAT, CHALKBOARD_TILE_CHANNEL_STACK, CHALKBOARD_TILE_WORKSPACE_DESK, CHALKBOARD_WORKSPACE_MIN_PX, } from './chalkboard-builtin-ids.js';
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
export function ensureChalkboardPageTemplate(doc, spec, now = 0) {
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
//# sourceMappingURL=layout-document-factory.js.map