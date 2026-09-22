/**
 * app-contract/media.ts — generated from shared/app-contract/media.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppMediaCapability } from "../app-media-capabilities.js";
import type { HanaPluginContextV2 } from "./context.js";
export type AppMediaTaskScopeV2 = "own" | "all";
export type AppMediaTaskFilterV2 = "favorited" | "images" | "videos";
export interface AppMediaSessionFileV2 {
    readonly fileId: string | null;
    readonly name: string | null;
    readonly mime: string | null;
    readonly size: number | null;
}
export interface AppMediaTaskV2 {
    readonly taskId: string;
    readonly ownerAppId: string | null;
    readonly adapterId: string | null;
    readonly providerId: string | null;
    readonly modelId: string | null;
    readonly protocolId: string | null;
    readonly batchId: string | null;
    readonly type: string | null;
    readonly prompt: string | null;
    readonly status: string | null;
    readonly favorited: boolean;
    readonly createdAt: string | null;
    readonly completedAt: string | null;
    readonly failReason: string | null;
    readonly retryCount: number;
    readonly deliveryMode: string | null;
    readonly sessionId: string | null;
    readonly agentId: string | null;
    readonly files: readonly string[];
    readonly sessionFiles: readonly AppMediaSessionFileV2[];
}
export interface AppMediaListTasksOptionsV2 {
    readonly scope?: AppMediaTaskScopeV2;
    readonly adapterId?: string;
    readonly batchId?: string;
    readonly status?: string;
    readonly filter?: AppMediaTaskFilterV2;
}
export interface AppMediaTaskOptionsV2 {
    readonly scope?: AppMediaTaskScopeV2;
}
export interface AppMediaTaskResourceV2 {
    readonly name: string;
    readonly resource: {
        readonly kind: "local-file";
        readonly path: string;
    } | {
        readonly kind: "session-file";
        readonly fileId: string;
        readonly sessionId: string;
    };
}
export interface AppMediaAdapterV2 {
    readonly id: string;
    readonly name: string | null;
    readonly types: readonly string[];
    readonly ownerAppId: string | null;
}
export type AppMediaModelCapabilityV2 = "image_generation" | "video_generation" | "speech_recognition";
export type AppMediaModelV2 = Record<string, unknown>;
/** A session file supplied through the current tool invocation. */
export interface AppSessionAudioTranscriptionRequestV2 {
    readonly callToken: string;
    readonly input: {
        readonly fileId: string;
        readonly language?: string;
        readonly providerId?: string;
        readonly modelId?: string;
    };
}
/** An App-owned local audio file. Its path must remain inside `ctx.dataDir`. */
export interface AppLocalAudioTranscriptionRequestV2 {
    readonly scope: "app";
    readonly input: {
        readonly kind?: "audio";
        readonly audio: {
            readonly kind: "local-file";
            readonly path: string;
        };
        readonly language?: string;
        readonly providerId?: string;
        readonly modelId?: string;
    };
}
export type AppTranscribeAudioRequestV2 = AppSessionAudioTranscriptionRequestV2 | AppLocalAudioTranscriptionRequestV2;
export interface AppReadyAudioTranscriptionV2 {
    readonly status: "ready";
    readonly text: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly protocolId: string;
    readonly language?: string;
    readonly durationMs?: number;
}
export interface AppFailedAudioTranscriptionV2 {
    readonly status: "failed";
    readonly providerId: string;
    readonly modelId: string;
    readonly protocolId: string;
    readonly language?: string;
    readonly error: string;
}
/**
 * A completed bus request. A `failed` transcription is a completed request,
 * not a successful transcription; callers must branch on `status`.
 */
