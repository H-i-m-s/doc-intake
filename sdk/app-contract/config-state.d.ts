/**
 * app-contract/config-state.ts — generated from shared/app-contract/config-state.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * The complete persisted configuration state an App owns. Each top-level
 * bucket is isolated to one App's contributed settings group; agent and
 * session keys are stable host identities, never filesystem paths.
 */
export interface AppConfigStateV2 {
    readonly global: Record<string, unknown>;
    readonly agents: Record<string, Record<string, unknown>>;
    readonly sessions: Record<string, Record<string, unknown>>;
}
/** Request a wire-safe projection with sensitive values masked. */
export interface AppConfigStateOptionsV2 {
    readonly redacted?: boolean;
}
/** Copy this App's per-session configuration from one stable session id to another. */
export interface AppConfigForkSessionInputV2 {
    readonly sourceSessionId: string;
    readonly targetSessionId: string;
}
/** Remove this App's per-session configuration for one stable session id. */
export interface AppConfigDiscardSessionInputV2 {
    readonly sessionId: string;
}
//# sourceMappingURL=config-state.d.ts.map