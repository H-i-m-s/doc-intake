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
export declare const APP_SERVICES_PROVIDE_CAPABILITY: "app/services.provide";
/** Permit this App to call a different App's opted-in service. Default deny. */
export declare const APP_SERVICES_CALL_CAPABILITY: "app/services.call";
export declare const APP_SERVICES_CAPABILITY_WORDS: readonly ["app/services.provide", "app/services.call"];
export type AppServicesCapability = (typeof APP_SERVICES_CAPABILITY_WORDS)[number];
/** The only option an App service provider may set. */
export interface HanaPluginBusHandleOptionsV2 {
    /** Let other Apps call this service when they hold `app/services.call`. */
    readonly allowCrossApp?: boolean;
}
/** Options for an App-owned `app:<appId>/<name>` request. */
export interface AppServiceRequestOptionsV2 {
    /** Positive request deadline in milliseconds; omitted uses 30 seconds. */
    readonly timeout?: number;
    /** Cancels this call and aborts the provider's handler signal. */
    readonly signal?: AbortSignal;
}
/** Host-minted request metadata visible to an App-owned service handler. */
export interface HanaPluginBusHandlerContextV2 {
    /** Unique for this call; useful for correlating an App's own logs. */
    readonly requestId: string;
    /** The App selected by the host as the caller, never caller-provided data. */
    readonly callerAppId: string;
    /** Aborts when the caller cancels, times out, unloads, or loses a required grant. */
    readonly signal: AbortSignal;
}
/** A JSON-safe App service implementation. */
export type HanaPluginBusHandlerV2 = (payload: unknown, context: HanaPluginBusHandlerContextV2) => unknown | Promise<unknown>;
//# sourceMappingURL=app-services.d.ts.map