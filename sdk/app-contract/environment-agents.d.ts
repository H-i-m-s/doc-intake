/**
 * app-contract/environment-agents.ts — generated from shared/app-contract/environment-agents.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Compatibility Agent for calls that do not select an environment identity. */
export declare const APP_ENVIRONMENT_DEFAULT_AGENT_ID = "instance";
/** Model identity available through this environment's host-managed catalog. */
export interface AppEnvironmentAgentModel {
    readonly provider: string;
    readonly id: string;
}
export interface AppEnvironmentModelCatalog {
    readonly models: readonly (AppEnvironmentAgentModel & {
        readonly name: string;
    })[];
}
export interface AppEnvironmentAgentSummary {
    readonly id: string;
    readonly name: string;
    readonly yuan: string;
    readonly hasAvatar: boolean;
    readonly isPrimary: boolean;
    readonly avatarRevision?: string;
    readonly removable: boolean;
}
/** Editable basic profile; no provider credentials, filesystem paths, or conversation data. */
export interface AppEnvironmentAgentProfile extends AppEnvironmentAgentSummary {
    readonly identity: string;
    readonly agentsMd: string;
    readonly model: AppEnvironmentAgentModel | null;
}
export interface AppEnvironmentAgentCreate {
    readonly name: string;
    readonly id?: string;
    readonly yuan?: string;
    readonly identity?: string;
    readonly agentsMd?: string;
    readonly model?: AppEnvironmentAgentModel | null;
}
export interface AppEnvironmentAgentUpdate {
    readonly name?: string;
    readonly yuan?: string;
    readonly identity?: string;
    readonly agentsMd?: string;
    readonly model?: AppEnvironmentAgentModel | null;
}
export interface AppEnvironmentAgentDirectory {
    readonly agents: readonly AppEnvironmentAgentSummary[];
}
export interface AppEnvironmentAgentResult {
    readonly agent: AppEnvironmentAgentProfile;
}
/** Removal stops the Agent and cleans its owned directory and session manifests. */
export interface AppEnvironmentAgentRemoval {
    readonly agentId: string;
    readonly removed: true;
}
//# sourceMappingURL=environment-agents.d.ts.map