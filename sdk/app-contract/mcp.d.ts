/**
 * app-contract/mcp.ts — generated from shared/app-contract/mcp.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** App-facing management of persisted MCP connector configuration. */
export type AppMcpScopeV2 = "own" | "all";
export type AppMcpOwnerV2 = {
    readonly kind: "app";
    readonly appId: string;
    readonly childId: string;
};
/**
 * A safe connector projection. Credentials stay masked; `env` and `headers`
 * retain non-credential values so an App can manage its own configuration.
 */
export interface AppMcpConnectorV2 {
    readonly connectorId: string;
    readonly id: string;
    readonly owner: AppMcpOwnerV2 | null;
    readonly name: string;
    readonly description: string;
    readonly transport: string;
    readonly url: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly headers: Readonly<Record<string, string>>;
    readonly registryUrl: string;
    readonly timeout: number;
    readonly autoReconnect: boolean;
    readonly enabled: boolean;
    readonly permissionMode: string;
    readonly toolPermissions: Readonly<Record<string, string>>;
    readonly pinnedTools: Readonly<Record<string, boolean>>;
    readonly trustReadOnlyHint: boolean;
    readonly authType: string;
    readonly authorizationToken: string;
    readonly oauthClientId: string;
    readonly oauthClientSecret: string;
    readonly status?: string;
    readonly error?: string;
    readonly authStatus?: string;
    readonly tools?: readonly unknown[];
}
export type AppMcpTargetV2 = {
    readonly scope?: "own";
    readonly childId: string;
} | {
    readonly scope: "all";
    readonly connectorId: string;
};
export interface AppMcpListInputV2 {
    readonly scope?: AppMcpScopeV2;
    readonly ownerAppId?: string;
}
export type AppMcpConnectorPatchV2 = Partial<Pick<AppMcpConnectorV2, "name" | "description" | "transport" | "url" | "command" | "args" | "cwd" | "env" | "headers" | "registryUrl" | "timeout" | "autoReconnect" | "authType" | "authorizationToken" | "oauthClientId" | "oauthClientSecret" | "permissionMode" | "toolPermissions" | "pinnedTools" | "trustReadOnlyHint">>;
export interface HanaPluginMcpV2 {
    list(input?: AppMcpListInputV2): Promise<{
        connectors: readonly AppMcpConnectorV2[];
    }>;
    get(target: AppMcpTargetV2): Promise<{
        connector: AppMcpConnectorV2;
    }>;
    update(input: AppMcpTargetV2 & {
        readonly patch: AppMcpConnectorPatchV2;
    }): Promise<{
        connector: AppMcpConnectorV2;
    }>;
    setEnabled(input: AppMcpTargetV2 & {
        readonly enabled: boolean;
    }): Promise<{
        connector: AppMcpConnectorV2;
    }>;
    removeData(target: AppMcpTargetV2): Promise<{
        ok: true;
    }>;
}
export declare const HANA_PLUGIN_MCP_V2_MEMBERS: readonly string[];
//# sourceMappingURL=mcp.d.ts.map