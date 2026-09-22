/**
 * app-contract/session-search.ts — generated from shared/app-contract/session-search.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Narrow, path-free session search contract exposed through `ctx.bus.request`. */
export const APP_SESSIONS_SEARCH_CAPABILITY = "app/sessions.search";
/** Typed convenience wrapper for the App bus's narrow session search verb. */
export async function searchAppSessions(bus, input, options) {
    return await bus.request("session:search", input, options);
}
//# sourceMappingURL=session-search.js.map