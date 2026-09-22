/**
 * app-contract/session-search.ts — generated from shared/app-contract/session-search.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Narrow, path-free session search contract exposed through `ctx.bus.request`. */
export declare const APP_SESSIONS_SEARCH_CAPABILITY = "app/sessions.search";
export interface AppSessionSearchRequestV2 {
    readonly query: string;
    readonly phase?: "title" | "content";
    readonly scope?: "own" | "all";
    readonly agentId?: string;
    readonly limit?: number;
}
export interface AppSessionSearchResultEntryV2 {
    readonly sessionId: string;
    readonly title: string;
    readonly agentId: string | null;
    readonly agentName: string | null;
    readonly modified: string | number | null;
    readonly matchKind: "title" | "content";
    readonly snippet: string;
}
export interface AppSessionSearchResultV2 {
    readonly query: string;
    readonly phase: "title" | "content";
    readonly results: readonly AppSessionSearchResultEntryV2[];
}
/** Typed convenience wrapper for the App bus's narrow session search verb. */
export declare function searchAppSessions(bus: {
    request(type: string, payload?: unknown, options?: unknown): Promise<unknown>;
}, input: AppSessionSearchRequestV2, options?: {
    readonly timeout?: number;
    readonly signal?: AbortSignal;
}): Promise<AppSessionSearchResultV2>;
//# sourceMappingURL=session-search.d.ts.map