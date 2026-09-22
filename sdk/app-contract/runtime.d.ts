/**
 * app-contract/runtime.ts — generated from shared/app-contract/runtime.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * The public contract for an App-owned external runtime.
 *
 * The host validates the executable, requested profile and permissions before
 * launch. Scoped execution constrains reads; explicit native execution permits
 * user-readable files while retaining platform write constraints. Apps never
 * receive a host process handle or arbitrary inherited host environment.
 */
export type AppRuntimeCapability = "app/runtime.execute" | "app/runtime.network" | "app/runtime.native" | "app/runtime.local-machine";
/** Required before an App may start any managed external runtime. */
export declare const APP_RUNTIME_CAPABILITY: AppRuntimeCapability;
/** Required in addition to execute for an explicit external network request. */
export declare const APP_RUNTIME_NETWORK_CAPABILITY: AppRuntimeCapability;
/** Explicit native execution: user-readable files, native code and externally connected programs. */
export declare const APP_RUNTIME_NATIVE_CAPABILITY: AppRuntimeCapability;
/** Explicit user-authorized local-machine execution without filesystem isolation. */
export declare const APP_RUNTIME_LOCAL_MACHINE_CAPABILITY: AppRuntimeCapability;
export declare const APP_RUNTIME_CAPABILITY_WORDS: readonly AppRuntimeCapability[];
/** Native is the common cross-platform profile; scoped retains strict confinement where supported. */
export type HanaPluginRuntimeProfileV2 = "scoped" | "native" | "local-machine";
export type HanaPluginRuntimeNetworkV2 = "none" | "loopback" | "external";
export type HanaPluginRuntimeKindV2 = "node" | "command";
export type HanaPluginRuntimeStateV2 = "starting" | "ready" | "stopping" | "exited" | "failed" | "stopped";
/**
 * `service` is an explicit declaration, never a port a child printed and the
 * host guessed. A proxy may be exposed only after the exact ready marker has
 * appeared on stdout and only for this registered loopback port.
 */
export interface HanaPluginRuntimeServiceV2 {
    readonly port: number;
    readonly readyMarker: string;
}
export interface HanaPluginRuntimeStartInputV2 {
    readonly runtime: HanaPluginRuntimeKindV2;
    /** Defaults to scoped. Native and local-machine require their separate grant and explicit external networking on every OS. */
    readonly profile?: HanaPluginRuntimeProfileV2;
    /** A relative install path, or an absolute path still inside this App's install/data directory, when `runtime` is `node`. */
    readonly entry?: string;
    /** An explicit executable path when `runtime` is `command`. */
    readonly command?: string;
    readonly args?: readonly string[];
    /** A host-authorized working directory. Omitted means this App's data directory. */
    readonly cwd?: string;
    /** Additional existing absolute directories (max 64). Outside implicit App/session roots, requires app/resources.read. Protected Hana data roots are refused. */
    readonly readRoots?: readonly string[];
    /** Additional existing absolute directories (max 64). Outside implicit App/session roots, requires app/resources.write. Protected Hana data and App installation roots are refused. */
    readonly writeRoots?: readonly string[];
    /** A short-lived host-minted tool-call token used only to resolve existing session scope. */
    readonly callToken?: string;
    /** An App-owned durable task whose stamped session may resolve existing scope. */
    readonly taskId?: string;
    /** Defaults to `none`; `external` requires the separate app/runtime.network grant. */
    readonly network?: HanaPluginRuntimeNetworkV2;
    readonly service?: HanaPluginRuntimeServiceV2;
}
export interface HanaPluginRuntimeServiceStatusV2 {
    readonly port: number;
    readonly state: "pending" | "ready" | "unavailable";
}
export interface HanaPluginRuntimeInfoV2 {
    readonly runtimeId: string;
    readonly state: HanaPluginRuntimeStateV2;
    readonly runtime: HanaPluginRuntimeKindV2;
    readonly startedAt: string;
    readonly endedAt?: string;
    readonly exitCode?: number | null;
    readonly signal?: string | null;
    readonly profile: HanaPluginRuntimeProfileV2;
    /** Enforcement of the declared profile; local-machine intentionally has no filesystem isolation. */
    readonly enforcement: "full" | "partial" | "none";
    readonly backend: string;
    readonly network: HanaPluginRuntimeNetworkV2;
    readonly service?: HanaPluginRuntimeServiceStatusV2;
    readonly logBytes: number;
    readonly logTruncated: boolean;
}
/**
 * A bounded request to this App's own ready managed service. The host fixes
 * the origin to the registered loopback port. The caller cannot select an
 * origin or port, so this is not an arbitrary local-network fetch capability.
 */
export interface HanaPluginRuntimeFetchInitV2 {
    readonly method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
    readonly headers?: Readonly<Record<string, string>>;
    /** UTF-8 request payload, limited to 1 MiB. */
    readonly body?: string;
    /** Integer milliseconds from 1 through 30000; defaults to 30000. */
    readonly timeoutMs?: number;
}
/**
 * The response body is newline-delimited JSON records of `{type, runtime}` or
 * `{type:"log", runtimeId, stream, text}`. It is bounded; slow readers receive
 * the latest status and terminal record rather than an unbounded log backlog.
 */
export interface HanaPluginManagedRuntimeV2 {
    start(input: HanaPluginRuntimeStartInputV2): Promise<HanaPluginRuntimeInfoV2>;
    /** Active runtimes and the latest 64 terminal records for this App service lifetime. */
    list(): Promise<readonly HanaPluginRuntimeInfoV2[]>;
    /** Null for unknown runtimes or terminal records evicted from the retained history. */
    get(runtimeId: string): Promise<HanaPluginRuntimeInfoV2 | null>;
    stop(runtimeId: string): Promise<HanaPluginRuntimeInfoV2>;
    watch(runtimeId: string): Promise<Response>;
    /**
     * Calls only this App's ready registered service at a safe relative path.
     * Redirects are returned unchanged; request and response bodies are bounded.
     */
    fetch(runtimeId: string, path: string, init?: HanaPluginRuntimeFetchInitV2): Promise<Response>;
}
//# sourceMappingURL=runtime.d.ts.map