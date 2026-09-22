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
export const APP_BUS_REQUEST_ALLOWLIST = Object.freeze([
    "session:create",
    "session:get",
    "session:send",
    "session:update",
    "session:abort",
    "session:history",
    "session:tools",
    "session:tool-selection",
    "session:set-active-tools",
    "session:list",
    "session:search",
    "session:send-custom",
    "session:append-entry",
    "session:set-entry-label",
    "session:get-entry-label",
    "session:switch-model",
    "session:stage-file",
    "session:register-file",
    "agent:create-from-type",
    "role:list",
    "role:get",
    "agent:create-from-role",
    "agent:list",
    "agent:update",
    "agent:update-config",
    "model:list",
    "app:capabilities",
    "media:generate",
    "media:generate-image",
    "media:generate-video",
    "media:transcribe-audio",
    "provider:media-providers",
    "render:html-to-pdf",
    "usage:list",
    "provider:credentials",
    "provider:models-by-type",
    "provider:resolve-media-model",
    "agent:create",
    "agent:profile",
    "agent:config",
    "agent:retire",
    "agent:purge",
    "session:archive",
    "session:restore",
    "session:delete",
    "session:fork",
    "session:compact",
    "session:context",
    "session:entries",
]);
const APP_BUS_REQUEST_ALLOWLIST_SET = new Set(APP_BUS_REQUEST_ALLOWLIST);
/** Is `type` one of the published verbs a v2 app may call through `ctx.bus.request`? */
export function isAppBusRequestAllowed(type) {
    return typeof type === "string" && APP_BUS_REQUEST_ALLOWLIST_SET.has(type);
}
/** Is `value` one of the published verbs `APP_BUS_REQUEST_ALLOWLIST` carries, narrowing to the derived union type? */
export function isAppBusRequestVerb(value) {
    return typeof value === "string" && APP_BUS_REQUEST_ALLOWLIST_SET.has(value);
}
/**
 * The seventeen Pi-engine event types `ctx.bus.subscribe` forwards verbatim
 * (`APPS.md`/`APPS_EN.md`'s "观察会话事件" table).
 */
const PI_FORWARDED_EVENT_TYPES = [
    "agent_start", "turn_start", "turn_end", "message_start", "message_update",
    "message_end", "tool_execution_start", "tool_execution_update", "tool_execution_end",
    "agent_end", "queue_update", "compaction_start", "compaction_end",
    "session_info_changed", "thinking_level_changed", "auto_retry_start", "auto_retry_end",
];
/**
 * The four session-lifecycle event types `APPS.md`/`APPS_EN.md` document as
 * the formal contract: the one host-synthesized `session_metadata_updated`
 * plus the three lifecycle events `session_created`/`session_closed`/
 * `session_forked`.
 */
const SESSION_LIFECYCLE_EVENT_TYPES = [
    "session_created", "session_closed", "session_forked", "session_metadata_updated", "session_deleted", "input_status_changed",
];
/**
 * Eight more event types the host emits on this same bus that `APPS.md`
 * already names elsewhere in the book (input banners, dev tooling, mode
 * changes, usage) without listing them in the "观察会话事件" table's own
 * event-type roster. `llm_usage` is the one the v1 lane already reserves
 * (`core/plugin-context.ts`'s `createPluginBusProxy`, gated there on
 * `usage.read` rather than an outright ban — v2 has no permission grade for
 * it yet, so it is a flat ban here, matching v1's default-deny floor).
 */
const HOST_NAMED_ELSEWHERE_EVENT_TYPES = [
    "permission_mode", "access_mode", "plan_mode", "app_event",
    "browser_bg_status", "confirmation_resolved", "devlog", "llm_usage",
];
/**
 * Every other event type this repository's own emit call sites prove the
 * host sends on the very same `EventBus` instance `ctx.bus` wraps, found by
 * tracing every `hub/event-bus.ts`-backed `.emit(...)`/`emitEvent(...)` call
 * site reachable from `hub/index.ts`'s `_eventBus`, `core/engine.ts`'s
 * `_emitEvent`, and every module either one hands that same callback to —
 * not merely the ones `APPS.md`'s "观察会话事件" table calls out as the
 * "正式契约". That table's own wording claims those 29 are the **complete**
 * set; grepping the emit call sites shows the host sends dozens more that
 * were never written into that promise. An app forging any of these is
 * impersonating the host exactly as much as forging `session_created` would
 * be, so they belong on this ban list regardless of which list is or is not
 * documented — see `APPS.md`/`APPS_EN.md`'s own corrected wording, which no
 * longer claims the documented table is complete.
 *
 * Grouped by the subsystem that emits them, purely for a human skimming this
 * file — the ban itself does not care about the grouping.
 */
