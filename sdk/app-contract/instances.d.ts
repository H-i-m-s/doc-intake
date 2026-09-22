/**
 * app-contract/instances.ts — generated from shared/app-contract/instances.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { PluginUiContributions } from "../ui-contribution-points.js";
/** Capability required for an App to create and control its isolated App instances. */
export declare const APP_INSTANCES_MANAGE_CAPABILITY: "app/instances.manage";
export type AppInstanceState = "awaiting-approval" | "running" | "stopped" | "failed" | "closing" | "cleanup-pending" | "closed";
export interface AppInstanceError {
    readonly code: string;
    readonly message: string;
}
/** A public projection. Paths, child-server credentials, and rollback handles stay host-only. */
export interface AppInstanceSnapshot {
    readonly instanceId: string;
    readonly revision: number;
    readonly appId: string;
    readonly version: string;
    readonly state: AppInstanceState;
    readonly stagedId?: string;
    readonly error?: AppInstanceError;
}
export interface AppInstanceLog {
    readonly sequence: number;
    readonly timestamp: string;
    readonly level: "info" | "error";
    readonly message: string;
}
/** A checked declaration from the App actually loaded in this isolated instance. */
export interface AppInstanceCatalog {
    readonly instanceId: string;
    readonly revision: number;
    readonly appId: string;
    readonly capabilities: readonly string[];
    readonly ui?: Pick<PluginUiContributions, "homeActions" | "cardChrome" | "slots" | "slotContributions">;
    readonly cards: readonly {
        readonly definitionId: string;
        readonly title?: string;
        readonly description?: string;
        readonly route?: string;
        readonly detachedRoute?: string;
        readonly detachedDefaultSize?: {
            readonly width: number;
            readonly height: number;
        };
        readonly embedUrl?: string;
        readonly cardForm?: string;
        readonly titlebar?: string;
        readonly realization?: "card" | "page";
        readonly pageOf?: string;
        readonly closable?: boolean;
        readonly siteNavEntry?: boolean;
        readonly fpFullPanel?: boolean;
        readonly functionPanelId?: string;
        readonly functionPanelLabel?: string;
        readonly functionPanelRoute?: string;
        readonly functionPanelEmbedUrl?: string;
        readonly faceImage?: string;
        readonly formFactors?: readonly string[];
    }[];
    readonly settings: {
        readonly definitionId: string;
        readonly title: string;
        readonly schema?: object;
        readonly route?: string;
    } | null;
}
export interface AppInstanceCall {
    /** Resolves only through the host's active App invocation context. */
    readonly callToken?: string;
}
export interface AppInstanceTarget extends AppInstanceCall {
    readonly instanceId: string;
    readonly revision: number;
}
export interface AppInstanceReadTarget extends AppInstanceCall {
    readonly instanceId: string;
}
export interface AppInstances {
    create(input: AppInstanceCall & {
        readonly source: {
            readonly kind: "local-file";
            readonly path: string;
        };
        /** A host-registered primary App window that bounds this instance's lifetime. */
        readonly lifetimeWindowId?: string;
    }): Promise<AppInstanceSnapshot>;
    list(input?: AppInstanceCall): Promise<readonly AppInstanceSnapshot[]>;
    /** Reads the latest child-backed status; mutations still require a revision. */
    get(input: AppInstanceReadTarget): Promise<AppInstanceSnapshot>;
    reload(input: AppInstanceTarget): Promise<AppInstanceSnapshot>;
    stop(input: AppInstanceTarget): Promise<AppInstanceSnapshot>;
    close(input: AppInstanceTarget): Promise<AppInstanceSnapshot>;
    logs(input: AppInstanceTarget & {
        readonly after?: number;
    }): Promise<readonly AppInstanceLog[]>;
    catalog(input: AppInstanceTarget): Promise<AppInstanceCatalog>;
    /** Opens only a host-owned review flow; Apps never receive approval authority. */
    requestReview(input: AppInstanceTarget): Promise<AppInstanceSnapshot>;
}
export declare const APP_INSTANCE_METHODS: readonly ["create", "list", "get", "reload", "stop", "close", "logs", "catalog", "requestReview"];
//# sourceMappingURL=instances.d.ts.map