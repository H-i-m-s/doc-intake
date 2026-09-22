/**
 * app-query-capabilities.ts — generated from shared/app-query-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Standing grants for App reads that expose host-wide accounting, credentials, or model directory data. */
export const APP_USAGE_READ_CAPABILITY = "app/usage.read";
export const APP_PROVIDER_CREDENTIALS_READ_CAPABILITY = "app/provider.credentials.read";
export const APP_MODELS_READ_CAPABILITY = "app/models.read";
export const APP_QUERY_CAPABILITY_WORDS = Object.freeze([
    APP_USAGE_READ_CAPABILITY,
    APP_PROVIDER_CREDENTIALS_READ_CAPABILITY,
    APP_MODELS_READ_CAPABILITY,
]);
/** Existing host query verbs available to Apps after their corresponding grant. */
export const APP_QUERY_BUS_VERBS = Object.freeze([
    "usage:list",
    "provider:credentials",
    "provider:models-by-type",
    "provider:resolve-media-model",
]);
const CAPABILITY_BY_BUS_VERB = Object.freeze({
    "usage:list": APP_USAGE_READ_CAPABILITY,
    "provider:credentials": APP_PROVIDER_CREDENTIALS_READ_CAPABILITY,
    "provider:models-by-type": APP_MODELS_READ_CAPABILITY,
    "provider:resolve-media-model": APP_MODELS_READ_CAPABILITY,
});
export function isAppQueryBusVerb(value) {
    return typeof value === "string" && Object.hasOwn(CAPABILITY_BY_BUS_VERB, value);
}
export function appQueryCapabilityForBusVerb(verb) {
    return CAPABILITY_BY_BUS_VERB[verb];
}
//# sourceMappingURL=app-query-capabilities.js.map