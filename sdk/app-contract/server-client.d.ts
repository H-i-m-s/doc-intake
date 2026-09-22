/**
 * app-contract/server-client.ts — generated from shared/app-contract/server-client.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppEntryContext, AppEntryStorageScope } from "./entry-context.js";
import type { AppRegistration } from "./registration.js";
import type { AppHookEvent, AppHookWord, HanaPluginHookListenerV2, HanaPluginHookAdjudicatorV2, HanaPluginToolRegistrationV2, HanaPluginToolExecuteContextV2 } from "./context.js";
import type { AppServiceRequestOptionsV2 } from "./app-services.js";
import type { AppModelInferenceRequestV2, AppModelStreamEventV2 } from "./models.js";
import type { AppSpeechRecognitionProvidersResultV2 } from "./media.js";
import { APP_SDK_BUS_METHODS, type AppBusRequests, type AppBusInput, type AppBusOutput } from "./bus-requests.js";
import { type AppModelStreamOptions } from "./model-stream.js";
type AsyncDomain<T> = {
    readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : T[K];
};
export type AppBusRequestArguments<V extends keyof AppBusRequests> = undefined extends AppBusInput<V> ? [input?: Exclude<AppBusInput<V>, undefined>, options?: AppServiceRequestOptionsV2] : [input: AppBusInput<V>, options?: AppServiceRequestOptionsV2];
export type AppBusRequest = <V extends keyof AppBusRequests>(verb: V, ...args: AppBusRequestArguments<V>) => Promise<AppBusOutput<V>>;
type NamedOperations<M extends Record<string, keyof AppBusRequests>> = {
    readonly [K in keyof M]: (...args: AppBusRequestArguments<M[K]>) => Promise<AppBusOutput<M[K]>>;
};
type MethodMap = typeof APP_SDK_BUS_METHODS;
/** Tool arguments are application data plus a host-provided invocation context. */
export type AppToolArguments<T extends Record<string, unknown>> = T & {
    readonly context: HanaPluginToolExecuteContextV2;
};
export interface AppToolRegistration<T extends Record<string, unknown> = Record<string, unknown>> extends Omit<HanaPluginToolRegistrationV2, "execute" | "invocationStyle" | "isEnabledForAgentConfig" | "lane" | "metadata"> {
    readonly execute: (args: AppToolArguments<T>) => unknown | Promise<unknown>;
}
/** A client bound to the App entry supplied by the host, never to global focus. */
export interface AppSdk extends Omit<{
    readonly [K in keyof AppEntryContext]: AppEntryContext[K] extends object ? AsyncDomain<AppEntryContext[K]> : AppEntryContext[K];
}, "storage" | "bus" | "models" | "media" | "providers" | "tools" | "hooks"> {
    readonly sessions: NamedOperations<MethodMap["sessions"]>;
    readonly agents: NamedOperations<MethodMap["agents"]>;
    readonly roles: NamedOperations<MethodMap["roles"]>;
    readonly capabilities: NamedOperations<MethodMap["capabilities"]>;
    readonly usage: NamedOperations<MethodMap["usage"]>;
    readonly render: NamedOperations<MethodMap["render"]>;
    readonly storage: {
        readonly global: AsyncDomain<AppEntryStorageScope>;
        agent(agentId?: string): AsyncDomain<AppEntryStorageScope>;
    };
    readonly bus: Omit<AsyncDomain<AppEntryContext["bus"]>, "request"> & {
        readonly request: AppBusRequest;
        requestService(name: `app:${string}/${string}`, input?: unknown, options?: AppServiceRequestOptionsV2): Promise<unknown>;
    };
    readonly models: AsyncDomain<AppEntryContext["models"]> & NamedOperations<MethodMap["models"]> & {
        streamEvents(input: AppModelInferenceRequestV2, options?: AppModelStreamOptions): AsyncGenerator<AppModelStreamEventV2>;
    };
    readonly media: AsyncDomain<AppEntryContext["media"]> & NamedOperations<MethodMap["media"]>;
    readonly providers: AsyncDomain<AppEntryContext["providers"]> & NamedOperations<MethodMap["providers"]> & {
        /** Lists speech-recognition providers without asking callers to spell the capability selector. */
        listSpeechRecognitionProviders(options?: AppServiceRequestOptionsV2): Promise<AppSpeechRecognitionProvidersResultV2>;
    };
    readonly tools: Omit<AsyncDomain<AppEntryContext["tools"]>, "register"> & {
        register<T extends Record<string, unknown>>(tool: AppToolRegistration<T>): Promise<AppRegistration>;
    };
    readonly hooks: {
        on<E extends AppHookEvent>(event: E, listener: HanaPluginHookListenerV2<E>): Promise<AppRegistration>;
        onDecision<W extends AppHookWord>(word: W, adjudicator: HanaPluginHookAdjudicatorV2<W>): Promise<AppRegistration>;
    };
}
export declare function createAppSdk(context: AppEntryContext): AppSdk;
/** Export the resulting object as the App's default entry. */
export declare function defineApp(setup: (sdk: AppSdk) => void | Promise<void>): {
    apply(context: AppEntryContext): Promise<void>;
};
export {};
//# sourceMappingURL=server-client.d.ts.map