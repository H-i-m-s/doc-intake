/**
 * app-process-capabilities.ts — generated from shared/app-process-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-process-capabilities.ts — the ledger word that lets a v2 app's
 * own isolated Node process be started with child-process access.
 *
 * Every v2 app process starts under Node's Permission Model with
 * `--allow-child-process` withheld (`server/app-host/permission-flags.ts`):
 * a bare `child_process.spawn`/`execFile`/`fork` throws `ERR_ACCESS_DENIED`.
 * An app whose own business genuinely needs to run an external command
 * (unlike `app/render.pdf`, which hands HTML to the *host*'s own Chromium
 * instead of asking the app to spawn one) can be granted this word instead.
 *
 * This is a spawn-time gate, not a per-call door: `AppProcessManager`
 * (`server/app-host/app-process-manager.ts`) consults the ledger once, right
 * before it spawns the app's child process, and bakes the answer into that
 * process's argv. A grant or revoke therefore only takes effect the next
 * time the app process (re)starts — the flag cannot change underneath an
 * already-running child, because Node's Permission Model is fixed at
 * process start.
 *
 * User Apps default to deny. Builtin manifest trust may cover an absent
 * first-boot record, but never overrides an explicit decision or a ledger
 * read failure.
 *
 * Why this lives in `shared/`: the HTTP grant whitelist
 * (`APP_GRANTABLE_CAPABILITIES`) and the desktop settings panel both have to
 * name the same word `AppProcessManager` queries.
 */
/** Gates whether an app's isolated process is started with `--allow-child-process`. */
export const APP_PROCESS_SPAWN_CAPABILITY = "app/process.spawn";
export const APP_PROCESS_CAPABILITY_WORDS = Object.freeze([
    APP_PROCESS_SPAWN_CAPABILITY,
]);
/**
 * Has `pluginId` been granted `app/process.spawn`? A missing ledger, a
 * throwing query, or any decision other than `"allowed"` reads as not
 * granted. Explicit builtin trust may cover an absent first-boot record.
 */
export function isAppProcessSpawnGranted(pluginId, ledger, trustedCapabilities = []) {
    try {
        const record = ledger?.query({ domain: "app", id: pluginId }, APP_PROCESS_SPAWN_CAPABILITY);
        // Builtin trust covers first boot only; it must never override a decision.
        return record ? record.decision === "allowed" : trustedCapabilities.includes(APP_PROCESS_SPAWN_CAPABILITY);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=app-process-capabilities.js.map