/**
 * app-contract/providers.ts — generated from shared/app-contract/providers.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Public, Pi-independent provider contract for v2 Apps. The host adapts this
 * structural surface to Pi's runtime Provider object; no credentials or
 * executable callbacks appear in the descriptor that crosses an App boundary.
 */
export type AppProviderJsonV2 = null | boolean | number | string | readonly AppProviderJsonV2[] | {
    readonly [key: string]: AppProviderJsonV2;
};
export type AppProviderCostRatesV2 = {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
};
export type AppProviderCostTierV2 = AppProviderCostRatesV2 & {
    readonly inputTokensAbove: number;
};
export type AppProviderModelCostV2 = AppProviderCostRatesV2 & {
    readonly tiers?: readonly AppProviderCostTierV2[];
};
export interface AppProviderModelV2 {
    readonly id: string;
    readonly provider?: string;
    readonly name: string;
    readonly api: string;
    readonly baseUrl: string;
    readonly reasoning: boolean;
    readonly input: readonly ("text" | "image")[];
    readonly contextWindow: number;
    readonly maxTokens: number;
    readonly cost: AppProviderModelCostV2;
    readonly compat?: Readonly<Record<string, AppProviderJsonV2>>;
    readonly samplingParams?: Readonly<Record<string, AppProviderJsonV2>>;
    readonly [key: string]: AppProviderJsonV2 | undefined;
}
export interface AppProviderApiKeyDescriptorV2 {
    readonly name: string;
    readonly login?: boolean;
    readonly check?: boolean;
    readonly optional?: boolean;
}
export interface AppProviderOAuthDescriptorV2 {
    readonly name: string;
    readonly isSubscription?: boolean;
    readonly loginLabel?: string;
}
export interface AppProviderDescriptorV2 {
    /** App-local id. The host constructs `app:<appId>:<id>`. */
    readonly id: string;
    readonly name: string;
    readonly models: readonly AppProviderModelV2[];
    readonly auth: {
        readonly apiKey?: AppProviderApiKeyDescriptorV2;
        readonly oauth?: AppProviderOAuthDescriptorV2;
    };
    readonly refreshModels?: boolean;
    readonly filterModels?: boolean;
    readonly fetchDeferred?: boolean;
    readonly cancelDeferred?: boolean;
}
export type AppProviderCredentialV2 = {
    readonly type: "api_key";
    readonly key?: string;
    readonly env?: Readonly<Record<string, string>>;
} | {
    readonly type: "oauth";
    readonly access: string;
    readonly refresh: string;
    readonly expires: number;
    readonly [key: string]: AppProviderJsonV2 | undefined;
};
export interface AppProviderModelAuthV2 {
    readonly apiKey?: string;
    readonly headers?: Readonly<Record<string, string | null>>;
    readonly baseUrl?: string;
}
/** Request options retain host callbacks in the in-process provider port. */
export interface AppProviderRequestOptionsV2 {
    readonly signal?: AbortSignal;
    readonly apiKey?: string;
    readonly headers?: Readonly<Record<string, string | null>>;
    readonly timeoutMs?: number;
    readonly maxRetries?: number;
    readonly fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    readonly onPayload?: (payload: unknown, model: AppProviderModelV2) => unknown | Promise<unknown>;
    readonly onResponse?: (response: {
        readonly status: number;
        readonly headers: Readonly<Record<string, string>>;
    }, model: AppProviderModelV2) => void | Promise<void>;
    readonly telemetryContext?: unknown;
    readonly [key: string]: unknown;
}
export interface AppProviderAuthResultV2 {
    readonly auth: AppProviderModelAuthV2;
    readonly env?: Readonly<Record<string, string>>;
    readonly source?: string;
}
export interface AppProviderAuthCheckV2 {
    readonly type: "api_key" | "oauth";
    readonly source?: string;
}
export interface AppProviderAuthContextV2 {
    env(name: string): Promise<string | undefined>;
    fileExists(path: string): Promise<boolean>;
}
export type AppProviderAuthEventV2 = {
    readonly type: "info";
    readonly message: string;
    readonly links?: readonly {
        readonly url: string;
        readonly label?: string;
    }[];
} | {
    readonly type: "auth_url";
    readonly url: string;
    readonly instructions?: string;
} | {
    readonly type: "device_code";
    readonly userCode: string;
    readonly verificationUri: string;
    readonly intervalSeconds?: number;
    readonly expiresInSeconds?: number;
} | {
    readonly type: "progress";
    readonly message: string;
};
export type AppProviderAuthPromptV2 = {
    readonly signal?: AbortSignal;
} & ({
    readonly type: "text" | "secret" | "manual_code";
    readonly message: string;
    readonly placeholder?: string;
} | {
    readonly type: "select";
    readonly message: string;
    readonly options: readonly {
        readonly id: string;
        readonly label: string;
        readonly description?: string;
    }[];
});
export interface AppProviderAuthInteractionV2 {
    readonly signal: AbortSignal;
    notify(event: AppProviderAuthEventV2): void;
    prompt(prompt: AppProviderAuthPromptV2): Promise<string>;
}
export interface AppProviderAssistantMessageV2 {
    readonly role: "assistant";
    readonly content: readonly AppProviderJsonV2[];
    readonly api: string;
    readonly provider: string;
    readonly model: string;
    readonly usage: Readonly<Record<string, AppProviderJsonV2>>;
    readonly stopReason: string;
    readonly timestamp: number;
    readonly errorMessage?: string;
    readonly [key: string]: AppProviderJsonV2 | undefined;
}
export type AppProviderStreamEventV2 = {
    readonly type: "start";
    readonly partial: AppProviderAssistantMessageV2;
} | {
    readonly type: "text_start" | "thinking_start" | "toolcall_start";
    readonly contentIndex: number;
    readonly partial: AppProviderAssistantMessageV2;
} | {
    readonly type: "text_delta" | "thinking_delta" | "toolcall_delta";
    readonly contentIndex: number;
    readonly delta: string;
    readonly partial: AppProviderAssistantMessageV2;
} | {
    readonly type: "text_end" | "thinking_end";
    readonly contentIndex: number;
    readonly content: string;
    readonly partial: AppProviderAssistantMessageV2;
} | {
    readonly type: "toolcall_end";
    readonly contentIndex: number;
    readonly toolCall: AppProviderJsonV2;
    readonly partial: AppProviderAssistantMessageV2;
} | {
    readonly type: "done";
    readonly reason: "stop" | "length" | "toolUse" | "deferred";
    readonly message: AppProviderAssistantMessageV2;
} | {
    readonly type: "error";
    readonly reason: "aborted" | "error";
    readonly error: AppProviderAssistantMessageV2;
};
export interface AppProviderRefreshResultV2 {
    readonly models: readonly AppProviderModelV2[];
    readonly persist?: false | null | {
        readonly lastModified?: number;
        readonly checkedAt?: number;
        readonly etag?: string;
    };
}
export interface AppProviderRefreshInputV2 {
    readonly credential?: AppProviderCredentialV2;
    readonly stored?: Readonly<Record<string, AppProviderJsonV2>>;
    readonly allowNetwork: boolean;
    readonly force?: boolean;
    readonly signal: AbortSignal;
}
export interface AppNativeProviderV2 {
    readonly name: string;
    readonly models: readonly AppProviderModelV2[];
    readonly auth: {
        readonly apiKey?: {
            readonly login?: (interaction: AppProviderAuthInteractionV2) => Promise<AppProviderCredentialV2>;
            readonly check?: (input: {
                readonly ctx: AppProviderAuthContextV2;
                readonly credential?: AppProviderCredentialV2;
                readonly signal: AbortSignal;
            }) => Promise<AppProviderAuthCheckV2 | undefined>;
            readonly resolve: (input: {
                readonly ctx: AppProviderAuthContextV2;
                readonly credential?: AppProviderCredentialV2;
                readonly signal: AbortSignal;
            }) => Promise<AppProviderAuthResultV2 | undefined>;
        };
        readonly oauth?: {
            readonly login: (interaction: AppProviderAuthInteractionV2) => Promise<AppProviderCredentialV2>;
            readonly refresh: (credential: AppProviderCredentialV2, signal: AbortSignal) => Promise<AppProviderCredentialV2>;
            readonly toAuth: (credential: AppProviderCredentialV2) => Promise<AppProviderModelAuthV2>;
        };
    };
    stream(model: AppProviderModelV2, context: AppProviderJsonV2, options?: AppProviderRequestOptionsV2): AsyncIterable<AppProviderStreamEventV2> | Promise<AsyncIterable<AppProviderStreamEventV2>>;
    streamSimple(model: AppProviderModelV2, context: AppProviderJsonV2, options?: AppProviderRequestOptionsV2): AsyncIterable<AppProviderStreamEventV2> | Promise<AsyncIterable<AppProviderStreamEventV2>>;
    refreshModels?: (input: AppProviderRefreshInputV2) => Promise<AppProviderRefreshResultV2 | undefined>;
    filterModels?: (models: readonly AppProviderModelV2[], credential?: AppProviderCredentialV2, signal?: AbortSignal) => Promise<readonly AppProviderModelV2[]> | readonly AppProviderModelV2[];
    fetchDeferred?: (model: AppProviderModelV2, handle: AppProviderJsonV2, options?: AppProviderRequestOptionsV2) => AsyncIterable<AppProviderStreamEventV2> | Promise<AsyncIterable<AppProviderStreamEventV2>>;
    cancelDeferred?: (model: AppProviderModelV2, handle: AppProviderJsonV2, options?: AppProviderRequestOptionsV2) => Promise<void>;
}
export interface HanaAppProvidersV2 {
    register(descriptor: AppProviderDescriptorV2, implementation: AppNativeProviderV2): Promise<{
        readonly providerId: string;
    }>;
    unregister(localId: string): Promise<void>;
}
export declare const APP_PROVIDER_DESCRIPTOR_MAX_MODELS = 10000;
export declare const APP_PROVIDER_DESCRIPTOR_MAX_BYTES: number;
/** Validate and clone descriptor data, assigning the host's canonical provider id to every model. */
export declare function validateAppProviderDescriptorV2(value: unknown, canonicalProviderId: string): AppProviderDescriptorV2;
/** Verify that callback-bearing implementation matches its JSON declaration. */
export declare function validateAppNativeProviderImplementationV2(descriptor: AppProviderDescriptorV2, implementation: unknown): AppNativeProviderV2;
//# sourceMappingURL=providers.d.ts.map