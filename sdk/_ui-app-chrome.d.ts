/**
 * app-chrome.ts — the App side of the current-view Chrome protocol.
 *
 * Three deliberately separate verbs, matching the host's own three:
 *   · `set(description)` replaces the description and returns the accepted
 *     revision (or rejects with a coded error).
 *   · `onAction(handler)` answers a host-driven chrome action. The handler only
 *     says handled/rejected; the SDK stamps the host's identity onto the reply,
 *     so the App echoes requestId / revision / generation / viewToken and never
 *     chooses them.
 *   · `registerScrollSource(element)` watches the App's own main scroll element
 *     and reports a boolean. It is not a description update: a scroll signal
 *     never clears or replaces chrome state.
 *
 * A write is only ever sent once the host has bound this document (an opaque
 * host-minted view token pushed with `APP_CHROME.BINDING`). That document
 * identity — the nonce, the token, the confirmed business identity and every
 * queued writer — is owned by the SDK's shared current-view binding
 * (`app-current-view.ts`), which Chrome consumes. Chrome reads the token it
 * must echo live from that binding, never from a value it captured itself.
 */
import { type PluginUiMessage } from './_ui-protocol.js';
import type { AppChromeDescriptionV2 } from './app-contract/chrome.js';
import { type AppCurrentViewBinding } from './_ui-app-current-view.js';
export type { AppChromeActionV2, AppChromeActivityV2, AppChromeDescriptionV2, AppChromeIconId, AppChromeTabV2, } from './app-contract/chrome.js';
/** What the host is asking the App to answer. Identity fields are the host's. */
export interface HanaChromeActionIdentity {
    readonly requestId: string;
    readonly revision: number;
}
/**
 * One host-driven chrome action, discriminated by `kind` so the payload each
 * kind carries is not optional: an `action` always names an `actionId`, a
 * `tab-select` / `tab-close` always names a `tabId`. `kind` is the only field
 * callers have to narrow on.
 *
 * The tab kinds are requests, not notifications: the host has already moved its
 * own selection, and the receipt says whether the App agrees. An App that wants
 * a different selection submits a new description through `set` — a receipt
 * never moves the host's state on its own.
 */
export type HanaChromeActionEvent = (HanaChromeActionIdentity & {
    readonly kind: 'action';
    readonly actionId: string;
}) | (HanaChromeActionIdentity & {
    readonly kind: 'tab-select';
    readonly tabId: string;
}) | (HanaChromeActionIdentity & {
    readonly kind: 'tab-close';
    readonly tabId: string;
});
/** The App's own words about one action. The SDK supplies the echoed identity. */
export type HanaChromeActionReceipt = {
    readonly status: 'handled';
    readonly message?: string;
} | {
    readonly status: 'rejected';
    readonly message?: string;
};
export interface HanaChromeApi {
    /**
     * Submit a full Chrome description. Resolves to the accepted revision. The
     * description is the host's own contract shape (`shared/app-contract/chrome.ts`,
     * re-exported here by type), and each accepted revision must strictly
     * increase within one view. The optional `activity` field (`'running'`,
     * `'unread'` or `null`) asks the host to show a status dot on this card's
     * page button; omit it or pass `null` to clear the dot.
     */
    set(description: AppChromeDescriptionV2, options?: {
        timeoutMs?: number;
    }): Promise<{
        ok: true;
        revision: number;
    }>;
    /**
     * Handle a host chrome action. Returns an unsubscribe function. With no
     * handler registered the host receives an explicit error naming the request.
     */
    onAction(handler: (event: HanaChromeActionEvent) => HanaChromeActionReceipt | void | Promise<HanaChromeActionReceipt | void>): () => void;
    /**
     * Watch `element` as this card's main scroll element. Returns a cleanup token;
     * an older token is inert after a newer registration, so A→B→A never lets the
     * first cleanup clear the third registration.
     */
    registerScrollSource(element: HTMLElement): () => void;
}
export interface AppChromeDeps {
    request: (type: string, payload?: unknown, options?: {
        timeoutMs?: number;
    }) => Promise<unknown>;
    post: (message: PluginUiMessage) => void;
    targetWindow: Window;
    /**
     * The SDK's shared document binding. Chrome reads its token live and is a
     * consumer only: it never disposes the binding, and the binding outlives any
     * single Chrome surface.
     */
    currentView: AppCurrentViewBinding;
    requestTimeoutMs?: number;
}
/**
 * Build the App-side chrome API over the SDK's shared transport and shared
 * current-view binding. `handleHostMessage` is called by the SDK's host-message
 * dispatch after the binding has had first refusal; it only ever claims ACTION.
 */
export declare function createAppChromeApi(deps: AppChromeDeps): {
    api: HanaChromeApi;
    handleHostMessage: (message: PluginUiMessage) => boolean;
    dispose: () => void;
};
