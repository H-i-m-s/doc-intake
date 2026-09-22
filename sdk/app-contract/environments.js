/** Capability required to operate an isolated, multi-extension environment. */
export const APP_ENVIRONMENTS_MANAGE_CAPABILITY = "app/environments.manage";
export const APP_ENVIRONMENT_METHODS = Object.freeze([
    "create", "list", "get", "close", "logs", "listInstalledSources", "listExtensions", "inspectExtension", "installExtension", "copyInstalled",
    "requestReview", "setExtensionEnabled", "reloadExtension", "removeExtension", "listModels", "listAgents", "getAgent", "createAgent", "updateAgent", "removeAgent", "catalog", "runTool", "invokeUiAction",
]);
//# sourceMappingURL=environments.js.map