/**
 * annotations.ts — generated from shared/annotations.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export declare const ANNOTATION_SCHEMA_VERSION: 1;
/**
 * Workspace-backed resources are the first durable annotation target. The
 * explicit mount identity is intentional: callers must never substitute the
 * active cwd, focused card, or a renderer-local file path.
 */
export interface WorkspaceAnnotationResourceRef {
    kind: 'mount';
    mountId: string;
    path: string;
}
/** Canonical Resource identity used when a file has no Workspace mount. */
export interface CanonicalAnnotationResourceRef {
    kind: 'resource';
    resourceId: string;
}
export type WorkspaceAnnotationTargetRef = WorkspaceAnnotationResourceRef | CanonicalAnnotationResourceRef;
export declare const PERSONAL_ANNOTATION_WORKSPACE_ID: "personal";
export interface WorkspaceAnnotationScope {
    workspaceId: string;
    target: WorkspaceAnnotationTargetRef;
    sourceRevision?: string;
}
export type AnnotationActorKind = 'user' | 'agent';
export interface AnnotationActorSnapshot {
    id: string;
    kind: AnnotationActorKind;
    displayName: string;
    avatarUrl?: string | null;
}
export interface AnnotationComment {
    id: string;
    body: string;
    actor: AnnotationActorSnapshot;
    createdAt: string;
    updatedAt?: string | null;
    canEdit?: boolean;
}
export interface AnnotationPermissions {
    canReply: boolean;
    canClose: boolean;
    canReopen: boolean;
}
/**
 * Selectors are adapter-owned JSON. Markdown currently supplies W3C-style
 * text position + quote selectors; image and DOM adapters can add their own
 * selector contracts without changing thread persistence.
 */
export interface AnnotationThread<TSelector = unknown> {
    id: string;
    revision: string;
    selectorKind: string;
    selector: TSelector;
    state: 'open' | 'closed';
    comments: readonly AnnotationComment[];
    permissions: AnnotationPermissions;
    sourceRevision?: string | null;
}
export type AnnotationChangeAction = 'created' | 'comment-edited' | 'replied' | 'closed' | 'reopened' | 'resource-renamed' | 'resource-deleted';
export interface AnnotationChangeEvent {
    schemaVersion: typeof ANNOTATION_SCHEMA_VERSION;
    studioId: string;
    workspaceId: string;
    target: WorkspaceAnnotationTargetRef;
    /** Present for rename notifications so open consumers can rebind atomically. */
    previousTarget?: WorkspaceAnnotationTargetRef | null;
    action: AnnotationChangeAction;
    threadId?: string | null;
}
//# sourceMappingURL=annotations.d.ts.map