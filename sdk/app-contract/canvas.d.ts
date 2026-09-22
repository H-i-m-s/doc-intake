import type { ChalkboardChildSizing } from '../chalkboard-layout/layout-document.js';
export interface CanvasPage {
    readonly id: string;
    readonly title: string;
    readonly shape: string;
}
export type CanvasNode = {
    readonly id: string;
    readonly kind: 'row' | 'column';
    readonly children: readonly string[];
    readonly sizing: readonly ChalkboardChildSizing[];
} | {
    readonly id: string;
    readonly kind: 'slot';
    readonly children: readonly string[];
    readonly activeChildId: string | null;
    readonly titlebarMode: 'hidden' | 'compact' | 'tabs';
} | {
    readonly id: string;
    readonly kind: 'card';
    readonly cardId: string;
};
export interface CanvasSurface {
    readonly id: string;
    readonly pageId: string | null;
    readonly rootNodeId: string;
    readonly detached: boolean;
}
export interface CanvasCard {
    readonly id: string;
    readonly definitionId: string;
    readonly title: string;
    readonly pageId: string;
    readonly detached: boolean;
    readonly state: Readonly<Record<string, unknown>> | null;
}
export interface CanvasCardSizeIntent {
    readonly width: number;
    readonly height: number;
}
export interface CanvasLayoutSnapshot {
    readonly revision: number;
    readonly pages: readonly CanvasPage[];
    readonly activePageId: string | null;
    readonly nodes: Readonly<Record<string, CanvasNode>>;
    readonly surfaces: Readonly<Record<string, CanvasSurface>>;
    readonly cards: Readonly<Record<string, CanvasCard>>;
    readonly cardSizeIntents: Readonly<Record<string, CanvasCardSizeIntent>>;
}
export interface CreateCanvasPageOptions {
    readonly id?: string;
    readonly title?: string;
    readonly shape?: string;
}
export interface InsertCanvasCardOptions {
    readonly id?: string;
    readonly definitionId: string;
    readonly title?: string;
    readonly pageId: string;
    readonly state?: Record<string, unknown> | null;
}
export interface MoveCanvasCardOptions {
    readonly id: string;
    readonly pageId: string;
    readonly beforeCardId?: string;
}
export interface ResizeCanvasCardOptions {
    readonly id: string;
    readonly width: number;
    readonly height: number;
}
export interface CanvasLayout {
    getSnapshot(): CanvasLayoutSnapshot;
    subscribe(listener: () => void): () => void;
    createPage(options?: CreateCanvasPageOptions): string;
    selectPage(id: string): void;
    renamePage(id: string, title: string): void;
    reorderPages(pageIds: readonly string[]): void;
    removePage(id: string): void;
    insertCard(options: InsertCanvasCardOptions): string;
    closeCard(id: string): void;
    moveCard(options: MoveCanvasCardOptions): void;
    detachCard(id: string): void;
    attachCard(options: {
        readonly id: string;
        readonly pageId: string;
    }): void;
    resizeCard(options: ResizeCanvasCardOptions): void;
    setCardState(id: string, state: Record<string, unknown> | null): void;
    renameCard(id: string, title: string): void;
}
/**
 * Creates an App-owned layout state machine. It only manages the local layout
 * document; opening a native window or running a card remains the App's job.
 */
export declare function createCanvasLayout(): CanvasLayout;
//# sourceMappingURL=canvas.d.ts.map