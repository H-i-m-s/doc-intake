/**
 * app-contract/runtime.ts — generated from shared/app-contract/runtime.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * The public contract for an App-owned external runtime.
 *
 * The host validates the executable, requested profile and permissions before
 * launch. Scoped execution constrains reads; explicit native execution permits
 * user-readable files while retaining platform write constraints. Apps never
 * receive a host process handle or arbitrary inherited host environment.
 */
/** Required before an App may start any managed external runtime. */
export const APP_RUNTIME_CAPABILITY = "app/runtime.execute";
/** Required in addition to execute for an explicit external network request. */
export const APP_RUNTIME_NETWORK_CAPABILITY = "app/runtime.network";
/** Explicit native execution: user-readable files, native code and externally connected programs. */
export const APP_RUNTIME_NATIVE_CAPABILITY = "app/runtime.native";
/** Explicit user-authorized local-machine execution without filesystem isolation. */
export const APP_RUNTIME_LOCAL_MACHINE_CAPABILITY = "app/runtime.local-machine";
export const APP_RUNTIME_CAPABILITY_WORDS = Object.freeze([
    APP_RUNTIME_CAPABILITY,
    APP_RUNTIME_NETWORK_CAPABILITY,
    APP_RUNTIME_NATIVE_CAPABILITY,
    APP_RUNTIME_LOCAL_MACHINE_CAPABILITY,
]);
//# sourceMappingURL=runtime.js.map