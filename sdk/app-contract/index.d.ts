/**
 * app-contract/index.ts — generated from shared/app-contract/index.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export * from "./process.js";
import { APP_INPUT_STATUS_CAPABILITY } from "../app-input-status-capabilities.js";
import { APP_WINDOWS_MANAGE_CAPABILITY } from "./windows.js";
import { APP_INSTANCES_MANAGE_CAPABILITY } from "./instances.js";
import { APP_ENVIRONMENTS_MANAGE_CAPABILITY } from "./environments.js";
import { APP_INPUT_PANELS_CAPABILITY } from "../app-input-panel-capabilities.js";
/**
 * shared/app-contract/index.ts — the published entry point of the v2 app
 * contract: `ctx` shape, manifest shape, bus verbs, and grantable capability
 * words, all in one place. This is what `@hana/app-sdk`'s own `index.ts` is
 * generated from (`scripts/sync-app-sdk.mjs`), and what a host module that
 * wants the whole contract in one import can read too.
 */
import type { AppBusRequestVerb } from "../app-bus-contract.js";
import { APP_EVENTS_EMIT_CAPABILITY } from "../app-grantable-capabilities.js";
import type { AppMediaCapability } from "../app-media-capabilities.js";
import type { AppProcessCapability } from "../app-process-capabilities.js";
import type { AppRenderCapability } from "../app-render-capabilities.js";
import type { AppResourceCapability } from "../app-resource-capabilities.js";
import type { AppSessionControlCapability } from "../app-session-control-capabilities.js";
import type { AppSessionFileCapability } from "../app-session-file-capabilities.js";
import { APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY } from "../app-tool-exposure.js";
import type { AppUiCapability } from "../app-ui-capabilities.js";
import type { AppQueryCapability } from "../app-query-capabilities.js";
import type { AppEntityCapability } from "../app-entity-capabilities.js";
import type { AppMcpCapability } from "../app-mcp-capabilities.js";
import type { AppProviderCapability } from "../app-provider-capabilities.js";
import type { AppCatalogCapability } from "../app-catalog-capabilities.js";
import type { AppTasksCapability } from "./tasks.js";
import type { AppServicesCapability } from "./app-services.js";
import type { AppDynamicUiCapability } from "./dynamic-ui.js";
import type { AppHookCapability } from "../app-hook-capabilities.js";
import type { AppPublicDataCapability } from "./public-data.js";
import type { AppNotificationsCapability } from "./notifications.js";
export type { AppHookCapability } from "../app-hook-capabilities.js";
export * from "./context.js";
export * from "./windows.js";
export * from "./instances.js";
export * from "./surfaces.js";
export * from "./tasks.js";
export * from "./models.js";
export * from "./runtime.js";
export * from "./runtime-client.js";
export * from "./entry-context.js";
export * from "./registration.js";
export * from "./bus-requests.js";
export * from "./server-client.js";
export * from "./sdk-error.js";
export * from "./model-stream.js";
export * from "./manifest.js";
export * from "./queries.js";
export * from "./agents.js";
export * from "./environment-agents.js";
export * from "./sessions.js";
export * from "./session-search.js";
export * from "./public-data.js";
export * from "./mcp.js";
export * from "./providers.js";
export * from "./config-state.js";
export * from "./catalog.js";
export * from "./cli.js";
export * from "./app-services.js";
export * from "./dynamic-ui.js";
export * from "./input-status.js";
export * from "./environments.js";
export * from "./settings.js";
export * from "./canvas.js";
export * from "./workspace.js";
export * from "./input-panels.js";
export * from "./notifications.js";
export { APP_BUS_REQUEST_ALLOWLIST, APP_BUS_EMIT_DENYLIST, isAppBusRequestAllowed, isAppBusRequestVerb, isHostReservedBusEventType, } from "../app-bus-contract.js";
/**
 * A literal union of the same verbs `APP_BUS_REQUEST_ALLOWLIST` carries,
 * derived from that array rather than hand-copied: `../app-bus-contract.ts`
 * declares the array `as const`, so `AppBusRequestVerb` — the type this
 * alias re-exports under its `V2`-suffixed public name — is
 * `(typeof APP_BUS_REQUEST_ALLOWLIST)[number]`, and the two can never drift
 * apart.
 */
