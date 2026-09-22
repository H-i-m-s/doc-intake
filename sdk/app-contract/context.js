export const HANA_PLUGIN_TOOLS_V2_MEMBERS = ["list", "listOwn", "register"];
export const HANA_PLUGIN_TOOL_EXECUTE_CONTEXT_V2_MEMBERS = [
    "callToken",
    "document",
    "messageId",
    "messageText",
    "sessionPath",
];
export const HANA_PLUGIN_LOGGER_V2_MEMBERS = ["debug", "error", "info", "warn"];
export const HANA_PLUGIN_BUS_V2_MEMBERS = [
    "emit",
    "getCapability",
    "handle",
    "hasHandler",
    "listCapabilities",
    "request",
    "subscribe",
];
export const HANA_PLUGIN_USER_INTERACTION_V2_MEMBERS = ["ask", "dismiss", "show", "updatePanel"];
export const HANA_PLUGIN_INPUT_BANNER_V2_MEMBERS = ["dismiss", "set"];
export const HANA_PLUGIN_CONFIG_V2_MEMBERS = [
    "discardSession", "forkSession", "get", "getAll", "getSchema", "getState", "set", "setMany",
];
export const HANA_PLUGIN_COMMANDS_V2_MEMBERS = ["list", "listOwn", "register"];
export const HANA_PLUGIN_HOOK_SESSION_V2_MEMBERS = ["sessionId", "sessionPath"];
export const HANA_PLUGIN_HOOK_SESSION_INPUT_INVOCATION_V2_MEMBERS = ["images", "session", "signal", "text"];
export const HANA_PLUGIN_HOOK_AGENT_BEFORE_START_INVOCATION_V2_MEMBERS = ["prompt", "session", "signal", "systemPrompt"];
export const HANA_PLUGIN_HOOK_AGENT_PRE_STEP_INVOCATION_V2_MEMBERS = ["messages", "session", "signal"];
export const HANA_PLUGIN_HOOK_TOOLS_PRE_EXECUTE_INVOCATION_V2_MEMBERS = ["input", "session", "signal", "toolName"];
export const HANA_PLUGIN_HOOK_TOOLS_POST_EXECUTE_INVOCATION_V2_MEMBERS = ["content", "details", "isError", "session", "signal", "toolName", "usage"];
export const HANA_PLUGIN_HOOK_SESSION_BEFORE_COMPACT_INVOCATION_V2_MEMBERS = ["branchEntries", "customInstructions", "preparation", "session", "signal"];
export const HANA_PLUGIN_HOOK_PROVIDER_BEFORE_HEADERS_INVOCATION_V2_MEMBERS = ["headers", "session", "signal"];
export const HANA_PLUGIN_HOOK_PROVIDER_BEFORE_REQUEST_INVOCATION_V2_MEMBERS = ["payload", "session", "signal"];
export const HANA_PLUGIN_HOOK_MESSAGES_POST_ASSISTANT_INVOCATION_V2_MEMBERS = ["message", "session", "signal"];
export const HANA_PLUGIN_HOOKS_V2_MEMBERS = ["on", "onDecision"];
export const HANA_PLUGIN_NETWORK_V2_MEMBERS = ["fetch"];
export const HANA_PLUGIN_ROUTES_V2_MEMBERS = ["register"];
export const HANA_PLUGIN_STORAGE_SCOPE_V2_MEMBERS = ["delete", "get", "getAll", "keys", "onChanged", "set"];
export const HANA_PLUGIN_STORAGE_V2_MEMBERS = ["agent", "global"];
export const HANA_PLUGIN_APP_EVENTS_V2_MEMBERS = ["emit"];
export const HANA_PLUGIN_MEDIA_V2_MEMBERS = [
    "addModel",
    "cancelTask",
    "getTask",
    "getTaskResources",
    "listAdapters",
    "listTasks",
    "registerAdapter",
    "registerCapabilitySource",
    "removeModel",
    "removeTask",
    "removeUnfavorited",
    "retryTask",
    "unregisterAdapter",
    "unregisterCapabilitySource",
    "updateModel",
    "updateTask",
];
export const HANA_PLUGIN_RESOURCES_V2_MEMBERS = [
    "copy",
    "delete",
    "edit",
    "list",
    "materialize",
    "mkdir",
    "move",
    "read",
    "register",
    "rename",
    "resolveWatchTarget",
    "search",
    "stage",
    "stat",
    "subscribe",
    "trash",
    "watch",
    "write",
    "writeExpectedVersion",
];
export const HANA_PLUGIN_DOCUMENTS_V2_MEMBERS = [
    "read",
    "readRelated",
    "requestView",
    "writeExpectedVersion",
];
/** The members of `HanaPluginContextV2`, alphabetical. */
export const HANA_PLUGIN_CONTEXT_V2_MEMBERS = ["appEvents", "bus", "commands", "config", "dataDir", "documents", "environments", "hooks", "inputBanner", "inputStatus", "instances", "launchArgs", "logger", "mcp", "media", "messageRenderers", "models", "network", "notifications", "process", "providers", "publicData", "resources", "routes", "runtime", "shortcuts", "storage", "surfaces", "tasks", "tools", "userInteraction", "windows"];
//# sourceMappingURL=context.js.map