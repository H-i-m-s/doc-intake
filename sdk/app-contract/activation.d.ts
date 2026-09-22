/**
 * app-contract/activation.ts — generated from shared/app-contract/activation.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Opt-in lazy execution for a v2 App. Static tool declarations stay available. */
export type AppActivationModeV2 = "on-demand";
export interface AppActivationToolV2 {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
    readonly sessionPermission?: Record<string, unknown>;
    /** Opt in to host-minted document access for this static tool declaration. */
    readonly documentAccess?: "read" | "write";
    /** Associate the static tool with a Preview provider belonging to this App. */
    readonly view?: {
        readonly providerId: string;
    };
}
export interface AppManifestActivationV2 {
    readonly mode: AppActivationModeV2;
    readonly tools: readonly AppActivationToolV2[];
    /** No automatic idle shutdown when omitted or zero. */
    readonly idleTimeoutMs?: number;
}
//# sourceMappingURL=activation.d.ts.map