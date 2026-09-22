/**
 * chalkboard-layout/layout-errors.ts — generated from shared/chalkboard-layout/layout-errors.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export type ChalkboardLayoutErrorCode = 'NODE_NOT_FOUND' | 'PARSE_ERROR' | 'INVALID_STRUCTURE' | 'SAME_NODE';
export declare class ChalkboardLayoutError extends Error {
    readonly code: ChalkboardLayoutErrorCode;
    constructor(code: ChalkboardLayoutErrorCode, message: string);
}
//# sourceMappingURL=layout-errors.d.ts.map