/**
 * app-session-file-capabilities.ts — generated from shared/app-session-file-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-session-file-capabilities.ts — the ledger word that lets a v2
 * app deliver an authorized file into a session or register its existing location.
 *
 * Staging a produced file is a different intervention from changing how a
 * session runs (`shared/app-session-control-capabilities.ts`) or starting a
 * turn: it writes durable bytes into the conversation. The word still uses
 * the `app/session.*` domain so the HTTP grant whitelist and the settings
 * panel consume one family of session-shaped capabilities.
 *
 * Default is deny. Absence of an `"allowed"` record — no ledger, no record,
 * or an explicit `"denied"` one — all read as not authorized. An unauthorized
 * attempt is a refused write that names the missing capability and the
 * settings page that can grant it.
 *
 * Why this lives in `shared/`: the verb door
 * (`server/composition/plugin-context-v2.ts`), the HTTP grant whitelist
 * (`APP_GRANTABLE_CAPABILITIES`), and the desktop settings panel all have
 * to name the same word.
 */
/** Gates App resource staging and registration; source read and target ownership are checked separately. */
export const APP_SESSION_STAGE_FILE_CAPABILITY = "app/session.stage-file";
export const APP_SESSION_FILE_CAPABILITY_WORDS = Object.freeze([
    APP_SESSION_STAGE_FILE_CAPABILITY,
]);
//# sourceMappingURL=app-session-file-capabilities.js.map