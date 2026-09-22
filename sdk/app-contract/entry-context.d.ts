/**
 * app-contract/entry-context.ts — generated from shared/app-contract/entry-context.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { HanaPluginContextV2, HanaPluginConfigV2, HanaPluginStorageScopeV2, HanaPluginToolsV2, HanaPluginCommandsV2, HanaPluginBusV2, HanaPluginLoggerV2, HanaPluginInputBannerV2, HanaPluginAppEventsV2, HanaPluginRoutesV2, V2AppResources, AppHookEvent, AppHookWord, HanaPluginHookListenerV2, HanaPluginHookAdjudicatorV2 } from "./context.js";
import type { AppRegistration, AppResourceWatchRegistration } from "./registration.js";
type AsyncOperation<F> = F extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
type AsyncOperations<T> = {
    readonly [K in keyof T]: AsyncOperation<T[K]>;
};
type RegistrationOperation<F> = F extends (...args: infer A) => unknown ? (...args: A) => AppRegistration : never;
/**
 * The context delivered to an isolated v2 App entry. Host services keep their
 * own synchronous contract; operations crossing the App boundary are awaited.
 */
export interface AppEntryContext extends Omit<HanaPluginContextV2, "config" | "storage" | "tools" | "commands" | "bus" | "logger" | "inputBanner" | "appEvents" | "routes" | "resources" | "hooks" | "shortcuts" | "messageRenderers" | "tasks" | "windows"> {
    readonly windows: Omit<HanaPluginContextV2["windows"], "handleMessages" | "onEvent"> & {
        readonly handleMessages: RegistrationOperation<HanaPluginContextV2["windows"]["handleMessages"]>;
        readonly onEvent: RegistrationOperation<HanaPluginContextV2["windows"]["onEvent"]>;
    };
    readonly config: AsyncOperations<HanaPluginConfigV2>;
    readonly logger: AsyncOperations<HanaPluginLoggerV2>;
    readonly inputBanner: AsyncOperations<HanaPluginInputBannerV2>;
    readonly appEvents: AsyncOperations<HanaPluginAppEventsV2>;
    readonly tools: Omit<HanaPluginToolsV2, "register" | "listOwn"> & {
        readonly register: RegistrationOperation<HanaPluginToolsV2["register"]>;
        readonly listOwn: AsyncOperation<HanaPluginToolsV2["listOwn"]>;
    };
    readonly commands: Omit<HanaPluginCommandsV2, "register" | "listOwn"> & {
        readonly register: RegistrationOperation<HanaPluginCommandsV2["register"]>;
        readonly listOwn: AsyncOperation<HanaPluginCommandsV2["listOwn"]>;
    };
    readonly bus: Omit<HanaPluginBusV2, "emit" | "subscribe" | "handle" | "hasHandler" | "getCapability" | "listCapabilities"> & {
        readonly emit: AsyncOperation<HanaPluginBusV2["emit"]>;
        readonly subscribe: RegistrationOperation<HanaPluginBusV2["subscribe"]>;
        readonly handle: RegistrationOperation<HanaPluginBusV2["handle"]>;
        readonly hasHandler: AsyncOperation<HanaPluginBusV2["hasHandler"]>;
        readonly getCapability: AsyncOperation<HanaPluginBusV2["getCapability"]>;
        readonly listCapabilities: AsyncOperation<HanaPluginBusV2["listCapabilities"]>;
    };
    readonly routes: {
        readonly register: RegistrationOperation<HanaPluginRoutesV2["register"]>;
    };
    readonly storage: {
        readonly global: AppEntryStorageScope;
        readonly agent: (agentId?: string) => AppEntryStorageScope;
    };
    readonly resources: AsyncOperations<Omit<V2AppResources, "watch" | "subscribe" | "resolveWatchTarget">> & {
        readonly watch: (...args: Parameters<V2AppResources["watch"]>) => AppResourceWatchRegistration;
        readonly subscribe: (...args: Parameters<V2AppResources["subscribe"]>) => AppResourceWatchRegistration;
        readonly resolveWatchTarget: AsyncOperation<V2AppResources["resolveWatchTarget"]>;
    };
    readonly hooks: {
        readonly on: <E extends AppHookEvent>(event: E, listener: HanaPluginHookListenerV2<E>) => AppRegistration;
        readonly onDecision: <W extends AppHookWord>(word: W, adjudicator: HanaPluginHookAdjudicatorV2<W>) => AppRegistration;
    };
    readonly shortcuts: {
        readonly register: RegistrationOperation<HanaPluginContextV2["shortcuts"]["register"]>;
    };
    readonly messageRenderers: {
        readonly register: RegistrationOperation<HanaPluginContextV2["messageRenderers"]["register"]>;
    };
    readonly tasks: Omit<HanaPluginContextV2["tasks"], "registerHandler"> & {
        readonly registerHandler: (...args: Parameters<HanaPluginContextV2["tasks"]["registerHandler"]>) => Promise<AppRegistration>;
    };
}
/** A scoped bucket is local; reading and changing its values crosses IPC. */
export interface AppEntryStorageScope extends AsyncOperations<Omit<HanaPluginStorageScopeV2, "onChanged">> {
    readonly onChanged: RegistrationOperation<HanaPluginStorageScopeV2["onChanged"]>;
}
export {};
//# sourceMappingURL=entry-context.d.ts.map