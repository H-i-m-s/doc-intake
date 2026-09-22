/**
 * app-contract/sdk-error.ts — generated from shared/app-contract/sdk-error.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { readAppRpcErrorMetadata } from "./rpc-error.js";
/** Stable SDK metadata around a host failure. The original code is preserved. */
export class AppSdkError extends Error {
    name = "AppSdkError";
    code;
    operation;
    kind;
    capability;
    appId;
    details;
    fields;
    constructor(error, options) {
        super(error.message, options);
        this.code = error.code;
        this.operation = error.operation;
        this.kind = error.kind ?? "host";
        this.capability = error.capability;
        this.appId = error.appId;
        this.details = error.details;
        this.fields = error.fields;
    }
}
function record(value) {
    return value !== null && typeof value === "object" ? value : null;
}
/** Classify stable host codes, never infer authorization from message wording. */
function kindFor(code, name) {
    if (name === "AbortError" || code === "RPC_ABORTED" || code === "BUS_REQUEST_ABORTED")
        return "aborted";
    if (code === "RPC_TIMEOUT" || code === "APP_RUNTIME_IPC_TIMEOUT")
        return "timeout";
    if (code === "APP_CAPABILITY_DENIED" || code === "CAPABILITY_DENIED")
        return "permission";
    if (code === "APP_SDK_HOST_UNSUPPORTED")
        return "unsupported";
    return "host";
}
export function toAppSdkError(error, operation) {
    if (error instanceof AppSdkError)
        return error;
    const source = record(error);
    const code = typeof source?.code === "string" ? source.code : "APP_HOST_ERROR";
    const metadata = readAppRpcErrorMetadata(source);
    return new AppSdkError({
        code,
        message: error instanceof Error ? error.message : String(error),
        operation: metadata.operation ?? operation,
        kind: kindFor(code, source?.name),
        ...metadata,
        ...(typeof source?.appId === "string" ? { appId: source.appId } : {}),
        ...(source?.details !== undefined ? { details: source.details } : {}),
    }, { cause: error });
}
//# sourceMappingURL=sdk-error.js.map