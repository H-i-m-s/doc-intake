/**
 * app-contract/surfaces.ts — generated from shared/app-contract/surfaces.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** A view of one declared UI contribution in an App-owned isolated instance. */
import type { AppWorkspaceCommand, AppWorkspaceConfiguration, AppWorkspaceResult } from './workspace.js';
export type { HanaPanelProps, HanaPanelSection } from "../plugin-panel-descriptor.js";
export type AppSurfaceSlot = "card" | "settings" | "function-panel" | "slot";
interface AppSurfaceHandleBase {
    readonly surfaceId: string;
    readonly revision: number;
    readonly windowId: string;
    readonly appId: string;
    readonly cardInstanceId: string;
    readonly definitionId: string;
    readonly slot: AppSurfaceSlot;
    readonly kind: "iframe" | "schema";
    readonly title: string;
}
export type AppSurfaceHandle = AppSurfaceHandleBase & ({
    readonly instanceId: string;
    readonly environmentId?: never;
} | {
    readonly environmentId: string;
    readonly instanceId?: never;
});
export interface AppSurfaceTarget {
    readonly callToken?: string;
    readonly surfaceId: string;
}
/** A host-rendered view of an isolated environment. No runtime credential is exposed. */
export interface AppHostSurfaceHandle {
    readonly surfaceId: string;
    readonly revision: number;
    readonly windowId: string;
    readonly environmentId: string;
    readonly kind: "host";
    readonly slot: "chat" | "preview" | "workspace";
    /** Active environment conversation; never a parent-host session or file locator. */
    readonly sessionId?: string;
    readonly agentId?: string;
    readonly title: string;
}
export type AppViewHandle = AppSurfaceHandle | AppHostSurfaceHandle;
export type AppHostSurfaceOpen = {
    readonly callToken?: string;
    readonly environmentId: string;
    readonly revision: number;
    readonly windowId: string;
} & ({
    readonly slot: "chat";
    readonly sessionId?: string;
    readonly agentId?: string;
} | {
    readonly slot: "preview";
    readonly filePath?: string;
    readonly source?: never;
} | {
    readonly slot: "preview";
    readonly source: {
        readonly kind: "local-file";
        readonly path: string;
    };
    readonly filePath?: never;
} | {
    readonly slot: "workspace";
    readonly configuration: AppWorkspaceConfiguration;
});
type AppSurfaceOpenBase = {
    readonly callToken?: string;
    readonly revision: number;
    readonly windowId: string;
    readonly appId?: string;
    readonly definitionId: string;
    readonly slot?: AppSurfaceSlot;
    readonly parentSurfaceId?: string;
    readonly detached?: boolean;
};
export interface AppSurfaces {
    open(input: (AppSurfaceOpenBase & {
        readonly instanceId: string;
        readonly environmentId?: never;
    }) | (AppSurfaceOpenBase & {
        readonly environmentId: string;
        readonly appId: string;
        readonly instanceId?: never;
    })): Promise<AppSurfaceHandle>;
    openHost(input: AppHostSurfaceOpen): Promise<AppHostSurfaceHandle>;
    get(input: AppSurfaceTarget): Promise<AppViewHandle>;
    move(input: AppSurfaceTarget & {
        readonly windowId: string;
        readonly detached?: boolean;
    }): Promise<AppViewHandle>;
    close(input: AppSurfaceTarget): Promise<{
        readonly closed: true;
    }>;
    workspace(input: AppSurfaceTarget & {
        readonly command: AppWorkspaceCommand;
    }): Promise<AppWorkspaceResult>;
}
export declare const APP_SURFACE_METHODS: readonly ["open", "openHost", "get", "move", "close", "workspace"];
//# sourceMappingURL=surfaces.d.ts.map