/**
 * app-contract/environments.ts — generated from shared/app-contract/environments.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { ExtensionKind, PermissionDeclaration } from "../extension-contract.js";
import type { AppInstanceCatalog } from "./instances.js";
import type { AppEnvironmentAgentCreate, AppEnvironmentAgentDirectory, AppEnvironmentAgentRemoval, AppEnvironmentAgentResult, AppEnvironmentAgentUpdate, AppEnvironmentModelCatalog } from "./environment-agents.js";
/** Capability required to operate an isolated, multi-extension environment. */
export declare const APP_ENVIRONMENTS_MANAGE_CAPABILITY: "app/environments.manage";
export type AppEnvironmentState = "running" | "failed" | "closing" | "cleanup-pending" | "closed";
export type ExtensionRef = `${ExtensionKind}:${string}`;
export interface AppEnvironmentError {
    readonly code: string;
    readonly message: string;
}
/** Public environment projection. Runtime credentials, paths, and approval handles remain host-only. */
export interface AppEnvironmentSnapshot {
    readonly environmentId: string;
    readonly revision: number;
    readonly state: AppEnvironmentState;
    readonly error?: AppEnvironmentError;
}
export interface AppEnvironmentLog {
    readonly sequence: number;
    readonly timestamp: string;
    readonly level: "info" | "error";
    readonly message: string;
}
export interface AppEnvironmentExtension {
    readonly ref: ExtensionRef;
    readonly kind: ExtensionKind;
    readonly id: string;
    readonly enabled?: boolean;
    readonly state: "awaiting-approval" | "enabled" | "disabled";
    readonly name?: string;
    readonly version?: string;
    readonly description?: string;
    /** Normalized display image supplied by the installed extension manifest. */
    readonly icon?: string;
    /** Present when the adapter can still read the installed manifest. */
    readonly declaredPermissions?: readonly PermissionDeclaration[];
    readonly contents?: {
        readonly skills?: readonly string[];
        readonly recipes?: readonly string[];
        readonly roles?: readonly string[];
        readonly connectors?: readonly string[];
    };
}
export interface AppEnvironmentTool {
    readonly ref: ExtensionRef;
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
}
/** Package identities available for copyInstalled, without production runtime data. */
export interface AppInstalledExtensionSource {
    readonly ref: ExtensionRef;
    readonly kind: ExtensionKind;
    readonly id: string;
    readonly name?: string;
    readonly version?: string;
}
export interface AppEnvironmentStagedExtension extends AppInstalledExtensionSource {
    readonly stagedId: string;
    readonly description?: string;
    readonly icon?: string;
}
export interface AppEnvironmentSession {
    readonly sessionId: string;
    readonly agentId: string;
    readonly title?: string;
    readonly agentName?: string;
}
export interface AppEnvironmentCatalog {
    readonly environment: AppEnvironmentSnapshot;
    /** Explicit Agent used to evaluate this catalog's tools. */
    readonly agentId?: string;
    readonly extensions: readonly AppEnvironmentExtension[];
    readonly stagedExtensions: readonly AppEnvironmentStagedExtension[];
    /** Active sessions in this environment; no host session paths or conversation content. */
    readonly sessions: readonly AppEnvironmentSession[];
    /** App contributions from the runtime-confirmed installed App manifests. */
    readonly apps: readonly {
        readonly ref: ExtensionRef;
        readonly appId: string;
        readonly cards: AppInstanceCatalog["cards"];
        readonly settings: AppInstanceCatalog["settings"];
        readonly ui?: AppInstanceCatalog["ui"];
    }[];
    readonly tools: readonly AppEnvironmentTool[];
}
export interface AppEnvironmentCall {
    readonly callToken?: string;
}
export interface AppEnvironmentReadTarget extends AppEnvironmentCall {
    readonly environmentId: string;
}
export interface AppEnvironmentTarget extends AppEnvironmentReadTarget {
    readonly revision: number;
}
export interface AppEnvironmentMutationResult {
    readonly environment: AppEnvironmentSnapshot;
}
export interface AppEnvironments {
    create(input?: AppEnvironmentCall & {
        readonly lifetimeWindowId?: string;
    }): Promise<AppEnvironmentSnapshot>;
    list(input?: AppEnvironmentCall): Promise<readonly AppEnvironmentSnapshot[]>;
    get(input: AppEnvironmentReadTarget): Promise<AppEnvironmentSnapshot>;
    close(input: AppEnvironmentTarget): Promise<AppEnvironmentMutationResult>;
    logs(input: AppEnvironmentTarget & {
        readonly after?: number;
    }): Promise<readonly AppEnvironmentLog[]>;
    /** Reads package metadata in the host installation; creates no runtime. */
    listInstalledSources(input?: AppEnvironmentCall & {
        readonly kind?: ExtensionKind;
    }): Promise<readonly AppInstalledExtensionSource[]>;
    listExtensions(input: AppEnvironmentReadTarget): Promise<readonly AppEnvironmentExtension[]>;
    inspectExtension(input: AppEnvironmentReadTarget & {
        readonly ref: ExtensionRef;
    }): Promise<AppEnvironmentExtension>;
    installExtension(input: AppEnvironmentTarget & {
        readonly kind: ExtensionKind;
        readonly source: {
            readonly kind: "local-file";
            readonly path: string;
        };
    }): Promise<AppEnvironmentMutationResult & {
        readonly stagedId: string;
        readonly extension: AppEnvironmentExtension;
    }>;
    copyInstalled(input: AppEnvironmentTarget & {
        readonly ref: ExtensionRef;
    }): Promise<AppEnvironmentMutationResult & {
        readonly stagedId: string;
        readonly extension: AppEnvironmentExtension;
    }>;
    requestReview(input: AppEnvironmentTarget & {
        readonly stagedId: string;
    }): Promise<AppEnvironmentMutationResult>;
    setExtensionEnabled(input: AppEnvironmentTarget & {
        readonly ref: ExtensionRef;
        readonly enabled: boolean;
    }): Promise<AppEnvironmentMutationResult & {
        readonly extension: AppEnvironmentExtension;
    }>;
    reloadExtension(input: AppEnvironmentTarget & {
        readonly ref: ExtensionRef;
    }): Promise<AppEnvironmentMutationResult & {
        readonly extension: AppEnvironmentExtension;
        readonly stagedId?: string;
    }>;
    removeExtension(input: AppEnvironmentTarget & {
        readonly ref: ExtensionRef;
    }): Promise<AppEnvironmentMutationResult>;
    listAgents(input: AppEnvironmentTarget): Promise<AppEnvironmentAgentDirectory>;
    listModels(input: AppEnvironmentTarget): Promise<AppEnvironmentModelCatalog>;
    getAgent(input: AppEnvironmentTarget & {
        readonly agentId: string;
    }): Promise<AppEnvironmentAgentResult>;
    createAgent(input: AppEnvironmentTarget & AppEnvironmentAgentCreate): Promise<AppEnvironmentMutationResult & AppEnvironmentAgentResult>;
    updateAgent(input: AppEnvironmentTarget & {
        readonly agentId: string;
    } & AppEnvironmentAgentUpdate): Promise<AppEnvironmentMutationResult & AppEnvironmentAgentResult>;
    removeAgent(input: AppEnvironmentTarget & {
        readonly agentId: string;
    }): Promise<AppEnvironmentMutationResult & AppEnvironmentAgentRemoval>;
    catalog(input: AppEnvironmentReadTarget & {
        readonly agentId?: string;
    }): Promise<AppEnvironmentCatalog>;
    runTool(input: AppEnvironmentTarget & {
        readonly ref: ExtensionRef;
        readonly toolName: string;
        readonly args: unknown;
        readonly agentId?: string;
    }): Promise<AppEnvironmentMutationResult & {
        readonly result: unknown;
    }>;
    /** Invokes an actual declared UI contribution using its own registered arguments. */
    invokeUiAction(input: AppEnvironmentTarget & {
        readonly appId: string;
        readonly kind: "home-action" | "card-chrome" | "slot-action";
        readonly id: string;
        readonly sessionId?: string;
        readonly agentId?: string;
    }): Promise<AppEnvironmentMutationResult & {
        readonly result: unknown;
    }>;
}
export declare const APP_ENVIRONMENT_METHODS: readonly ["create", "list", "get", "close", "logs", "listInstalledSources", "listExtensions", "inspectExtension", "installExtension", "copyInstalled", "requestReview", "setExtensionEnabled", "reloadExtension", "removeExtension", "listModels", "listAgents", "getAgent", "createAgent", "updateAgent", "removeAgent", "catalog", "runTool", "invokeUiAction"];
//# sourceMappingURL=environments.d.ts.map