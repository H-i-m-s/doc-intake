/**
 * app-contract/bus-requests.ts — generated from shared/app-contract/bus-requests.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppTranscribeAudioRequestV2, AppTranscribeAudioResultV2, AppMediaProviderSelectionV2 } from "./media.js";
export type { AppTranscribeAudioRequestV2, AppTranscribeAudioResultV2 } from "./media.js";
/**
 * Typed request/reply pairs for the published v2 App bus surface.
 *
 * This is a declaration of the host's existing verbs. It deliberately does
 * not carry caller identity, owner ids, or host-stamped session metadata in
 * writable inputs: those are resolved by the v2 bus door and its handlers.
 */
import type { AppAgentConfigRequestV2, AppAgentConfigResultV2, AppAgentCreateFromRoleRequestV2, AppAgentCreateFromRoleResultV2, AppAgentCreateFromTypeRequestV2, AppAgentCreateFromTypeResultV2, AppAgentCreateRequestV2, AppAgentCreateResultV2, AppAgentListRequestV2, AppAgentListResultV2, AppAgentProfileRequestV2, AppAgentProfileResultV2, AppAgentPurgeRequestV2, AppAgentPurgeResultV2, AppAgentRetireRequestV2, AppAgentRetireResultV2, AppAgentUpdateConfigRequestV2, AppAgentUpdateConfigResultV2, AppAgentUpdateRequestV2, AppAgentUpdateResultV2, AppRoleGetRequestV2, AppRoleGetResultV2, AppRoleListResultV2 } from "./agents.js";
import type { V2AppFileDeliveryResult, V2AppRegisterFileInput, V2AppStageFileInput } from "./context.js";
import type { AppModelInfoV2 } from "./models.js";
import type { AppProviderCredentialsRequestV2, AppProviderCredentialsResultV2, AppProviderModelsByTypeRequestV2, AppProviderModelsByTypeResultV2, AppResolveMediaModelRequestV2, AppResolveMediaModelResultV2, AppUsageListFilterV2, AppUsageListResultV2 } from "./queries.js";
import type { AppSessionCompactRequestV2, AppSessionCompactResultV2, AppSessionContextRequestV2, AppSessionContextResultV2, AppSessionEntriesRequestV2, AppSessionEntriesResultV2, AppSessionForkRequestV2, AppSessionForkResultV2, AppSessionLifecycleRequestV2, AppSessionLifecycleResultV2, AppSessionListRequestV2, AppSessionListResultV2, AppSessionRefV2, AppSessionSetActiveToolsRequestV2, AppSessionToolSelectionReceiptV2, AppSessionToolSelectionRequestV2 } from "./sessions.js";
import type { AppSessionSearchRequestV2, AppSessionSearchResultV2 } from "./session-search.js";
import type { AppCapabilityEnforcement, AppCapabilityStatus } from "../app-capability-introspection.js";
/** A session target must name a stable id or one of the supported legacy locators. */
export type AppSessionTargetV2 = (AppSessionRefV2 & {
    readonly sessionId: string;
}) | (AppSessionRefV2 & {
    readonly sessionPath: string;
}) | (AppSessionRefV2 & {
    readonly legacySessionPath: string;
});
export type AppSessionAddressOrCallTokenV2 = AppSessionTargetV2 | {
    readonly callToken: string;
};
export interface AppSessionCreateRequestV2 {
    readonly agentId?: string | null;
    readonly cwd?: string | null;
    readonly memoryEnabled?: boolean;
    readonly model?: string | {
        readonly id?: string;
        readonly modelId?: string;
        readonly provider?: string;
        readonly providerId?: string;
    };
    readonly workspaceFolders?: readonly string[];
    readonly authorizedFolders?: readonly string[];
    readonly thinkingLevel?: string;
    readonly permissionMode?: string;
    /** App ownership and visibility are stamped by the host, never selected here. */
    readonly kind?: string | null;
}
export interface AppSessionCreateResultV2 {
    readonly ok: true;
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
    readonly sessionPath: string;
    readonly path: string;
    readonly agentId: string | null;
    readonly agentName: string | null;
    readonly modelId: string | null;
    readonly modelProvider: string | null;
    readonly cwd: string | null;
    readonly workspaceFolders: readonly string[];
    readonly authorizedFolders: readonly string[];
    readonly thinkingLevel: string | null;
    readonly permissionMode: string | null;
    readonly ownerPluginId: string | null;
    readonly kind: string | null;
    readonly visibility: string;
}
export type AppSessionGetRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
};
export interface AppSessionGetResultV2 {
    readonly session: (AppSessionListResultV2["sessions"][number] & {
        readonly thinkingLevel: string | null;
    }) | null;
}
export type AppSessionUpdateRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
    readonly title?: string;
    readonly pinned?: boolean;
    readonly projectId?: string | null;
    readonly thinkingLevel?: string;
    readonly permissionMode?: string;
};
export interface AppSessionUpdateResultV2 {
    readonly ok: true;
    readonly sessionId?: string;
    readonly session: AppSessionGetResultV2["session"];
}
export type AppSessionImageV2 = {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
};
export type AppSessionSendRequestV2 = AppSessionAddressOrCallTokenV2 & {
    readonly scope?: "own" | "all";
    readonly text?: string;
    readonly images?: readonly AppSessionImageV2[];
    readonly deliverAs?: "steer" | "followUp";
    readonly context?: unknown;
};
export interface AppSessionSendResultV2 {
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
    readonly sessionPath: string;
    readonly accepted: true;
}
export type AppSessionAbortRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
    readonly reason?: string;
};
export interface AppSessionAbortResultV2 {
    readonly aborted: boolean;
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
}
export type AppSessionHistoryRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
    readonly limit?: number;
};
export type AppSessionHistoryMessageV2 = {
    readonly role: "user" | "assistant";
    readonly content: string;
    readonly entryId: string | null;
    readonly images?: readonly unknown[];
    readonly thinking?: string;
    readonly toolCalls?: readonly unknown[];
};
export interface AppSessionHistoryResultV2 {
    readonly messages: readonly AppSessionHistoryMessageV2[];
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
}
export type AppSessionToolsRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
};
export interface AppSessionToolsResultV2 {
    readonly toolNames: readonly string[];
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
}
export type AppSessionSendCustomRequestV2 = AppSessionAddressOrCallTokenV2 & {
    readonly scope?: "own" | "all";
    readonly content: string | readonly unknown[];
    readonly customType?: string;
    readonly display?: boolean;
    readonly details?: unknown;
    readonly triggerTurn?: boolean;
};
export interface AppSessionCustomEntryResultV2 {
    readonly ok: boolean;
    readonly mode: string | null;
    readonly customType: string;
    readonly entryId: string | null;
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
}
export type AppSessionAppendEntryRequestV2 = AppSessionAddressOrCallTokenV2 & {
    readonly scope?: "own" | "all";
    readonly customType?: string;
    readonly data?: unknown;
};
export type AppSessionEntryLabelRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
    readonly entryId: string;
};
export type AppSessionSetEntryLabelRequestV2 = AppSessionEntryLabelRequestV2 & {
    readonly label: string | null;
};
export interface AppSessionEntryLabelResultV2 {
    readonly ok: true | boolean;
    readonly entryId: string;
    readonly label: string | null;
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
}
export type AppSessionSwitchModelRequestV2 = AppSessionTargetV2 & {
    readonly scope?: "own" | "all";
    readonly modelId: string;
    readonly provider: string;
};
export interface AppSessionSwitchModelResultV2 {
    readonly ok: true;
    readonly sessionId?: string;
    readonly sessionRef?: {
        readonly sessionId: string;
        readonly sessionPath: string;
    };
    readonly sessionPath: string;
    readonly modelId: string;
    readonly provider: string;
    readonly thinkingLevel: string | null;
    readonly adaptations: readonly unknown[];
}
export type AppSessionStageFileRequestV2 = V2AppStageFileInput & {
    readonly callToken?: string;
};
export type AppSessionRegisterFileRequestV2 = V2AppRegisterFileInput & {
    readonly callToken?: string;
};
export interface AppModelListResultV2 {
    readonly models: readonly AppModelInfoV2[];
}
export type AppAppCapabilitiesRequestV2 = {
    readonly sessionId?: string;
};
export interface AppCapabilityRowV2 {
    readonly capability: string;
    readonly status: AppCapabilityStatus;
    readonly enforcement: AppCapabilityEnforcement;
}
export interface AppAppCapabilitiesResultV2 {
    readonly capabilities: readonly AppCapabilityRowV2[];
}
export type AppMediaCapabilityV2 = "image_generation" | "video_generation" | "speech_recognition";
export type AppMediaReferenceV2 = {
    readonly kind: "local-file";
    readonly path: string;
} | {
    readonly kind: "session-file";
    readonly fileId: string;
};
export interface AppMediaGenerationInputV2 {
    readonly prompt?: string;
    readonly image?: AppMediaReferenceV2 | readonly AppMediaReferenceV2[];
    readonly referenceImages?: readonly AppMediaReferenceV2[];
    readonly audio?: AppMediaReferenceV2 | readonly AppMediaReferenceV2[];
    readonly referenceAudios?: readonly AppMediaReferenceV2[];
    readonly video?: AppMediaReferenceV2 | readonly AppMediaReferenceV2[];
    readonly referenceVideos?: readonly AppMediaReferenceV2[];
    readonly provider?: string;
    readonly model?: string;
    readonly providerId?: string;
    readonly modelId?: string;
    readonly delivery?: {
        readonly mode?: "session" | "response";
        readonly ttlMs?: number;
    };
    readonly deliveryMode?: "session" | "response";
    readonly options?: Readonly<Record<string, unknown>>;
    readonly [key: string]: unknown;
}
export type AppMediaGenerationRequestV2 = {
    readonly callToken: string;
    readonly input: AppMediaGenerationInputV2;
} | {
    readonly scope: "app";
    readonly input: AppMediaGenerationInputV2;
};
export type AppMediaGenerateRequestV2 = AppMediaGenerationRequestV2 & {
    readonly input: AppMediaGenerationInputV2 & {
        readonly kind: "image" | "video" | "audio" | "image_generation" | "video_generation" | "speech_recognition" | "asr" | "transcription";
    };
};
export interface AppMediaGenerationResultV2 {
    readonly ok: boolean;
    readonly taskId?: string;
    readonly batchId?: string;
    readonly status?: string;
    readonly files?: readonly unknown[];
}
export interface AppMediaProvidersRequestV2 {
    readonly capability?: AppMediaCapabilityV2;
}
export interface AppMediaProvidersResultV2 {
    readonly providers: Readonly<Record<string, {
        readonly providerId?: string;
        readonly models: readonly Readonly<Record<string, unknown>>[];
        readonly hasCredentials: boolean;
        readonly unavailableReason: string | null;
        readonly unavailableMessage: string | null;
        readonly activeCredentialLaneId: string | null;
        readonly activeCredentialProviderId: string | null;
    }>>;
    readonly selection: AppMediaProviderSelectionV2;
}
export type AppRenderHtmlToPdfRequestV2 = {
    readonly callToken: string;
    readonly html: string;
    readonly htmlPath?: never;
    readonly outputName?: string;
    readonly options?: Readonly<Record<string, unknown>>;
} | {
    readonly callToken: string;
    readonly htmlPath: string;
    readonly html?: never;
    readonly outputName?: string;
    readonly options?: Readonly<Record<string, unknown>>;
};
/** Every allowlisted request verb and its public input/output pair. */
export interface AppBusRequests {
    "session:create": {
        input: AppSessionCreateRequestV2 | undefined;
        output: AppSessionCreateResultV2;
    };
    "session:get": {
        input: AppSessionGetRequestV2;
        output: AppSessionGetResultV2;
    };
    "session:send": {
        input: AppSessionSendRequestV2;
        output: AppSessionSendResultV2;
    };
    "session:update": {
        input: AppSessionUpdateRequestV2;
        output: AppSessionUpdateResultV2;
    };
    "session:abort": {
        input: AppSessionAbortRequestV2 | undefined;
        output: AppSessionAbortResultV2;
    };
    "session:history": {
        input: AppSessionHistoryRequestV2;
        output: AppSessionHistoryResultV2;
    };
    "session:tools": {
        input: AppSessionToolsRequestV2;
        output: AppSessionToolsResultV2;
    };
    "session:tool-selection": {
        input: AppSessionToolSelectionRequestV2 & AppSessionTargetV2;
        output: AppSessionToolSelectionReceiptV2;
    };
    "session:set-active-tools": {
        input: AppSessionSetActiveToolsRequestV2 & AppSessionTargetV2;
        output: AppSessionToolSelectionReceiptV2;
    };
    "session:list": {
        input: AppSessionListRequestV2 | undefined;
        output: AppSessionListResultV2;
    };
    "session:search": {
        input: AppSessionSearchRequestV2;
        output: AppSessionSearchResultV2;
    };
    "session:send-custom": {
        input: AppSessionSendCustomRequestV2;
        output: AppSessionCustomEntryResultV2;
    };
    "session:append-entry": {
        input: AppSessionAppendEntryRequestV2;
        output: AppSessionCustomEntryResultV2;
    };
    "session:set-entry-label": {
        input: AppSessionSetEntryLabelRequestV2;
        output: AppSessionEntryLabelResultV2;
    };
    "session:get-entry-label": {
        input: AppSessionEntryLabelRequestV2;
        output: AppSessionEntryLabelResultV2;
    };
    "session:switch-model": {
        input: AppSessionSwitchModelRequestV2;
        output: AppSessionSwitchModelResultV2;
    };
    "session:stage-file": {
        input: AppSessionStageFileRequestV2;
        output: V2AppFileDeliveryResult;
    };
    "session:register-file": {
        input: AppSessionRegisterFileRequestV2;
        output: V2AppFileDeliveryResult;
    };
    "session:archive": {
        input: AppSessionLifecycleRequestV2 & AppSessionTargetV2;
        output: AppSessionLifecycleResultV2;
    };
    "session:restore": {
        input: AppSessionLifecycleRequestV2 & AppSessionTargetV2;
        output: AppSessionLifecycleResultV2;
    };
    "session:delete": {
        input: AppSessionLifecycleRequestV2 & AppSessionTargetV2;
        output: AppSessionLifecycleResultV2;
    };
    "session:fork": {
        input: AppSessionForkRequestV2 & AppSessionTargetV2;
        output: AppSessionForkResultV2;
    };
    "session:compact": {
        input: AppSessionCompactRequestV2 & AppSessionTargetV2;
        output: AppSessionCompactResultV2;
    };
    "session:context": {
        input: AppSessionContextRequestV2 & AppSessionTargetV2;
        output: AppSessionContextResultV2;
    };
    "session:entries": {
        input: AppSessionEntriesRequestV2 & AppSessionTargetV2;
        output: AppSessionEntriesResultV2;
    };
    "agent:create-from-type": {
        input: AppAgentCreateFromTypeRequestV2;
        output: AppAgentCreateFromTypeResultV2;
    };
    "agent:create-from-role": {
        input: AppAgentCreateFromRoleRequestV2;
        output: AppAgentCreateFromRoleResultV2;
    };
    "agent:create": {
        input: AppAgentCreateRequestV2;
        output: AppAgentCreateResultV2;
    };
    "agent:list": {
        input: AppAgentListRequestV2 | undefined;
        output: AppAgentListResultV2;
    };
    "agent:profile": {
        input: AppAgentProfileRequestV2;
        output: AppAgentProfileResultV2;
    };
    "agent:config": {
        input: AppAgentConfigRequestV2;
        output: AppAgentConfigResultV2;
    };
    "agent:update": {
        input: AppAgentUpdateRequestV2;
        output: AppAgentUpdateResultV2;
    };
    "agent:update-config": {
        input: AppAgentUpdateConfigRequestV2;
        output: AppAgentUpdateConfigResultV2;
    };
    "agent:retire": {
        input: AppAgentRetireRequestV2;
        output: AppAgentRetireResultV2;
    };
    "agent:purge": {
        input: AppAgentPurgeRequestV2;
        output: AppAgentPurgeResultV2;
    };
    "role:list": {
        input: undefined;
        output: AppRoleListResultV2;
    };
    "role:get": {
        input: AppRoleGetRequestV2;
        output: AppRoleGetResultV2;
    };
    "model:list": {
        input: undefined;
        output: AppModelListResultV2;
    };
    "app:capabilities": {
        input: AppAppCapabilitiesRequestV2 | undefined;
        output: AppAppCapabilitiesResultV2;
    };
    "media:generate": {
        input: AppMediaGenerateRequestV2;
        output: AppMediaGenerationResultV2;
    };
    "media:generate-image": {
        input: AppMediaGenerationRequestV2;
        output: AppMediaGenerationResultV2;
    };
    "media:generate-video": {
        input: AppMediaGenerationRequestV2;
        output: AppMediaGenerationResultV2;
    };
    "media:transcribe-audio": {
        input: AppTranscribeAudioRequestV2;
        output: AppTranscribeAudioResultV2;
    };
    "provider:media-providers": {
        input: AppMediaProvidersRequestV2 | undefined;
        output: AppMediaProvidersResultV2;
    };
    "provider:credentials": {
        input: AppProviderCredentialsRequestV2;
        output: AppProviderCredentialsResultV2;
    };
    "provider:models-by-type": {
        input: AppProviderModelsByTypeRequestV2;
        output: AppProviderModelsByTypeResultV2;
    };
    "provider:resolve-media-model": {
        input: AppResolveMediaModelRequestV2;
        output: AppResolveMediaModelResultV2;
    };
    "render:html-to-pdf": {
        input: AppRenderHtmlToPdfRequestV2;
        output: V2AppFileDeliveryResult;
    };
    "usage:list": {
        input: AppUsageListFilterV2 | undefined;
        output: AppUsageListResultV2;
    };
}
export type AppBusInput<V extends keyof AppBusRequests> = AppBusRequests[V]["input"];
export type AppBusOutput<V extends keyof AppBusRequests> = AppBusRequests[V]["output"];
/** Canonical names used by the SDK wrappers, tied to the typed verb map. */
export declare const APP_SDK_BUS_METHODS: {
    readonly sessions: {
        readonly create: "session:create";
        readonly get: "session:get";
        readonly send: "session:send";
        readonly update: "session:update";
        readonly abort: "session:abort";
        readonly history: "session:history";
        readonly tools: "session:tools";
        readonly getToolSelection: "session:tool-selection";
        readonly setActiveTools: "session:set-active-tools";
        readonly list: "session:list";
        readonly search: "session:search";
        readonly sendCustom: "session:send-custom";
        readonly appendEntry: "session:append-entry";
        readonly setEntryLabel: "session:set-entry-label";
        readonly getEntryLabel: "session:get-entry-label";
        readonly switchModel: "session:switch-model";
        readonly stageFile: "session:stage-file";
        readonly registerFile: "session:register-file";
        readonly archive: "session:archive";
        readonly restore: "session:restore";
        readonly delete: "session:delete";
        readonly fork: "session:fork";
        readonly compact: "session:compact";
        readonly context: "session:context";
        readonly entries: "session:entries";
    };
    readonly agents: {
        readonly createFromType: "agent:create-from-type";
        readonly createFromRole: "agent:create-from-role";
        readonly create: "agent:create";
        readonly list: "agent:list";
        readonly profile: "agent:profile";
        readonly config: "agent:config";
        readonly update: "agent:update";
        readonly updateConfig: "agent:update-config";
        readonly retire: "agent:retire";
        readonly purge: "agent:purge";
    };
    readonly roles: {
        readonly list: "role:list";
        readonly get: "role:get";
    };
    readonly models: {
        readonly listAvailable: "model:list";
    };
    readonly capabilities: {
        readonly get: "app:capabilities";
    };
    readonly media: {
        readonly generate: "media:generate";
        readonly generateImage: "media:generate-image";
        readonly generateVideo: "media:generate-video";
        readonly transcribeAudio: "media:transcribe-audio";
    };
    readonly providers: {
        readonly listMediaProviders: "provider:media-providers";
        readonly getCredentials: "provider:credentials";
        readonly listModelsByType: "provider:models-by-type";
        readonly resolveMediaModel: "provider:resolve-media-model";
    };
    readonly render: {
        readonly htmlToPdf: "render:html-to-pdf";
    };
    readonly usage: {
        readonly list: "usage:list";
    };
};
//# sourceMappingURL=bus-requests.d.ts.map