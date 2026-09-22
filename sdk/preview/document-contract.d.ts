/**
 * preview/document-contract.ts — generated from shared/preview/document-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Public, non-secret document binding vocabulary.  The access context itself
 * is opaque: only the host mints and resolves it.
 */
import type { V2AppResourceVersion } from "../app-contract/context.js";
export type DocumentAccess = "read" | "write";
export type PreviewDocumentContext = {
    readonly documentId: string;
    readonly viewId: string;
    readonly providerId: string;
    readonly appId: string;
    readonly capabilities: readonly DocumentAccess[];
    readonly resource: unknown;
    readonly version: V2AppResourceVersion | null;
    readonly generation: number;
};
export type PreviewDocumentStatus = {
    readonly revision: number;
    readonly dirty: boolean;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly recoveryKey?: string | null;
    readonly error?: {
        readonly code: string;
        readonly message: string;
    } | null;
};
/** A host-minted capability handle. Apps must receive it from route/tool context. */
export type V2AppDocumentAccessContext = {
    readonly bindingId: string;
};
export type PreviewDocumentWriteResult = {
    readonly conflict?: false;
    readonly version: V2AppResourceVersion;
    readonly revision?: number;
} | {
    readonly ok: false;
    readonly conflict: true;
    readonly version?: V2AppResourceVersion;
};
//# sourceMappingURL=document-contract.d.ts.map