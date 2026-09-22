/**
 * app-contract/models.ts — generated from shared/app-contract/models.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Public v2 App contract for host-provided model inference.
 *
 * Apps select a model from the host's public catalog and send conversation
 * state through this contract. Provider credentials, endpoints, headers and
 * transport configuration are deliberately absent: Hana keeps those in its
 * shared model runtime.
 */
/** Grant required before an App can read the model catalog or invoke a model. */
export declare const APP_MODELS_CAPABILITY: "app/models.infer";
export type AppModelTextContentV2 = {
    readonly type: "text";
    readonly text: string;
    /** Opaque provider continuity value returned by a prior model response. */
    readonly textSignature?: string;
};
/** Base64-encoded image bytes. Remote URLs and filesystem paths are not accepted. */
export type AppModelImageContentV2 = {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
};
/** An assistant tool call that the App will execute itself. */
export type AppModelToolCallContentV2 = {
    readonly type: "toolCall";
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    /** Provider tool namespace for dynamically loaded or namespaced tools. */
    readonly namespace?: string;
    /** Opaque provider continuity value returned by a prior model response. */
    readonly thoughtSignature?: string;
};
/** Reasoning from a prior assistant turn, preserved for providers that need it for replay. */
export type AppModelReasoningContentV2 = {
    readonly type: "reasoning";
    readonly reasoning: string;
    /** Opaque provider continuity value returned by a prior model response. */
    readonly signature?: string;
    readonly redacted?: boolean;
};
export type AppModelInputContentV2 = AppModelTextContentV2 | AppModelImageContentV2;
export type AppModelAssistantContentV2 = AppModelTextContentV2 | AppModelReasoningContentV2 | AppModelToolCallContentV2;
export type AppModelUserMessageV2 = {
    readonly role: "user";
    readonly content: string | readonly AppModelInputContentV2[];
};
export type AppModelAssistantMessageV2 = {
    readonly role: "assistant";
    readonly content: readonly AppModelAssistantContentV2[];
};
/** A result produced by the App's own tool loop and supplied on the next turn. */
export type AppModelToolResultMessageV2 = {
    readonly role: "toolResult";
    readonly toolCallId: string;
    readonly toolName: string;
    readonly content: readonly AppModelInputContentV2[];
    readonly details?: unknown;
    readonly isError: boolean;
};
export type AppModelMessageV2 = AppModelUserMessageV2 | AppModelAssistantMessageV2 | AppModelToolResultMessageV2;
/** JSON Schema tool declaration. Hana never executes these tools. */
export type AppModelToolV2 = {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
};
/**
 * One explicit, cancellable inference request. `requestId` is supplied by the
 * App so a later `cancel(requestId)` can only address that App's own stream.
 */
export interface AppModelInferenceRequestV2 {
    readonly requestId: string;
    readonly provider: string;
    readonly model: string;
    readonly messages: readonly AppModelMessageV2[];
    readonly systemPrompt?: string;
    readonly tools?: readonly AppModelToolV2[];
    readonly reasoningEffort?: string;
    readonly maxTokens?: number;
    readonly temperature?: number;
    /** A short-lived token from the App tool invocation that initiated this request. */
    readonly callToken?: string;
    /** A durable task owned by this App. The host validates ownership before use. */
    readonly taskId?: string;
}
/** A JSON-only message accepted by the host utility text call. */
export type AppModelUtilityMessageV2 = {
    readonly role: "user" | "assistant" | "system" | string;
    readonly content: string | readonly {
        readonly type: "text";
        readonly text: string;
    }[];
};
/**
 * One cancellable call to Hana's configured auxiliary text model.
 *
 * Apps cannot select a provider or model here. `scope: "app"` uses the
 * host-wide auxiliary configuration and is mutually exclusive with a tool
 * call token or durable task identity.
 */
export interface AppModelUtilityRequestV2 {
    readonly requestId: string;
    readonly scope?: "app";
    readonly messages: readonly AppModelUtilityMessageV2[];
    readonly systemPrompt?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly callToken?: string;
    readonly taskId?: string;
}
export type AppModelUtilityResultV2 = {
    readonly requestId: string;
    readonly text: string;
};
export type AppModelUsageV2 = {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly cacheWrite1h?: number;
    readonly reasoning?: number;
    readonly totalTokens: number;
    readonly cost?: {
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheWrite: number;
        readonly total: number;
    };
};
/** One line in the NDJSON body returned by `ctx.models.stream()`. */
export type AppModelStreamEventV2 = {
    readonly type: "start";
    readonly requestId: string;
} | {
    readonly type: "text-delta";
    readonly requestId: string;
    readonly delta: string;
} | {
    readonly type: "reasoning-delta";
    readonly requestId: string;
    readonly delta: string;
} | {
    readonly type: "tool-call";
    readonly requestId: string;
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly namespace?: string;
    readonly thoughtSignature?: string;
} | {
    readonly type: "done";
    readonly requestId: string;
    readonly stopReason: "stop" | "length" | "toolUse" | "deferred";
    /** Canonical replayable assistant turn, including opaque continuity signatures. */
    readonly assistant: AppModelAssistantMessageV2;
    readonly usage?: AppModelUsageV2;
} | {
    readonly type: "error";
    readonly requestId: string;
    readonly code: string;
    readonly message: string;
};
/** Public catalog data is the host's existing credential-free model projection. */
export type AppModelInfoV2 = Record<string, unknown>;
export interface HanaPluginModelsV2 {
    readonly list: () => Promise<{
        readonly models: readonly AppModelInfoV2[];
    }>;
    readonly stream: (request: AppModelInferenceRequestV2) => Promise<Response>;
    readonly utility: (request: AppModelUtilityRequestV2) => Promise<AppModelUtilityResultV2>;
    readonly cancel: (requestId: string) => Promise<void>;
}
export declare const HANA_PLUGIN_MODELS_V2_MEMBERS: readonly string[];
//# sourceMappingURL=models.d.ts.map