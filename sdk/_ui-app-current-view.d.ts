/**
 * app-current-view.ts — the SDK's single owner of "which document is this App
 * card view right now".
 *
 * The host proves a document's identity with its own three messages — a
 * `BINDING` carries the host-minted view token, a `CHALLENGE` asks the document
 * to answer with its own per-document nonce, and `ACK` is that answer. One SDK
 * instance holds exactly one such binding, and the Chrome surface consumes it:
 * Chrome reads the token it must echo from here and never mints a second nonce
 * or confuses "wait for the host's binding" with a generic handshake.
 *
 * It deliberately knows nothing about Chrome's own concerns: no scroll source,
 * no action handlers, no Chrome error codes. Its one failure type names only
 * what the binding itself can observe — unavailable / identity-changed /
 * token-stale — and each consumer maps that onto its own public error.
 *
 * Wire names and the nonce/token algorithms are the Chrome protocol the host
 * already speaks; this module owns only the state behind them.
 */
import { type PluginUiMessage } from './_ui-protocol.js';
/** What a binding waiter or assertion can fail for. Never a Chrome-specific code. */
export type AppCurrentViewErrorReason = 'unavailable' | 'identity-changed' | 'token-stale';
/**
 * The shared binding's own failure. Carries no view token or identity text, so
 * a consumer can surface a coded public error without leaking view credentials.
 */
export declare class AppCurrentViewBindingError extends Error {
    readonly reason: AppCurrentViewErrorReason;
    constructor(reason: AppCurrentViewErrorReason, message: string);
}
/** The part of the host surface context the current-view identity depends on. */
export interface AppCurrentViewIdentity {
    readonly appId: string;
    readonly cardInstanceId: string | null;
    readonly instanceKey?: string | null;
}
/** Emitted after a binding settles: either the token changed, the host asked to resync, or both. */
export interface AppCurrentViewBindingEvent {
    /** The view token differs from the one held before this binding. */
    readonly changed: boolean;
    /** The host explicitly re-bound the same document and wants state re-sent. */
    readonly resync: boolean;
}
export interface AppCurrentViewBinding {
    /**
     * Claim the two host handshake messages (`BINDING` / `CHALLENGE`). Always
     * claims those two types — including while disposed or when the payload is
     * unusable — so a handshake can never fall through to a second handler. Every
     * other type (notably `ACTION`) returns false.
     */
    handleHostMessage(message: PluginUiMessage): boolean;
    /**
     * The host pushed this surface's business identity, or cleared it (null). A
     * confirmed switch to a different identity voids the previous identity's
     * queued writers and token; a temporary unavailability keeps the last
     * confirmed identity and only pauses the held token.
     */
    applySurfaceContext(context: AppCurrentViewIdentity | null): void;
    /** The writable view token, or null when the binding is released / paused / tokenless. */
    currentToken(): string | null;
    /**
     * Resolve with the current token, or wait for the identity's own binding.
     * `signal` cancels only this waiter; every outcome clears its timer and abort
     * listener. An already-aborted signal resolves to no request.
     */
    waitForToken(timeoutMs: number, signal?: AbortSignal): Promise<string>;
    /**
     * The fence for "the wait resolved, but the `then` has not run yet": reject
     * when released / paused / tokenless, or when `token` is no longer current.
     * No automatic retry — the caller never sends a stale write across this gap.
     */
    assertCurrentToken(token: string): void;
    /** Subscribe to binding transitions. Unsubscribe is idempotent by listener identity. */
    onBinding(listener: (event: AppCurrentViewBindingEvent) => void): () => void;
    /** Terminate every waiter and listener; no further host message is acted on. Idempotent. */
    dispose(): void;
}
export interface AppCurrentViewDeps {
    targetWindow: Window;
    post: (message: PluginUiMessage) => void;
    /** Re-announce the App's `hana.ready` after a challenge, so a rebound bridge re-runs the handshake. */
    reannounceReady?: () => void;
}
export declare function createAppCurrentViewBinding(deps: AppCurrentViewDeps): AppCurrentViewBinding;
