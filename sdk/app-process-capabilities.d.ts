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
export type AppProcessCapability = "app/process.spawn";
/** Gates whether an app's isolated process is started with `--allow-child-process`. */
export declare const APP_PROCESS_SPAWN_CAPABILITY: AppProcessCapability;
export declare const APP_PROCESS_CAPABILITY_WORDS: readonly AppProcessCapability[];
export type AppProcessSpawnLedger = {
    query(subject: {
        domain: string;
        id: string;
    }, capability: string): {
        decision?: string;
    } | null;
};
/**
 * Has `pluginId` been granted `app/process.spawn`? A missing ledger, a
 * throwing query, or any decision other than `"allowed"` reads as not
 * granted. Explicit builtin trust may cover an absent first-boot record.
 */
export declare function isAppProcessSpawnGranted(pluginId: string, ledger: AppProcessSpawnLedger | null | undefined, trustedCapabilities?: readonly string[]): boolean;
//# sourceMappingURL=app-process-capabilities.d.ts.map