/**
 * app-contract/registration.ts — generated from shared/app-contract/registration.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * A v2 App registration remains a callable disposer for existing `ctx` code,
 * while exposing the host acknowledgement and an explicitly awaitable release.
 *
 * `ready` only covers the individual registration. It does not mean the App
 * has completed loading or that every later contribution has been published.
 */
import type { V2AppResourceWatchHandle } from "./context.js";
export interface AppRegistration {
    (): void;
    readonly ready: Promise<void>;
    disposeAsync(): Promise<void>;
}
/** A resource watch keeps its existing object API and adds registration receipts. */
export type AppResourceWatchRegistration = V2AppResourceWatchHandle & Pick<AppRegistration, "ready" | "disposeAsync">;
//# sourceMappingURL=registration.d.ts.map