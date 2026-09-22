/**
 * app-contract/rpc-error.ts — generated from shared/app-contract/rpc-error.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** JSON-safe error metadata that may cross an App IPC boundary. */
export type AppRpcValidationField = {
    readonly field?: string;
    readonly key?: string;
    readonly code: string;
    readonly message: string;
};
export type AppRpcErrorMetadata = {
    readonly capability?: string;
    readonly operation?: string;
    readonly fields?: readonly AppRpcValidationField[];
};
export type AppRpcBulkCleanupDetails = {
    readonly removedTaskIds: readonly string[];
    readonly failedTaskId: string;
};
/** Read only declared App error metadata, never an arbitrary Error object. */
export declare function readAppRpcErrorMetadata(value: unknown): AppRpcErrorMetadata;
/** Restore the approved metadata onto the local Error for SDK adapters. */
export declare function restoreAppRpcErrorMetadata(error: Error, value: unknown): void;
export declare function isAppRpcBulkCleanupDetails(value: unknown): value is AppRpcBulkCleanupDetails;
//# sourceMappingURL=rpc-error.d.ts.map