export type AppBusRequestVerbV2 = AppBusRequestVerb;
export { APP_EVENTS_EMIT_CAPABILITY, APP_GRANTABLE_CAPABILITIES } from "../app-grantable-capabilities.js";
export { APP_INPUT_STATUS_CAPABILITY, APP_INPUT_STATUS_CAPABILITY_WORDS } from "../app-input-status-capabilities.js";
export { APP_INPUT_PANELS_CAPABILITY, APP_INPUT_PANELS_CAPABILITY_WORDS } from "../app-input-panel-capabilities.js";
export type { AppInputPanelsCapability } from "../app-input-panel-capabilities.js";
export { APP_NOTIFICATIONS_SHOW_CAPABILITY, APP_NOTIFICATIONS_CAPABILITY_WORDS } from "./notifications.js";
export type { AppNotificationsCapability } from "./notifications.js";
export { APP_USAGE_READ_CAPABILITY, APP_PROVIDER_CREDENTIALS_READ_CAPABILITY, APP_MODELS_READ_CAPABILITY, APP_QUERY_CAPABILITY_WORDS, APP_QUERY_BUS_VERBS, appQueryCapabilityForBusVerb, isAppQueryBusVerb, } from "../app-query-capabilities.js";
export type { AppQueryCapability, AppQueryBusVerb } from "../app-query-capabilities.js";
export { APP_AGENTS_READ_CAPABILITY, APP_AGENTS_MANAGE_CAPABILITY, APP_SESSIONS_READ_CAPABILITY, APP_SESSIONS_MANAGE_CAPABILITY, APP_SESSIONS_SEARCH_CAPABILITY, APP_ENTITY_CAPABILITY_WORDS, } from "../app-entity-capabilities.js";
export type { AppEntityCapability } from "../app-entity-capabilities.js";
export { APP_PUBLIC_DATA_PUBLISH_CAPABILITY, APP_PUBLIC_DATA_READ_CAPABILITY, APP_PUBLIC_DATA_CAPABILITY_WORDS, } from "./public-data.js";
export type { AppPublicDataCapability } from "./public-data.js";
export { APP_MCP_PROVIDE_CAPABILITY, APP_MCP_READ_CAPABILITY, APP_MCP_MANAGE_CAPABILITY, APP_MCP_CAPABILITY_WORDS, } from "../app-mcp-capabilities.js";
export type { AppMcpCapability } from "../app-mcp-capabilities.js";
export { APP_TOOLS_READ_CAPABILITY, APP_COMMANDS_READ_CAPABILITY, APP_CATALOG_CAPABILITY_WORDS, } from "../app-catalog-capabilities.js";
export type { AppCatalogCapability } from "../app-catalog-capabilities.js";
export { APP_HOOK_CAPABILITIES, APP_HOOK_CAPABILITY_WORDS, APP_HOOK_WORDS, isAppHookWord, } from "../app-hook-capabilities.js";
export { APP_MEDIA_GENERATE_CAPABILITY, APP_MEDIA_PROVIDE_CAPABILITY, APP_MEDIA_TASKS_MANAGE_CAPABILITY, APP_MEDIA_TASKS_READ_ALL_CAPABILITY, APP_MEDIA_TASKS_MANAGE_ALL_CAPABILITY, APP_PROVIDER_MODELS_MANAGE_CAPABILITY, APP_MEDIA_CAPABILITY_WORDS, APP_MEDIA_GENERATE_BUS_VERBS, APP_MEDIA_PROVIDERS_BUS_VERB, APP_MEDIA_BUS_VERBS, } from "../app-media-capabilities.js";
export type { AppMediaCapability } from "../app-media-capabilities.js";
export type { AppMediaTaskV2, AppMediaTaskScopeV2, AppMediaTaskFilterV2, AppMediaAdapterV2, AppMediaModelCapabilityV2, AppMediaModelV2, AppSessionAudioTranscriptionRequestV2, AppLocalAudioTranscriptionRequestV2, AppTranscribeAudioRequestV2, AppReadyAudioTranscriptionV2, AppFailedAudioTranscriptionV2, AppTranscribeAudioResultV2, AppMediaProviderModelV2, AppMediaProviderV2, AppMediaProviderSelectionV2, AppSpeechRecognitionProvidersResultV2, HanaPluginMediaTasksV2, AppMediaBulkCleanupFailureV2, } from "./media.js";
export { APP_MEDIA_BULK_CLEANUP_PARTIAL, transcribeAudio, listSpeechRecognitionProviders, } from "./media.js";
export { APP_PROCESS_SPAWN_CAPABILITY, APP_PROCESS_CAPABILITY_WORDS } from "../app-process-capabilities.js";
export type { AppProcessCapability } from "../app-process-capabilities.js";
export { APP_RENDER_PDF_CAPABILITY, APP_RENDER_CAPABILITY_WORDS, APP_RENDER_HTML_TO_PDF_BUS_VERB, } from "../app-render-capabilities.js";
export type { AppRenderCapability } from "../app-render-capabilities.js";
export { APP_RESOURCES_READ_CAPABILITY, APP_RESOURCES_WRITE_CAPABILITY, APP_RESOURCE_CAPABILITY_WORDS, } from "../app-resource-capabilities.js";
export type { AppResourceCapability } from "../app-resource-capabilities.js";
/**
 * `../app-resource-capabilities.ts` now declares `APP_RESOURCE_CAPABILITY_WORDS`
 * `as const` and derives its own `AppResourceCapability` type from it — this
 * alias just re-exports that derived type under its `V2`-suffixed public name,
 * on `AppBusRequestVerbV2`'s own reasoning further up this file.
 */
