/**
 * app-contract/canvas.ts — generated from shared/app-contract/canvas.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { applyChalkboardLayoutCommand, findCardNodeId, findParentNodeId, updateCardTitle, } from '../chalkboard-layout/layout-document-reducer.js';
import { ensureChalkboardPageTemplate } from '../chalkboard-layout/layout-document-factory.js';
const MIN_CARD_SIZE_PX = 32;
const MAX_CARD_SIZE_PX = 8192;
function emptyDocument() {
    return {
        version: 1,
        activeSurfaceId: '',
        activePageId: '',
        surfaces: {},
        nodes: {},
        cards: {},
        focus: { kind: 'surface', surfaceId: '' },
    };
}
function pageSurfaceId(pageId) {
    return `surface:page:${pageId}`;
}
function requireNonEmptyId(value, subject) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`CanvasLayout ${subject} must be a non-empty string.`);
    return value.trim();
}
function titleOrFallback(value, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'string')
        throw new Error('CanvasLayout title must be a string.');
    return value.trim() || fallback;
}
function createId(prefix, taken) {
    const exists = (id) => taken instanceof Map ? taken.has(id) : id in taken;
    let id;
    do {
        id = `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    } while (exists(id));
    return id;
}
function cloneState(state) {
    if (state === undefined || state === null)
        return null;
    try {
        return structuredClone(state);
    }
    catch {
        throw new Error('CanvasLayout card state must be structured-cloneable.');
    }
}
function clampSize(value) {
    if (!Number.isFinite(value))
        throw new Error('CanvasLayout card size must be a finite number.');
    return Math.max(MIN_CARD_SIZE_PX, Math.min(MAX_CARD_SIZE_PX, Math.round(value)));
}
function sizingWithFixedValue(sizing, index, px) {
    return sizing.map((item, itemIndex) => itemIndex === index ? { kind: 'fixed', px } : item);
}
function publicNode(node) {
    if (node.kind === 'row' || node.kind === 'column') {
        return { id: node.id, kind: node.kind, children: [...node.children], sizing: node.sizing.map((item) => ({ ...item })) };
    }
    if (node.kind === 'slot') {
        return {
            id: node.id,
            kind: 'slot',
            children: [...node.children],
            activeChildId: node.activeChildId,
            titlebarMode: node.titlebarMode,
        };
    }
    if (node.kind === 'card')
        return { id: node.id, kind: 'card', cardId: node.cardInstanceId };
    return null;
}
function publicSurface(surface) {
    return {
        id: surface.id,
        pageId: surface.pageId ?? null,
        rootNodeId: surface.rootNodeId,
        detached: surface.kind === 'detached',
    };
}
function freezeSnapshot(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value))
        return value;
    seen.add(value);
    for (const child of Object.values(value))
        freezeSnapshot(child, seen);
    return Object.freeze(value);
}
/**
 * Creates an App-owned layout state machine. It only manages the local layout
 * document; opening a native window or running a card remains the App's job.
 */
