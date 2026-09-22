/**
 * app-contract/agents.ts — generated from shared/app-contract/agents.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * App-owned Agent management over `ctx.bus.request`.
 *
 * Every App-created Agent is host-stamped as `plugin_private` before it is
 * published. The `all` scopes below cross that ownership boundary only after
 * the user grants the corresponding standing App capability.
 */
/** Which Agent partition a read request addresses. Omit for the caller App's own active Agents. */
export type AppAgentScopeV2 = "own" | "all";
/** Which lifecycle states an Agent list includes. Omit for active Agents only. */
export type AppAgentLifecycleV2 = "active" | "retired" | "all";
/** Host-owned metadata that identifies an Agent's App partition. */
export interface AppAgentPluginMetadataV2 {
    readonly ownerPluginId: string | null;
    readonly visibility: string;
    readonly kind?: string | null;
    readonly agentTypeId?: string | null;
}
/** A safe, serializable Agent profile. It contains no credential material. */
export interface AppAgentProfileV2 {
    readonly id: string | null;
    readonly name: string | null;
    readonly yuan: string;
    readonly ownerPluginId: string | null;
    readonly visibility: string;
    readonly identity: string;
    readonly description: string;
    readonly memoryPolicy: {
        readonly enabled: boolean;
    };
    readonly experiencePolicy: {
        readonly enabled: boolean;
    };
    readonly toolPolicy: {
        readonly disabled: readonly string[];
    };
    readonly models: Readonly<Record<string, unknown>>;
}
/** One row from `agent:list`. `state` distinguishes retained retired Agents. */
export interface AppAgentListEntryV2 {
    readonly id: string;
    readonly name: string;
    readonly yuan: string | null;
    readonly identity: string;
    readonly ownerPluginId: string | null;
    readonly visibility: string;
    readonly state: "active" | "retired";
    /** The full host-stamped App metadata, including kind and agent type when present. */
    readonly plugin: AppAgentPluginMetadataV2;
    readonly isCurrent?: boolean;
    readonly isPrimary?: boolean;
    readonly deletedAt: string | null;
}
export interface AppAgentListRequestV2 {
    readonly scope?: AppAgentScopeV2;
    readonly lifecycle?: AppAgentLifecycleV2;
    /** With `scope: "all"`, restrict the returned partition to this App id. */
    readonly ownerPluginId?: string;
}
export interface AppAgentListResultV2 {
    readonly agents: readonly AppAgentListEntryV2[];
}
export interface AppAgentProfileRequestV2 {
    readonly agentId: string;
    readonly scope?: AppAgentScopeV2;
}
export interface AppAgentProfileResultV2 {
    readonly profile: AppAgentProfileV2;
}
/** Files the host may seed into a newly-created Agent. Unknown keys are ignored. */
export interface AppAgentInitialFilesV2 {
    readonly identity?: string;
    readonly agents?: string;
    readonly publicAgents?: string;
}
/** Create an Agent owned by the calling App. Ownership and visibility are not caller inputs. */
export interface AppAgentCreateRequestV2 {
    readonly name: string;
    readonly id?: string;
    readonly yuan?: string;
    readonly kind?: string;
    readonly initialFiles?: AppAgentInitialFilesV2;
    readonly initialMemory?: Readonly<Record<string, unknown>>;
    readonly memoryPolicy?: {
        readonly enabled?: boolean;
    };
}
export interface AppAgentCreateResultV2 {
    readonly agent: {
        readonly id: string;
        readonly name: string;
        readonly ownerPluginId: string | null;
        readonly visibility: "plugin_private";
        readonly profile: AppAgentProfileV2 | null;
    };
}
/** Instantiate one of the calling App's declared `contributes.agentTypes` entries. */
export interface AppAgentCreateFromTypeRequestV2 {
    readonly agentTypeId: string;
    readonly name?: string;
}
export interface AppAgentCreateFromTypeResultV2 {
    readonly agent: {
        readonly id: string;
        readonly name: string;
        readonly ownerPluginId: string;
        readonly visibility: "plugin_private";
        readonly agentTypeId: string;
        readonly profile: AppAgentProfileV2 | null;
    };
}
export interface AppRoleSkillV2 {
    readonly skillId: string;
    readonly name: string;
    readonly bundle: string | null;
}
export interface AppRoleV2 {
    readonly roleId: string;
    readonly appId: string;
    readonly packageName: string;
    readonly agent: {
        readonly name: string;
        readonly yuan?: string;
        readonly description?: string;
    };
    readonly skills: readonly AppRoleSkillV2[];
    readonly memory: {
        readonly facts: number;
        readonly compiled: boolean;
    };
    readonly avatar: string | null;
    readonly prompts?: AppAgentInitialFilesV2;
    readonly memoryFacts?: readonly Readonly<Record<string, unknown>>[];
    readonly memoryCompiled?: Readonly<Record<string, unknown>> | null;
}
export interface AppRoleGetRequestV2 {
    readonly roleId: string;
}
export interface AppRoleListResultV2 {
    readonly roles: readonly AppRoleV2[];
}
export interface AppRoleGetResultV2 {
    readonly role: AppRoleV2;
}
export interface AppAgentCreateFromRoleRequestV2 {
    readonly roleId: string;
    readonly name?: string;
    readonly id?: string;
    readonly importMemory?: boolean;
}
export interface AppAgentCreateFromRoleResultV2 {
    readonly agent: AppAgentCreateResultV2["agent"] & {
        readonly roleId: string;
    };
}
/** Mutable Agent settings exposed by `agent:update`; ownership fields are deliberately absent. */
export interface AppAgentUpdateRequestV2 {
    readonly agentId: string;
    /** Required when changing an Agent outside the caller App's own partition. */
    readonly scope?: AppAgentScopeV2;
    readonly name?: string;
    readonly yuan?: string;
    readonly memoryPolicy?: {
        readonly enabled?: boolean;
    };
    readonly toolPolicy?: {
        readonly disabled?: readonly string[];
    };
    readonly config?: Readonly<Record<string, unknown>>;
}
export interface AppAgentUpdateResultV2 {
    readonly ok: true;
    readonly agent: AppAgentProfileV2 | {
        readonly id: string;
    };
}
export interface AppAgentConfigRequestV2 {
    readonly agentId: string;
    readonly scope?: AppAgentScopeV2;
}
/** The host redacts credential-shaped fields before returning this configuration. */
export interface AppAgentConfigSuccessV2 {
    readonly config: Readonly<Record<string, unknown>>;
}
export interface AppAgentConfigErrorV2 {
    readonly error: string;
}
export type AppAgentConfigResultV2 = AppAgentConfigSuccessV2 | AppAgentConfigErrorV2;
export interface AppAgentUpdateConfigRequestV2 {
    readonly agentId: string;
    /** Required when changing an Agent outside the caller App's own partition. */
    readonly scope?: AppAgentScopeV2;
    readonly partial: Readonly<Record<string, unknown>>;
}
/** The host redacts credential-shaped fields before returning this configuration. */
export interface AppAgentUpdateConfigSuccessV2 {
    readonly config: Readonly<Record<string, unknown>>;
}
export type AppAgentUpdateConfigResultV2 = AppAgentUpdateConfigSuccessV2 | AppAgentConfigErrorV2;
export interface AppAgentRetireRequestV2 {
    readonly agentId: string;
    /** Required when retiring an Agent outside the caller App's own partition. */
    readonly scope?: AppAgentScopeV2;
}
export interface AppAgentRetireResultV2 {
    readonly ok: true;
    readonly replacementAgentId: string | null;
    readonly replacementSwitchResult: unknown | null;
}
export interface AppAgentPurgeRequestV2 {
    readonly agentId: string;
    /** Required when purging an Agent outside the caller App's own partition. */
    readonly scope?: AppAgentScopeV2;
}
export interface AppAgentPurgeResultV2 {
    readonly ok: true;
}
//# sourceMappingURL=agents.d.ts.map