export type AppResourceCapabilityV2 = AppResourceCapability;
export { APP_SESSION_SWITCH_MODEL_CAPABILITY, APP_SESSION_THINKING_LEVEL_CAPABILITY, APP_SESSION_PERMISSION_MODE_CAPABILITY, APP_SESSION_START_TURN_CAPABILITY, APP_SESSION_TOOLS_CONFIGURE_CAPABILITY, APP_SESSION_CONTROL_CAPABILITY_WORDS, } from "../app-session-control-capabilities.js";
export type { AppSessionControlCapability } from "../app-session-control-capabilities.js";
export { APP_SESSION_STAGE_FILE_CAPABILITY, APP_SESSION_FILE_CAPABILITY_WORDS, } from "../app-session-file-capabilities.js";
export type { AppSessionFileCapability } from "../app-session-file-capabilities.js";
export { APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY, APP_TOOL_SUPPLIER } from "../app-tool-exposure.js";
export { APP_UI_OPEN_EXTERNAL_CAPABILITY, APP_UI_CLIPBOARD_WRITE_CAPABILITY, APP_UI_CAPABILITY_WORDS, } from "../app-ui-capabilities.js";
export type { AppUiCapability } from "../app-ui-capabilities.js";
/**
 * Every capability word a v2 app may be granted, across every domain above —
 * the same set `APP_GRANTABLE_CAPABILITIES` names at runtime, as a type. Not
 * `keyof typeof APP_GRANTABLE_CAPABILITIES` — that constant is a
 * `ReadonlySet<string>`, which carries no literal member types to key off of
 * — so this is the union of each domain's own capability type instead.
 * Every source table retains literal members, including Hook and dynamic UI
 * permissions, so callers can type-check the full grantable vocabulary.
 */
export type AppCapabilityWordV2 = AppTasksCapability | "app/models.infer" | "app/runtime.execute" | "app/runtime.network" | "app/runtime.native" | "app/runtime.local-machine" | typeof APP_INPUT_STATUS_CAPABILITY | typeof APP_INPUT_PANELS_CAPABILITY | AppNotificationsCapability | typeof APP_EVENTS_EMIT_CAPABILITY | typeof APP_WINDOWS_MANAGE_CAPABILITY | typeof APP_INSTANCES_MANAGE_CAPABILITY | typeof APP_ENVIRONMENTS_MANAGE_CAPABILITY | AppMediaCapability | AppProcessCapability | AppRenderCapability | AppResourceCapabilityV2 | AppSessionControlCapability | AppSessionFileCapability | typeof APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY | AppUiCapability | AppQueryCapability | AppEntityCapability | AppMcpCapability | AppProviderCapability | AppCatalogCapability | AppServicesCapability | AppDynamicUiCapability | AppHookCapability | AppPublicDataCapability;
export type { MarketArchive, MarketItemVersion, MarketItemCompatibility, MarketItemV2, MarketIndexV2, } from "../extension-market-index.js";
export { MARKET_INDEX_SCHEMA_VERSION } from "../extension-market-index.js";
export type { ExtensionKind, PermissionDeclaration } from "../extension-contract.js";
//# sourceMappingURL=index.d.ts.map