export interface AppTranscribeAudioResultV2 {
    readonly ok: true;
    readonly transcription: AppReadyAudioTranscriptionV2 | AppFailedAudioTranscriptionV2;
}
export interface AppMediaProviderModelV2 {
    readonly id: string;
    readonly name: string;
    readonly displayName: string;
    readonly protocolId?: string;
    readonly credentialLaneId?: string;
    readonly [key: string]: unknown;
}
export interface AppMediaProviderV2 {
    readonly providerId: string;
    readonly displayName: string;
    readonly models: readonly AppMediaProviderModelV2[];
    readonly hasCredentials: boolean;
    readonly unavailableReason?: string | null;
    readonly source?: Readonly<Record<string, unknown>>;
    readonly [key: string]: unknown;
}
export interface AppMediaProviderSelectionV2 {
    readonly defaultConfigured: boolean;
    readonly selectionPolicy: "configured_default" | "first_available_fallback" | "explicit_required";
    readonly overrideRequired: boolean;
    readonly defaultInvocation: {
        readonly provider: "omit" | "required";
        readonly model: "omit" | "required";
        readonly mode: "omit_unless_needed" | "not_applicable";
        readonly options: "omit_unless_needed" | "not_applicable";
    };
    readonly instruction: string;
}
/** The precise response projection from `provider:media-providers`. */
export interface AppSpeechRecognitionProvidersResultV2 {
    readonly providers: Readonly<Record<string, AppMediaProviderV2>>;
    readonly selection: AppMediaProviderSelectionV2;
}
/**
 * Transcribe a session file from the current tool call or an App-owned local
 * audio file. The host enforces the media grant and both file-ownership paths.
 */
export declare function transcribeAudio(ctx: Pick<HanaPluginContextV2, "bus">, payload: AppTranscribeAudioRequestV2): Promise<AppTranscribeAudioResultV2>;
/** Read speech-recognition providers and their public model metadata. */
export declare function listSpeechRecognitionProviders(ctx: Pick<HanaPluginContextV2, "bus">): Promise<AppSpeechRecognitionProvidersResultV2>;
export declare const APP_MEDIA_BULK_CLEANUP_PARTIAL: "APP_MEDIA_BULK_CLEANUP_PARTIAL";
export interface AppMediaBulkCleanupFailureV2 {
    readonly code: typeof APP_MEDIA_BULK_CLEANUP_PARTIAL;
    readonly details: {
        readonly removedTaskIds: readonly string[];
        readonly failedTaskId: string;
    };
}
export interface HanaPluginMediaTasksV2 {
    listTasks(options?: AppMediaListTasksOptionsV2): Promise<{
        readonly tasks: readonly AppMediaTaskV2[];
    }>;
    getTask(taskId: string, options?: AppMediaTaskOptionsV2): Promise<AppMediaTaskV2 | null>;
    getTaskResources(taskId: string, options?: AppMediaTaskOptionsV2): Promise<{
        readonly resources: readonly AppMediaTaskResourceV2[];
    }>;
    updateTask(taskId: string, patch: {
        readonly favorited: boolean;
    }, options?: AppMediaTaskOptionsV2): Promise<AppMediaTaskV2>;
    cancelTask(taskId: string, options?: AppMediaTaskOptionsV2): Promise<AppMediaTaskV2>;
    retryTask(taskId: string, options?: AppMediaTaskOptionsV2): Promise<AppMediaTaskV2>;
    removeTask(taskId: string, options?: AppMediaTaskOptionsV2): Promise<{
        readonly removed: boolean;
    }>;
    removeUnfavorited(options?: AppMediaTaskOptionsV2): Promise<{
        readonly removed: number;
        readonly taskIds: readonly string[];
    }>;
    listAdapters(): Promise<{
        readonly adapters: readonly AppMediaAdapterV2[];
    }>;
    addModel(providerId: string, capability: AppMediaModelCapabilityV2, model: AppMediaModelV2): Promise<void>;
    updateModel(providerId: string, capability: AppMediaModelCapabilityV2, modelId: string, patch: AppMediaModelV2): Promise<void>;
    removeModel(providerId: string, capability: AppMediaModelCapabilityV2, modelId: string): Promise<void>;
}
export type { AppMediaCapability };
//# sourceMappingURL=media.d.ts.map