export function createCanvasLayout() {
    let document = emptyDocument();
    let pages = [];
    let activePageId = null;
    const cards = new Map();
    const cardSizeIntents = new Map();
    const listeners = new Set();
    let revision = 0;
    let publishedSnapshot = null;
    const requirePage = (id) => {
        const pageId = requireNonEmptyId(id, 'page id');
        if (!pages.some((page) => page.id === pageId))
            throw new Error(`CanvasLayout page does not exist: ${pageId}`);
        return pageId;
    };
    const requireCard = (id) => {
        const cardId = requireNonEmptyId(id, 'card id');
        const card = cards.get(cardId);
        if (!card || !document.cards[cardId])
            throw new Error(`CanvasLayout card does not exist: ${cardId}`);
        return [cardId, card];
    };
    const snapshot = () => {
        const nodes = {};
        for (const [id, node] of Object.entries(document.nodes)) {
            const projected = publicNode(node);
            if (projected)
                nodes[id] = projected;
        }
        const surfaces = Object.fromEntries(Object.entries(document.surfaces).map(([id, surface]) => [id, publicSurface(surface)]));
        const publicCards = {};
        for (const [id, meta] of cards) {
            const card = document.cards[id];
            if (!card)
                continue;
            publicCards[id] = {
                id,
                definitionId: meta.definitionId,
                title: meta.title,
                pageId: meta.pageId,
                detached: meta.detached,
                state: cloneState(card.rendererState),
            };
        }
        return freezeSnapshot({
            revision,
            pages: pages.map((page) => ({ ...page })),
            activePageId,
            nodes,
            surfaces,
            cards: publicCards,
            cardSizeIntents: Object.fromEntries(Array.from(cardSizeIntents, ([id, size]) => [id, { ...size }])),
        });
    };
    const publish = () => {
        revision += 1;
        publishedSnapshot = snapshot();
        for (const listener of listeners)
            listener();
    };
    const select = (pageId) => {
        activePageId = pageId;
        document = {
            ...document,
            activePageId: pageId,
            activeSurfaceId: pageSurfaceId(pageId),
            focus: { kind: 'surface', surfaceId: pageSurfaceId(pageId) },
        };
    };
    return {
        getSnapshot() {
            return publishedSnapshot ?? (publishedSnapshot = snapshot());
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        createPage(options = {}) {
            const id = options.id === undefined ? createId('page', new Map(pages.map((page) => [page.id, true]))) : requireNonEmptyId(options.id, 'page id');
            if (pages.some((page) => page.id === id))
                throw new Error(`CanvasLayout page already exists: ${id}`);
            const page = {
                id,
                title: titleOrFallback(options.title, 'Untitled'),
                shape: titleOrFallback(options.shape, 'page'),
            };
            pages = [...pages, page];
            document = ensureChalkboardPageTemplate(document, { kind: 'empty-page', pageId: id, title: page.title, shape: page.shape });
            select(id);
            publish();
            return id;
        },
        selectPage(id) {
            select(requirePage(id));
            publish();
        },
        renamePage(id, title) {
            const pageId = requirePage(id);
            const nextTitle = titleOrFallback(title, 'Untitled');
            pages = pages.map((page) => page.id === pageId ? { ...page, title: nextTitle } : page);
            publish();
        },
        reorderPages(pageIds) {
            if (pageIds.length !== pages.length || new Set(pageIds).size !== pages.length || pageIds.some((id) => !pages.some((page) => page.id === id))) {
                throw new Error('CanvasLayout page order must list every page exactly once.');
            }
            pages = pageIds.map((id) => pages.find((page) => page.id === id));
            publish();
        },
        removePage(id) {
            const pageId = requirePage(id);
            for (const [cardId, card] of Array.from(cards)) {
                if (card.pageId !== pageId)
                    continue;
                document = applyChalkboardLayoutCommand(document, { kind: 'closeCard', cardInstanceId: cardId });
                cards.delete(cardId);
                cardSizeIntents.delete(cardId);
            }
            document = applyChalkboardLayoutCommand(document, { kind: 'removePage', pageId });
            pages = pages.filter((page) => page.id !== pageId);
            if (activePageId === pageId) {
                if (pages[0])
                    select(pages[0].id);
                else {
                    activePageId = null;
                    document = { ...document, activePageId: '', activeSurfaceId: '', focus: { kind: 'surface', surfaceId: '' } };
                }
            }
            publish();
        },
        insertCard(options) {
            const pageId = requirePage(options.pageId);
            const definitionId = requireNonEmptyId(options.definitionId, 'card definitionId');
            const id = options.id === undefined ? createId('card', cards) : requireNonEmptyId(options.id, 'card id');
            if (cards.has(id) || document.cards[id])
                throw new Error(`CanvasLayout card already exists: ${id}`);
            const title = titleOrFallback(options.title, definitionId);
            const state = cloneState(options.state);
            document = applyChalkboardLayoutCommand(document, {
                kind: 'insertCard',
                request: {
                    instanceId: id,
                    definitionId,
                    title,
                    source: { kind: 'card-center' },
                    rendererState: state ?? {},
                    target: { kind: 'surface', surfaceId: pageSurfaceId(pageId), placement: { kind: 'default' } },
                },
            });
            cards.set(id, { definitionId, title, pageId, detached: false });
            activePageId = pageId;
            publish();
            return id;
        },
        closeCard(id) {
            const [cardId] = requireCard(id);
            document = applyChalkboardLayoutCommand(document, { kind: 'closeCard', cardInstanceId: cardId });
            cards.delete(cardId);
            cardSizeIntents.delete(cardId);
            publish();
        },
        moveCard(options) {
            const [cardId, card] = requireCard(options.id);
            const pageId = requirePage(options.pageId);
            let target;
            if (options.beforeCardId !== undefined) {
                const [beforeCardId, beforeCard] = requireCard(options.beforeCardId);
                if (beforeCardId === cardId)
                    throw new Error(`CanvasLayout card cannot move before itself: ${cardId}`);
                if (beforeCard.detached || beforeCard.pageId !== pageId)
                    throw new Error(`CanvasLayout target card is not on page: ${beforeCardId}`);
                const surface = document.surfaces[pageSurfaceId(pageId)];
                const root = surface && document.nodes[surface.rootNodeId];
                const beforeNodeId = findCardNodeId(document, beforeCardId);
                const index = root?.kind === 'slot' ? root.children.indexOf(beforeNodeId) : -1;
                target = index >= 0 && root?.kind === 'slot'
                    ? { kind: 'moveCard', cardInstanceId: cardId, target: { kind: 'slot', slotNodeId: root.id, index } }
                    : { kind: 'moveCard', cardInstanceId: cardId, target: { kind: 'surface-root', surfaceId: pageSurfaceId(pageId), placement: { kind: 'default' } } };
            }
            else {
                target = { kind: 'moveCard', cardInstanceId: cardId, target: { kind: 'surface-root', surfaceId: pageSurfaceId(pageId), placement: { kind: 'default' } } };
            }
            document = applyChalkboardLayoutCommand(document, target);
            cards.set(cardId, { ...card, pageId, detached: false });
            activePageId = pageId;
            publish();
        },
        detachCard(id) {
            const [cardId, card] = requireCard(id);
            if (card.detached)
                throw new Error(`CanvasLayout card is already detached: ${cardId}`);
            document = applyChalkboardLayoutCommand(document, { kind: 'detachCard', cardInstanceId: cardId });
            cards.set(cardId, { ...card, detached: true });
            publish();
        },
        attachCard(options) {
            const [cardId, card] = requireCard(options.id);
            const pageId = requirePage(options.pageId);
            if (!card.detached)
                throw new Error(`CanvasLayout card is not detached: ${cardId}`);
            document = applyChalkboardLayoutCommand(document, {
                kind: 'dockCard',
                cardInstanceId: cardId,
                target: { kind: 'surface-root', surfaceId: pageSurfaceId(pageId), placement: { kind: 'default' } },
            });
            cards.set(cardId, { ...card, pageId, detached: false });
            activePageId = pageId;
            publish();
        },
        resizeCard(options) {
            const [cardId] = requireCard(options.id);
            const width = clampSize(options.width);
            const height = clampSize(options.height);
            const cardNodeId = findCardNodeId(document, cardId);
            let childNodeId = cardNodeId;
            let parentId = findParentNodeId(document.nodes, childNodeId);
            while (parentId && document.nodes[parentId]?.kind === 'slot') {
                childNodeId = parentId;
                parentId = findParentNodeId(document.nodes, childNodeId);
            }
            const parent = parentId ? document.nodes[parentId] : null;
            if (parent?.kind === 'row' || parent?.kind === 'column') {
                const childIndex = parent.children.indexOf(childNodeId);
                document = applyChalkboardLayoutCommand(document, {
                    kind: 'resizeContainer',
                    nodeId: parent.id,
                    sizing: sizingWithFixedValue(parent.sizing, childIndex, parent.kind === 'row' ? width : height),
                });
            }
            else {
                document = {
                    ...document,
                    cardSizeIntents: {
                        ...(document.cardSizeIntents ?? {}),
                        [cardId]: { ...(document.cardSizeIntents?.[cardId] ?? {}), widthPx: width },
                    },
                };
            }
            cardSizeIntents.set(cardId, { width, height });
            publish();
        },
        setCardState(id, state) {
            const [cardId] = requireCard(id);
            document = applyChalkboardLayoutCommand(document, {
                kind: 'updateCardRendererState',
                cardInstanceId: cardId,
                rendererState: cloneState(state),
            });
            publish();
        },
        renameCard(id, title) {
            const [cardId, card] = requireCard(id);
            const nextTitle = titleOrFallback(title, card.definitionId);
            document = updateCardTitle(document, cardId, nextTitle);
            cards.set(cardId, { ...card, title: nextTitle });
            publish();
        },
    };
}
//# sourceMappingURL=canvas.js.map