const HOST_UNDOCUMENTED_EVENT_TYPES = [
    // hub/scheduler.ts, lib/conversations/agent-phone-activity.ts
    "activity_update", "cron_job_done", "conversation_agent_activity",
    // lib/tools/subagent-tool.ts, lib/tools/workflow-tool.ts
    "block_update", "workflow_progress",
    // lib/bridge/bridge-manager.ts, hub/dm-router.ts, hub/channel-router.ts, hub/index.ts,
    // core/slash-commands/bridge-commands.ts, core/slash-commands/rc-pending-handler.ts
    "bridge_message", "bridge_status", "bridge_rc_attached", "bridge_rc_detached",
    "dm_new_message", "channel_new_message", "channel_created",
    "channel_cycle_start", "channel_cycle_done", "channel_delivery_guard",
    // core/session-coordinator.ts
    "cache_contract_violation", "session-authorized-folders-updated",
    "session_branch_persistence_warning", "session_unhealthy_warning",
    // core/session-turn-actions.ts, core/desktop-session-submit.ts, lib/agent-review/turn-coordinator.ts
    "session_branch_reset", "session_status", "session_user_message", "interjection_dropped",
    // server/card-host/permissions.ts, lib/tools/computer-use-tool.ts
    "card_host_confirmation", "computer_overlay",
    // core/agent-manager.ts, core/engine.ts (desktop notifications)
    "notification",
    // core/plugin-manager.ts, server/routes/plugins-v2.ts
    "plugin_ui_changed", "plugin_config_changed",
    // server/composition/plugin-context-v2.ts's own inputBanner door
    "input_banner_set", "input_banner_dismissed",
    // server/app-host/app-input-panel-events.ts
    "app_input_panels_changed",
    // lib/user-interaction.ts
    "session_confirmation",
    // lib/deferred-result-store.ts
    "deferred_result",
    // core/media/poller.ts
    "media-gen:task-done",
    // lib/resource-io/resource-event-bus.ts
    "resource.changed", "resource.deleted", "resource.renamed",
    // server/routes/chat.ts, server/routes/sessions.ts
    "token_usage", "todo_update", "session_background_task",
    // core/speech-recognition-service.ts
    "voice_transcription_update",
    // lib/wait/wait-registration-store.ts
    "wait_started", "wait_finished", "wait_task_settled", "wait_cancelled",
    // hub/index.ts's session:send failure path
    "error",
];
/**
 * Every event type an app is refused permission to `ctx.bus.emit`: the host's
 * own vocabulary on this bus, documented and undocumented alike. An app's own
 * custom event names (`settings_tool_started` and anything else it invents)
 * are unaffected — this is a ban list, not an allowlist, precisely because
 * `APPS.md`'s "完整最小示例" already promises an app may name its own events.
 */
export const APP_BUS_EMIT_DENYLIST = Object.freeze([
    ...PI_FORWARDED_EVENT_TYPES,
    ...SESSION_LIFECYCLE_EVENT_TYPES,
    ...HOST_NAMED_ELSEWHERE_EVENT_TYPES,
    ...HOST_UNDOCUMENTED_EVENT_TYPES,
]);
const APP_BUS_EMIT_DENYLIST_SET = new Set(APP_BUS_EMIT_DENYLIST);
/** Is `type` a host-reserved event type a v2 app may not `ctx.bus.emit`? */
export function isHostReservedBusEventType(type) {
    return typeof type === "string" && APP_BUS_EMIT_DENYLIST_SET.has(type);
}
//# sourceMappingURL=app-bus-contract.js.map