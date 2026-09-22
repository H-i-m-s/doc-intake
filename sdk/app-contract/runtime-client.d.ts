/**
 * app-contract/runtime-client.ts — generated from shared/app-contract/runtime-client.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Client for a Node managed runtime's private host IPC channel.
 *
 * This is intentionally Node-only: the channel is the parent-created IPC fd,
 * not HTTP and not a credential. A child process cannot select its App id;
 * the parent process that owns the fd binds every call to one App.
 */
import type { HanaPluginModelsV2 } from "./models.js";
import type { AppTasksV2 } from "./tasks.js";
import type { HanaPluginMediaTasksV2 } from "./media.js";
/** A JSON-only subset of the host's checked outbound request options. */
export type AppRuntimeNetworkInit = {
    readonly method?: string;
    readonly headers?: Record<string, string> | readonly [string, string][];
    readonly body?: string;
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
    readonly cacheTtlMs?: number;
};
/**
 * A managed child can invoke App-owned task operations, but it cannot
 * serialize a callback across IPC. Register handlers from the App entry.
 */
export type AppRuntimeTasksV2 = Omit<AppTasksV2, "registerHandler">;
export type AppRuntimeClient = {
    readonly tasks: AppRuntimeTasksV2;
    readonly models: HanaPluginModelsV2;
    readonly media: HanaPluginMediaTasksV2;
    readonly network: {
        fetch(url: string, init?: AppRuntimeNetworkInit): Promise<Response>;
    };
    close(): void;
};
/** Connect to the parent-owned IPC channel from inside `runtime: "node"` only. */
export declare function connectAppRuntime(): AppRuntimeClient;
//# sourceMappingURL=runtime-client.d.ts.map