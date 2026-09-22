/**
 * app-media-capabilities.ts — generated from shared/app-media-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-media-capabilities.ts — the ledger words that let a v2 app
 * ask the host to generate media, or register itself as a media provider.
 *
 * `app/media.generate` gates the four `media:*` verbs and
 * `provider:media-providers`. The read-only provider directory also accepts
 * `app/models.read` independently of generation permission.
 *
 * `app/media.provide` gates adapter registration in `ctx.media` and a
 * runtime capability source. Apps do not call the host's
 * `media-gen:register-adapter` verbs themselves; the host holds a proxy.
 *
 * Default is deny. Absence of an `"allowed"` record — no ledger, no
 * record, or an explicit `"denied"` one — all read as not authorized.
 *
 * Why this lives in `shared/`: the request door
 * (`server/composition/plugin-context-v2.ts`), the HTTP grant whitelist
 * (`APP_GRANTABLE_CAPABILITIES`), and the desktop settings panel all have
 * to name the same words.
 */
/** Gates the four `media:*` verbs and `provider:media-providers`. */
export const APP_MEDIA_GENERATE_CAPABILITY = "app/media.generate";
/** Gates ctx.media adapter / capability-source registration. */
export const APP_MEDIA_PROVIDE_CAPABILITY = "app/media.provide";
export const APP_MEDIA_TASKS_MANAGE_CAPABILITY = "app/media.tasks.manage";
export const APP_MEDIA_TASKS_READ_ALL_CAPABILITY = "app/media.tasks.read-all";
export const APP_MEDIA_TASKS_MANAGE_ALL_CAPABILITY = "app/media.tasks.manage-all";
export const APP_PROVIDER_MODELS_MANAGE_CAPABILITY = "app/provider.models.manage";
export const APP_MEDIA_GENERATE_BUS_VERBS = Object.freeze([
    "media:generate",
    "media:generate-image",
    "media:generate-video",
    "media:transcribe-audio",
]);
export const APP_MEDIA_PROVIDERS_BUS_VERB = "provider:media-providers";
export const APP_MEDIA_BUS_VERBS = Object.freeze([
    ...APP_MEDIA_GENERATE_BUS_VERBS,
    APP_MEDIA_PROVIDERS_BUS_VERB,
]);
export const APP_MEDIA_CAPABILITY_WORDS = Object.freeze([
    APP_MEDIA_GENERATE_CAPABILITY,
    APP_MEDIA_PROVIDE_CAPABILITY,
    APP_MEDIA_TASKS_MANAGE_CAPABILITY,
    APP_MEDIA_TASKS_READ_ALL_CAPABILITY,
    APP_MEDIA_TASKS_MANAGE_ALL_CAPABILITY,
    APP_PROVIDER_MODELS_MANAGE_CAPABILITY,
]);
const APP_MEDIA_BUS_VERB_SET = new Set(APP_MEDIA_BUS_VERBS);
const APP_MEDIA_GENERATE_BUS_VERB_SET = new Set(APP_MEDIA_GENERATE_BUS_VERBS);
export function isAppMediaBusVerb(type) {
    return typeof type === "string" && APP_MEDIA_BUS_VERB_SET.has(type);
}
export function isAppMediaGenerateBusVerb(type) {
    return typeof type === "string" && APP_MEDIA_GENERATE_BUS_VERB_SET.has(type);
}
/**
 * The host-side grant check for media adapter registration. Named here so the in-process
 * face and the isolated-process RPC path throw the same sentence.
 */
export function assertAppMediaProvideGranted(pluginId, ledger) {
    let record = null;
    if (ledger) {
        try {
            record = ledger.query({ domain: "app", id: pluginId }, APP_MEDIA_PROVIDE_CAPABILITY);
        }
        catch {
            record = null;
        }
    }
    if (record?.decision !== "allowed") {
        throw new Error(`app "${pluginId}" is not authorized to provide media adapters — the user has not granted the `
            + `"${APP_MEDIA_PROVIDE_CAPABILITY}" permission (Settings → Apps → App capabilities)`);
    }
}
//# sourceMappingURL=app-media-capabilities.js.map