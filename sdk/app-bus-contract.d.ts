/**
 * app-bus-contract.ts — generated from shared/app-bus-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Published v2 App bus boundaries. Request handlers enforce ownership and
 * standing grants after this allowlist selects the supported API surface.
 * Host and frozen v1 callers retain their separate bus contracts.
 *
 * Apps may emit custom events, but cannot impersonate host-owned events in
 * the denylist below. Both lists are enforced by the v2 context proxy.
 */
export declare const APP_BUS_REQUEST_ALLOWLIST: readonly ["session:create", "session:get", "session:send", "session:update", "session:abort", "session:history", "session:tools", "session:tool-selection", "session:set-active-tools", "session:list", "session:search", "session:send-custom", "session:append-entry", "session:set-entry-label", "session:get-entry-label", "session:switch-model", "session:stage-file", "session:register-file", "agent:create-from-type", "role:list", "role:get", "agent:create-from-role", "agent:list", "agent:update", "agent:update-config", "model:list", "app:capabilities", "media:generate", "media:generate-image", "media:generate-video", "media:transcribe-audio", "provider:media-providers", "render:html-to-pdf", "usage:list", "provider:credentials", "provider:models-by-type", "provider:resolve-media-model", "agent:create", "agent:profile", "agent:config", "agent:retire", "agent:purge", "session:archive", "session:restore", "session:delete", "session:fork", "session:compact", "session:context", "session:entries"];
/** The literal-union type of every verb `APP_BUS_REQUEST_ALLOWLIST` carries. */
export type AppBusRequestVerb = (typeof APP_BUS_REQUEST_ALLOWLIST)[number];
/** Is `type` one of the published verbs a v2 app may call through `ctx.bus.request`? */
export declare function isAppBusRequestAllowed(type: unknown): type is string;
/** Is `value` one of the published verbs `APP_BUS_REQUEST_ALLOWLIST` carries, narrowing to the derived union type? */
export declare function isAppBusRequestVerb(value: unknown): value is AppBusRequestVerb;
/**
 * Every event type an app is refused permission to `ctx.bus.emit`: the host's
 * own vocabulary on this bus, documented and undocumented alike. An app's own
 * custom event names (`settings_tool_started` and anything else it invents)
 * are unaffected — this is a ban list, not an allowlist, precisely because
 * `APPS.md`'s "完整最小示例" already promises an app may name its own events.
 */
export declare const APP_BUS_EMIT_DENYLIST: readonly string[];
/** Is `type` a host-reserved event type a v2 app may not `ctx.bus.emit`? */
export declare function isHostReservedBusEventType(type: unknown): type is string;
//# sourceMappingURL=app-bus-contract.d.ts.map