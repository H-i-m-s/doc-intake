/**
 * app-view-recovery.ts — the private App-side controller for view-state recovery.
 *
 * An App card can run in more than one host/view, and a business callback may
 * start under one document/namespace and call back after the surface has moved
 * to another. A global "current view" setter cannot express that: by the time
 * `set` runs, "current" is already the other view. So `enable()` returns a
 * *registration handle* that captured the document, the host-provided namespace
 * and the registration id at the moment it was enabled, and every later
 * `get`/`set`/`release` speaks only for that captured target — never for
 * whatever is current when the call happens to run.
 *
 * The handle is deliberately not authority. The host still owns whether the
 * document may act (the shared current-view token) and which namespace a write
 * belongs to (the binding id); this module only keeps the two from drifting, by
 * re-checking both before sending and again after a reply arrives, and by
 * matching the reply's echoed target against what it captured. A reply that
 * names any other target is refused as stale, because a new document or a new
 * SDK can reuse a request id and message-id correlation alone cannot tell a
 * current reply from a late one for an older view.
 *
 * This module is private: nothing here is exported from the package root, and
 * the SDK reaches it only through its own side table. Exposing a recovery entry
 * to App authors is a separate, explicit act that also needs the host producer
 * to exist, so no author-facing member is added here.
 */
import { type AppViewStateKind, type PluginSurfaceContext } from './_ui-protocol.js';
import { type AppViewStateJson } from './_ui-app-view-state.js';
import { type AppCurrentViewBinding } from './_ui-app-current-view.js';
export type { AppViewStateKind } from './_ui-protocol.js';
/** The public snapshot shape a handle returns; it never carries wire identity. */
export interface HanaViewStateSnapshot {
    readonly viewKind: AppViewStateKind;
    readonly revision: number;
    readonly state: {
        [key: string]: AppViewStateJson;
    } | null;
}
/** A registration bound to the document/namespace that was current when enabled. */
export interface HanaViewStateRegistration {
    readonly initial: HanaViewStateSnapshot;
    readonly signal: AbortSignal;
    get(options?: {
        timeoutMs?: number;
    }): Promise<HanaViewStateSnapshot>;
    set(input: {
        expectedRevision: number;
        state: {
            [key: string]: AppViewStateJson;
        } | null;
    }, options?: {
        timeoutMs?: number;
    }): Promise<HanaViewStateSnapshot>;
    release(options?: {
        timeoutMs?: number;
    }): Promise<{
        released: boolean;
    }>;
}
export interface HanaViewStateApi {
    enable(options?: {
        timeoutMs?: number;
    }): Promise<HanaViewStateRegistration>;
}
/** Local codes this controller raises. Shared JSON failures keep their own F1 codes. */
export declare const APP_VIEW_STATE_ERROR_CODE: {
    readonly UNAVAILABLE: "VIEW_STATE_UNAVAILABLE";
    readonly VIEW_STALE: "VIEW_STATE_VIEW_STALE";
    readonly RELEASED: "VIEW_STATE_RELEASED";
    readonly INVALID_INPUT: "VIEW_STATE_INVALID_INPUT";
    readonly BAD_RESPONSE: "VIEW_STATE_BAD_RESPONSE";
};
export type AppViewStateLocalErrorCode = (typeof APP_VIEW_STATE_ERROR_CODE)[keyof typeof APP_VIEW_STATE_ERROR_CODE];
/** A coded local failure. A host's own `HanaPluginError` is passed through untouched. */
export declare class AppViewStateRequestError extends Error {
    readonly code: AppViewStateLocalErrorCode;
    constructor(code: AppViewStateLocalErrorCode, message: string);
}
export interface AppViewRecoveryDeps {
    /** The SDK's one request transport; this controller never opens its own channel. */
    request: (type: string, payload?: unknown, options?: {
        timeoutMs?: number;
    }) => Promise<unknown>;
    /** The SDK's shared document binding. Borrowed, never owned by this controller. */
    currentView: AppCurrentViewBinding;
    /** The surface context the SDK currently holds. */
    getContext(): PluginSurfaceContext | null;
    /** Subscribe to surface context changes; returns an idempotent unsubscribe. */
    subscribeContext(callback: (context: PluginSurfaceContext | null) => void): () => void;
    requestTimeoutMs?: number;
}
export interface AppViewRecovery {
    api: HanaViewStateApi;
    dispose(): void;
}
export declare function createAppViewRecovery(deps: AppViewRecoveryDeps): AppViewRecovery;
