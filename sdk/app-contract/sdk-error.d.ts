/**
 * app-contract/sdk-error.ts — generated from shared/app-contract/sdk-error.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { type AppRpcValidationField } from "./rpc-error.js";
export type AppSdkErrorKind = "permission" | "context" | "unavailable" | "unsupported" | "timeout" | "aborted" | "invalid" | "conflict" | "host";
export interface AppSdkErrorDetails {
    readonly code: string;
    readonly message: string;
    readonly operation: string;
    readonly kind?: AppSdkErrorKind;
    readonly capability?: string;
    readonly appId?: string;
    readonly details?: unknown;
    readonly fields?: readonly AppRpcValidationField[];
}
/** Stable SDK metadata around a host failure. The original code is preserved. */
export declare class AppSdkError extends Error {
    readonly name = "AppSdkError";
    readonly code: string;
    readonly operation: string;
    readonly kind: AppSdkErrorKind;
    readonly capability?: string;
    readonly appId?: string;
    readonly details?: unknown;
    readonly fields?: readonly AppRpcValidationField[];
    constructor(error: AppSdkErrorDetails, options?: ErrorOptions);
}
export declare function toAppSdkError(error: unknown, operation: string): AppSdkError;
//# sourceMappingURL=sdk-error.d.ts.map