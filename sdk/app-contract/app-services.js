/**
 * app-contract/app-services.ts — generated from shared/app-contract/app-services.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * App-owned request services exposed through `ctx.bus`.
 *
 * An App registers a short service name; the host owns the complete bus verb
 * (`app:<appId>/<name>`) and the caller identity passed to its handler.
 */
/** Permit this App to register a service that it owns. Default deny. */
export const APP_SERVICES_PROVIDE_CAPABILITY = "app/services.provide";
/** Permit this App to call a different App's opted-in service. Default deny. */
export const APP_SERVICES_CALL_CAPABILITY = "app/services.call";
export const APP_SERVICES_CAPABILITY_WORDS = [
    APP_SERVICES_PROVIDE_CAPABILITY,
    APP_SERVICES_CALL_CAPABILITY,
];
//# sourceMappingURL=app-services.js.map