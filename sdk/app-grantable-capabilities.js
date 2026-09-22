/**
 * app-grantable-capabilities.ts — generated from shared/app-grantable-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { APP_TASKS_CAPABILITY_WORDS } from "./app-contract/tasks.js";
import { APP_MODELS_CAPABILITY } from "./app-contract/models.js";
import { APP_RUNTIME_CAPABILITY_WORDS } from "./app-contract/runtime.js";
/**
 * Every capability POST /api/permissions/app-capability may write. The
 * ledger itself accepts any "<domain>/<action>" string; this set is only
 * the HTTP door's whitelist, so a caller cannot mint an arbitrary app/*
 * word the way a direct ledger.grant() could.
 *
 * Lives in shared/ because the HTTP route, the settings panel, and the
 * app:capabilities bus verb all have to name the same words.
 */
import { APP_HOOK_CAPABILITY_WORDS } from "./app-hook-capabilities.js";
import { APP_MEDIA_CAPABILITY_WORDS } from "./app-media-capabilities.js";
import { APP_PROCESS_CAPABILITY_WORDS } from "./app-process-capabilities.js";
import { APP_RENDER_CAPABILITY_WORDS } from "./app-render-capabilities.js";
import { APP_RESOURCE_CAPABILITY_WORDS } from "./app-resource-capabilities.js";
import { APP_SESSION_CONTROL_CAPABILITY_WORDS } from "./app-session-control-capabilities.js";
import { APP_SESSION_FILE_CAPABILITY_WORDS } from "./app-session-file-capabilities.js";
import { APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY } from "./app-tool-exposure.js";
import { APP_UI_CAPABILITY_WORDS } from "./app-ui-capabilities.js";
import { APP_QUERY_CAPABILITY_WORDS } from "./app-query-capabilities.js";
import { APP_ENTITY_CAPABILITY_WORDS } from "./app-entity-capabilities.js";
import { APP_MCP_CAPABILITY_WORDS } from "./app-mcp-capabilities.js";
import { APP_PROVIDER_CAPABILITY_WORDS } from "./app-provider-capabilities.js";
import { APP_SERVICES_CAPABILITY_WORDS } from "./app-contract/app-services.js";
import { APP_CATALOG_CAPABILITY_WORDS } from "./app-catalog-capabilities.js";
import { APP_DYNAMIC_UI_CAPABILITY_WORDS } from "./app-contract/dynamic-ui.js";
import { APP_INPUT_STATUS_CAPABILITY_WORDS } from "./app-input-status-capabilities.js";
import { APP_WINDOWS_MANAGE_CAPABILITY } from "./app-contract/windows.js";
import { APP_INSTANCES_MANAGE_CAPABILITY } from "./app-contract/instances.js";
import { APP_ENVIRONMENTS_MANAGE_CAPABILITY } from "./app-contract/environments.js";
import { APP_PUBLIC_DATA_CAPABILITY_WORDS } from "./app-contract/public-data.js";
import { APP_INPUT_PANELS_CAPABILITY_WORDS } from "./app-input-panel-capabilities.js";
import { APP_NOTIFICATIONS_CAPABILITY_WORDS } from "./app-contract/notifications.js";
/** Emit onto the local desktop `app_event` channel. Default deny. */
export const APP_EVENTS_EMIT_CAPABILITY = "app/events.emit";
export const APP_GRANTABLE_CAPABILITIES = new Set([
    ...APP_TASKS_CAPABILITY_WORDS, APP_MODELS_CAPABILITY, ...APP_RUNTIME_CAPABILITY_WORDS,
    APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY,
    APP_EVENTS_EMIT_CAPABILITY,
    ...APP_CATALOG_CAPABILITY_WORDS,
    ...APP_HOOK_CAPABILITY_WORDS,
    ...APP_SESSION_CONTROL_CAPABILITY_WORDS,
    ...APP_SESSION_FILE_CAPABILITY_WORDS,
    ...APP_RESOURCE_CAPABILITY_WORDS,
    ...APP_MEDIA_CAPABILITY_WORDS,
    ...APP_RENDER_CAPABILITY_WORDS,
    ...APP_PROCESS_CAPABILITY_WORDS,
    ...APP_UI_CAPABILITY_WORDS,
    ...APP_QUERY_CAPABILITY_WORDS,
    ...APP_ENTITY_CAPABILITY_WORDS,
    ...APP_MCP_CAPABILITY_WORDS,
    ...APP_PROVIDER_CAPABILITY_WORDS,
    ...APP_SERVICES_CAPABILITY_WORDS,
    ...APP_DYNAMIC_UI_CAPABILITY_WORDS,
    ...APP_INPUT_STATUS_CAPABILITY_WORDS,
    APP_WINDOWS_MANAGE_CAPABILITY,
    APP_INSTANCES_MANAGE_CAPABILITY,
    APP_ENVIRONMENTS_MANAGE_CAPABILITY,
    ...APP_PUBLIC_DATA_CAPABILITY_WORDS,
    ...APP_INPUT_PANELS_CAPABILITY_WORDS,
    ...APP_NOTIFICATIONS_CAPABILITY_WORDS,
]);
//# sourceMappingURL=app-grantable-capabilities.js.map