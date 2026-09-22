/**
 * app-capability-introspection.ts — generated from shared/app-capability-introspection.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * The word list and status projection a v2 app reads through
 * app:capabilities. v1 published declared strings on ctx; this generation
 * reports what the permission ledger actually remembers for this app.
 *
 * Two enforcement classes
 * -----------------------
 * Hook words are advisory: no grant means the app's adjudicator is skipped,
 * the turn continues. Session-control words, first-use words, and
 * tools.expose-to-model are hard: no grant refuses the action.
 */
import { APP_GRANTABLE_CAPABILITIES } from "./app-grantable-capabilities.js";
import { APP_HOOK_CAPABILITY_WORDS } from "./app-hook-capabilities.js";
export const APP_SESSION_POST_MESSAGE_CAPABILITY = "app/session.post-message";
export const APP_SESSION_READ_SELECTION_CAPABILITY = "app/session.read-selection";
export const APP_FIRST_USE_CAPABILITY_WORDS = Object.freeze([
    APP_SESSION_POST_MESSAGE_CAPABILITY,
    APP_SESSION_READ_SELECTION_CAPABILITY,
]);
/**
 * Grantable HTTP words plus the two first-use words the ledger already
 * holds. Resource words ride on the grantable set.
 */
export const APP_INTROSPECTABLE_CAPABILITIES = Object.freeze([
    ...APP_GRANTABLE_CAPABILITIES,
    ...APP_FIRST_USE_CAPABILITY_WORDS,
]);
const ADVISORY_CAPABILITIES = new Set(APP_HOOK_CAPABILITY_WORDS);
export function appCapabilityEnforcement(capability) {
    return ADVISORY_CAPABILITIES.has(capability) ? "advisory" : "hard";
}
export function projectAppCapabilityStatus(record) {
    if (!record)
        return "not_asked";
    if (record.decision === "denied")
        return "denied";
    if (record.decision === "allowed" && record.tier === "session")
        return "session";
    if (record.decision === "allowed" && record.tier === "always")
        return "always";
    return "not_asked";
}
//# sourceMappingURL=app-capability-introspection.js.map