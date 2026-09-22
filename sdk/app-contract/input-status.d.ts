/**
 * app-contract/input-status.ts — generated from shared/app-contract/input-status.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export interface HanaPluginInputStatusSetRequestV2 {
    /** Stable identity of the session whose declared contribution is being updated. */
    readonly sessionId: string;
    readonly id: string;
    readonly text?: string;
    readonly tooltip?: string;
    readonly visible?: boolean;
    readonly disabled?: boolean;
}
export interface HanaPluginInputStatusRemoveRequestV2 {
    readonly sessionId: string;
    readonly id: string;
}
export interface HanaPluginInputStatusV2 {
    readonly set: (request: HanaPluginInputStatusSetRequestV2) => Promise<void>;
    readonly remove: (request: HanaPluginInputStatusRemoveRequestV2) => Promise<void>;
}
export declare const HANA_PLUGIN_INPUT_STATUS_V2_MEMBERS: readonly ["remove", "set"];
//# sourceMappingURL=input-status.d.ts.map