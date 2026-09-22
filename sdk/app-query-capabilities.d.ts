/**
 * app-query-capabilities.ts — generated from shared/app-query-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Standing grants for App reads that expose host-wide accounting, credentials, or model directory data. */
export declare const APP_USAGE_READ_CAPABILITY = "app/usage.read";
export declare const APP_PROVIDER_CREDENTIALS_READ_CAPABILITY = "app/provider.credentials.read";
export declare const APP_MODELS_READ_CAPABILITY = "app/models.read";
export declare const APP_QUERY_CAPABILITY_WORDS: readonly ["app/usage.read", "app/provider.credentials.read", "app/models.read"];
export type AppQueryCapability = (typeof APP_QUERY_CAPABILITY_WORDS)[number];
/** Existing host query verbs available to Apps after their corresponding grant. */
export declare const APP_QUERY_BUS_VERBS: readonly ["usage:list", "provider:credentials", "provider:models-by-type", "provider:resolve-media-model"];
export type AppQueryBusVerb = (typeof APP_QUERY_BUS_VERBS)[number];
export declare function isAppQueryBusVerb(value: unknown): value is AppQueryBusVerb;
export declare function appQueryCapabilityForBusVerb(verb: AppQueryBusVerb): AppQueryCapability;
//# sourceMappingURL=app-query-capabilities.d.ts.map