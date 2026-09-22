/**
 * preview/app-view-contract.ts — generated from shared/preview/app-view-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Public, App-neutral request/response shapes for one mounted document view. */
export type AppViewRequest = {
    requestId: string;
    documentId: string;
    viewId: string;
    revision: number;
    method: string;
    payload?: unknown;
};
export type AppViewImage = {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    data: string;
};
export type AppViewResult = {
    revision: number;
    data?: unknown;
    images?: AppViewImage[];
};
//# sourceMappingURL=app-view-contract.d.ts.map