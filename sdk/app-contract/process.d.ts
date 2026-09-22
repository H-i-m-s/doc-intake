/**
 * app-contract/process.ts — generated from shared/app-contract/process.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Host metadata for an external command; its bytes stay outside AppHost. */
export interface AppExecutableInfoV2 {
    readonly path: string;
    readonly mtimeMs: number;
    readonly size: number;
}
export interface AppExecutableRequestV2 {
    /** Ordered command names or absolute paths. No shell expansion is performed. */
    readonly candidates: readonly string[];
}
/** Requires app/process.spawn. Does not grant direct filesystem access. */
export interface AppProcessV2 {
    resolveExecutable(input: AppExecutableRequestV2): Promise<AppExecutableInfoV2 | null>;
}
//# sourceMappingURL=process.d.ts.map