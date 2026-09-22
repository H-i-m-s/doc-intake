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
export type AppMediaCapability = "app/media.generate" | "app/media.provide" | "app/media.tasks.manage" | "app/media.tasks.read-all" | "app/media.tasks.manage-all" | "app/provider.models.manage";
/** Gates the four `media:*` verbs and `provider:media-providers`. */
export declare const APP_MEDIA_GENERATE_CAPABILITY: AppMediaCapability;
/** Gates ctx.media adapter / capability-source registration. */
export declare const APP_MEDIA_PROVIDE_CAPABILITY: AppMediaCapability;
export declare const APP_MEDIA_TASKS_MANAGE_CAPABILITY: AppMediaCapability;
export declare const APP_MEDIA_TASKS_READ_ALL_CAPABILITY: AppMediaCapability;
export declare const APP_MEDIA_TASKS_MANAGE_ALL_CAPABILITY: AppMediaCapability;
export declare const APP_PROVIDER_MODELS_MANAGE_CAPABILITY: AppMediaCapability;
export declare const APP_MEDIA_GENERATE_BUS_VERBS: readonly ["media:generate", "media:generate-image", "media:generate-video", "media:transcribe-audio"];
export declare const APP_MEDIA_PROVIDERS_BUS_VERB = "provider:media-providers";
export declare const APP_MEDIA_BUS_VERBS: readonly ["media:generate", "media:generate-image", "media:generate-video", "media:transcribe-audio", "provider:media-providers"];
export declare const APP_MEDIA_CAPABILITY_WORDS: readonly AppMediaCapability[];
export declare function isAppMediaBusVerb(type: unknown): type is string;
export declare function isAppMediaGenerateBusVerb(type: unknown): type is string;
export type AppMediaProvideLedger = {
    query(subject: {
        domain: string;
        id: string;
    }, capability: string): {
        decision?: string;
    } | null;
};
/**
 * The host-side grant check for media adapter registration. Named here so the in-process
 * face and the isolated-process RPC path throw the same sentence.
 */
export declare function assertAppMediaProvideGranted(pluginId: string, ledger: AppMediaProvideLedger | null | undefined): void;
//# sourceMappingURL=app-media-capabilities.d.ts.map