/**
 * app-contract/model-stream.ts — generated from shared/app-contract/model-stream.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppModelStreamEventV2 } from "./models.js";
export interface AppModelStreamOptions {
    readonly signal?: AbortSignal;
    /** Maximum characters buffered without a complete event, default 8 MiB. */
    readonly maxEventCharacters?: number;
}
/** Decode a model stream and release its reader on completion, error or break. */
export declare function readAppModelStream(response: Response, options?: AppModelStreamOptions): AsyncGenerator<AppModelStreamEventV2>;
//# sourceMappingURL=model-stream.d.ts.map