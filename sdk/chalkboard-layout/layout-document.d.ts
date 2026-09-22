/**
 * chalkboard-layout/layout-document.ts — generated from shared/chalkboard-layout/layout-document.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { ChalkboardCardContentBinding, ChalkboardCardCreationSource, ChalkboardDetachedBounds } from './chalkboard-card-types.js';
import type { CardDiagnostics, CardRendererDeclaration, CardSource } from '../card-kernel.js';
export type ChalkboardSurfaceId = string;
export type ChalkboardLayoutNodeId = string;
export type ChalkboardCardInstanceId = string;
export type ChalkboardBuiltinSurfaceKind = 'home' | 'page' | 'detached' | 'fullscreen';
export type ChalkboardSurfaceKind = ChalkboardBuiltinSurfaceKind | (string & {});
export type ChalkboardDetachedPinMode = 'normal' | 'always-on-top';
export type ChalkboardBuiltinLayoutNodeKind = 'row' | 'column' | 'slot' | 'card';
export type ChalkboardExtensionLayoutNodeKind = `extension:${string}`;
export type ChalkboardLayoutNodeKind = ChalkboardBuiltinLayoutNodeKind | ChalkboardExtensionLayoutNodeKind;
export interface ChalkboardSurfaceCapabilities {
    acceptsCards: boolean;
    acceptsFunctionPanelContributions: boolean;
    acceptsDragDrop: boolean;
    persistsLayout: boolean;
    canDetachCards: boolean;
    canClose: boolean;
    locked?: boolean;
}
export type ChalkboardLayoutFocus = {
    kind: 'surface';
    surfaceId: ChalkboardSurfaceId;
} | {
    kind: 'card';
    surfaceId: ChalkboardSurfaceId;
    cardInstanceId: ChalkboardCardInstanceId;
};
export interface ChalkboardLayoutDocument {
    version: 1;
    activeSurfaceId: ChalkboardSurfaceId;
    activePageId: string;
    surfaces: Record<ChalkboardSurfaceId, ChalkboardLayoutSurface>;
    nodes: Record<ChalkboardLayoutNodeId, ChalkboardLayoutNode>;
    cards: Record<ChalkboardCardInstanceId, ChalkboardCardInstance>;
    cardSizeIntents?: Record<ChalkboardCardInstanceId, ChalkboardCardSizeIntent>;
    focus: ChalkboardLayoutFocus;
}
export interface ChalkboardCardSizeIntent {
    widthPx?: number;
}
export interface ChalkboardLayoutSurface {
    id: ChalkboardSurfaceId;
    kind: ChalkboardSurfaceKind;
    role: 'persistent' | 'floating' | 'modal' | 'transient';
    rootNodeId: ChalkboardLayoutNodeId;
    pageId?: string;
    detachedWindowId?: string;
    bounds?: ChalkboardDetachedBounds;
    pinMode?: ChalkboardDetachedPinMode;
    returnSurfaceId?: ChalkboardSurfaceId;
    fullscreenOwner?: ChalkboardCardInstanceId;
    capabilities: ChalkboardSurfaceCapabilities;
}
export interface ChalkboardRowNode {
    id: ChalkboardLayoutNodeId;
    kind: 'row';
    children: ChalkboardLayoutNodeId[];
    sizing: ChalkboardChildSizing[];
}
export interface ChalkboardColumnNode {
    id: ChalkboardLayoutNodeId;
    kind: 'column';
    children: ChalkboardLayoutNodeId[];
    sizing: ChalkboardChildSizing[];
}
export interface ChalkboardSlotNode {
    id: ChalkboardLayoutNodeId;
    kind: 'slot';
    children: ChalkboardLayoutNodeId[];
    activeChildId: ChalkboardLayoutNodeId | null;
    titlebarMode: 'hidden' | 'compact' | 'tabs';
    grouping?: ChalkboardSlotGrouping;
}
export type ChalkboardSlotGrouping = {
    kind: 'tabs';
} | {
    kind: 'collection';
    label?: string;
};
export interface ChalkboardCardNode {
    id: ChalkboardLayoutNodeId;
    kind: 'card';
    cardInstanceId: ChalkboardCardInstanceId;
}
export interface ChalkboardExtensionNode {
    id: ChalkboardLayoutNodeId;
    kind: ChalkboardExtensionLayoutNodeKind;
    owner: string;
    rendererKind: string;
    props?: Record<string, unknown>;
}
export type ChalkboardLayoutNode = ChalkboardRowNode | ChalkboardColumnNode | ChalkboardSlotNode | ChalkboardCardNode | ChalkboardExtensionNode;
export type ChalkboardChildSizing = {
    kind: 'fixed';
    px: number;
    minPx?: number;
    maxPx?: number;
} | {
    kind: 'elastic';
    weight: number;
    minPx?: number;
    maxPx?: number;
} | {
    kind: 'fill';
    minPx?: number;
    maxPx?: number;
};
export type ChalkboardCardChromeSlot = 'titlebar-left' | 'titlebar-right' | 'footer-left' | 'footer-right';
export interface ChalkboardCardChromeContribution {
    id: string;
    slot: ChalkboardCardChromeSlot;
    rendererKind: string;
    icon?: string;
    label?: string;
    order?: number;
    visibleWhen?: ChalkboardChromeVisibilityRule;
}
export type ChalkboardChromeVisibilityRule = {
    kind: 'always';
} | {
    kind: 'when-owner-active';
} | {
    kind: 'when-owner-focused';
} | {
    kind: 'when-card-hovered';
};
export type ChalkboardChromeOwner = {
    kind: 'card-instance';
    cardInstanceId: ChalkboardCardInstanceId;
};
export interface ChalkboardCardLineage {
    /** Lifecycle/navigation relationship only. Layout placement treats every card instance as a peer. */
    parentCardInstanceId: ChalkboardCardInstanceId;
    relationship: string;
    detachBehavior: 'keep-lineage' | 'clear-lineage';
}
export interface ChalkboardCardInstance {
    id: ChalkboardCardInstanceId;
    definitionId: string;
    /** Durable Card Kernel source identity. Legacy source below remains UI creation provenance. */
    kernelSource?: CardSource;
    renderer?: CardRendererDeclaration;
    diagnostics?: CardDiagnostics;
    title?: string | null;
    binding?: ChalkboardCardContentBinding | null;
    rendererState?: Record<string, unknown>;
    source: ChalkboardCardCreationSource;
    lineage?: ChalkboardCardLineage;
    createdAt: number;
    lifecycle: 'active' | 'closing';
}
export type ChalkboardPlacementMode = {
    kind: 'default';
} | {
    kind: 'edge';
    edge: 'left' | 'right' | 'top' | 'bottom';
    referenceNodeId?: string;
} | {
    kind: 'slot';
    slotNodeId: ChalkboardLayoutNodeId;
} | {
    kind: 'replace-empty';
};
export type ChalkboardPlacementTarget = {
    kind: 'surface';
    surfaceId: ChalkboardSurfaceId;
    placement: ChalkboardPlacementMode;
} | {
    kind: 'active-page';
    placement: ChalkboardPlacementMode;
} | {
    kind: 'home';
    placement: ChalkboardPlacementMode;
} | {
    kind: 'detached';
    bounds?: ChalkboardDetachedBounds;
};
export interface ChalkboardCardPlacementRequest {
    instanceId?: ChalkboardCardInstanceId;
    definitionId: string;
    source: ChalkboardCardCreationSource;
    kernelSource?: CardSource;
    renderer?: CardRendererDeclaration;
    diagnostics?: CardDiagnostics;
    binding?: ChalkboardCardContentBinding | null | 'auto';
    rendererState?: Record<string, unknown>;
    title?: string | null;
    target?: ChalkboardPlacementTarget | 'auto';
}
export type ChalkboardLayoutTarget = {
    kind: 'surface-root';
    surfaceId: ChalkboardSurfaceId;
    placement: ChalkboardPlacementMode;
} | {
    kind: 'slot';
    slotNodeId: ChalkboardLayoutNodeId;
    index?: number;
} | {
    kind: 'edge';
    referenceNodeId: ChalkboardLayoutNodeId;
    edge: 'left' | 'right' | 'top' | 'bottom';
} | {
    kind: 'detached';
    bounds?: ChalkboardDetachedBounds;
};
export type ChalkboardLayoutTransitionReason = 'drop-reorder' | 'drop-move' | 'drop-create' | 'drag-cancel' | 'panel-toggle' | 'panel-close' | 'live-resize' | 'window-resize' | 'detached-window' | 'page-change' | 'scope-restore' | 'departure-resettle' | 'programmatic';
export interface ChalkboardLayoutCommandMetadata {
    reason?: ChalkboardLayoutTransitionReason;
}
export type ChalkboardLayoutCommandBody = {
    kind: 'ensurePageTemplate';
    definitionId: string;
} | {
    kind: 'insertCard';
    request: ChalkboardCardPlacementRequest;
} | {
    kind: 'updateCardRendererState';
    cardInstanceId: string;
    rendererState: Record<string, unknown> | null;
} | {
    kind: 'activateSlotChild';
    slotNodeId: string;
    childNodeId: string;
} | {
    kind: 'moveCard';
    cardInstanceId: string;
    target: ChalkboardLayoutTarget;
} | {
    kind: 'moveCardIntoSlot';
    cardInstanceId: string;
    slotNodeId: string;
    index?: number;
} | {
    kind: 'extractCardFromSlot';
    cardInstanceId: string;
    target: ChalkboardLayoutTarget;
} | {
    kind: 'setCardLineage';
    cardInstanceId: string;
    lineage: ChalkboardCardLineage | null;
} | {
    kind: 'closeCard';
    cardInstanceId: string;
} | {
    kind: 'removePage';
    pageId: string;
} | {
    kind: 'renamePage';
    pageId: string;
    title: string;
} | {
    kind: 'setPageShape';
    pageId: string;
    shape: string;
} | {
    kind: 'resizeContainer';
    nodeId: string;
    sizing: ChalkboardChildSizing[];
} | {
    kind: 'reorderContainerChild';
    nodeId: string;
    childNodeId: string;
    toIndex: number;
} | {
    kind: 'detachCard';
    cardInstanceId: string;
    bounds?: ChalkboardDetachedBounds;
} | {
    kind: 'updateSurfaceBounds';
    surfaceId: string;
    bounds: ChalkboardDetachedBounds;
} | {
    kind: 'setDetachedSurfacePinMode';
    surfaceId: string;
    pinMode: ChalkboardDetachedPinMode;
} | {
    kind: 'dockCard';
    cardInstanceId: string;
    target: ChalkboardLayoutTarget;
} | {
    kind: 'setFocus';
    target: ChalkboardLayoutFocus;
};
export type ChalkboardLayoutCommand = ChalkboardLayoutCommandBody & ChalkboardLayoutCommandMetadata;
//# sourceMappingURL=layout-document.d.ts.map