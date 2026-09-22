/** Canonical names used by the SDK wrappers, tied to the typed verb map. */
export const APP_SDK_BUS_METHODS = {
    sessions: {
        create: "session:create", get: "session:get", send: "session:send", update: "session:update", abort: "session:abort",
        history: "session:history", tools: "session:tools", getToolSelection: "session:tool-selection", setActiveTools: "session:set-active-tools",
        list: "session:list", search: "session:search", sendCustom: "session:send-custom", appendEntry: "session:append-entry", setEntryLabel: "session:set-entry-label",
        getEntryLabel: "session:get-entry-label", switchModel: "session:switch-model", stageFile: "session:stage-file", registerFile: "session:register-file",
        archive: "session:archive", restore: "session:restore", delete: "session:delete", fork: "session:fork", compact: "session:compact",
        context: "session:context", entries: "session:entries",
    },
    agents: { createFromType: "agent:create-from-type", createFromRole: "agent:create-from-role", create: "agent:create", list: "agent:list", profile: "agent:profile", config: "agent:config", update: "agent:update", updateConfig: "agent:update-config", retire: "agent:retire", purge: "agent:purge" },
    roles: { list: "role:list", get: "role:get" },
    models: { listAvailable: "model:list" },
    capabilities: { get: "app:capabilities" },
    media: { generate: "media:generate", generateImage: "media:generate-image", generateVideo: "media:generate-video", transcribeAudio: "media:transcribe-audio" },
    providers: { listMediaProviders: "provider:media-providers", getCredentials: "provider:credentials", listModelsByType: "provider:models-by-type", resolveMediaModel: "provider:resolve-media-model" },
    render: { htmlToPdf: "render:html-to-pdf" },
    usage: { list: "usage:list" },
};
//# sourceMappingURL=bus-requests.js.map