/**
 * app-contract/queries.ts — generated from shared/app-contract/queries.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppQueryCapability, AppQueryBusVerb } from "../app-query-capabilities.js";
export interface AppUsageModelV2 {
    readonly provider: string | null;
    readonly modelId: string | null;
    readonly api: string | null;
}
export interface AppUsageInputV2 {
    readonly totalTokens: number | null;
    readonly uncachedTokens: number | null;
}
export interface AppUsageOutputV2 {
    readonly totalTokens: number | null;
    readonly reasoningTokens: number | null;
}
export interface AppUsageCacheV2 {
    readonly readTokens: number | null;
    readonly writeTokens: number | null;
    readonly missTokens: number | null;
    readonly hit: boolean | null;
    readonly created: boolean | null;
    readonly hitRatio: number | null;
    readonly support: string | null;
}
export interface AppUsageAmountsV2 {
    readonly input: AppUsageInputV2;
    readonly output: AppUsageOutputV2;
    readonly cache: AppUsageCacheV2;
    readonly totalTokens: number | null;
    /** Cost in the host usage ledger's existing currency/unit. */
    readonly costTotal: number | null;
}
export interface AppUsageAttributionV2 {
    readonly kind: string;
    readonly agentId: string | null;
    readonly sessionId: string | null;
    readonly childSessionId: string | null;
}
export interface AppUsageEntryV2 {
    readonly requestId: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
    readonly durationMs: number | null;
    readonly status: string;
    readonly source: {
        readonly subsystem: string;
        readonly operation: string;
    };
    readonly attribution: AppUsageAttributionV2;
    readonly model: AppUsageModelV2;
    readonly usage: AppUsageAmountsV2 | null;
}
export interface AppUsageListResultV2 {
    readonly entries: readonly AppUsageEntryV2[];
    readonly nextCursor: string | null;
}
/** The existing usage-ledger filters an App may pass to `usage:list`. */
export interface AppUsageListFilterV2 {
    readonly since?: string;
    readonly until?: string;
    readonly status?: "ok" | "error" | "aborted" | "usage_missing";
    readonly attributionKind?: string;
    readonly sessionId?: string;
    /** Legacy locator filter; prefer sessionId across archive or restore. */
    readonly sessionPath?: string;
    readonly childSessionId?: string;
    /** Legacy locator filter; prefer childSessionId across archive or restore. */
    readonly childSessionPath?: string;
    readonly agentId?: string;
    readonly subsystem?: string;
    readonly operation?: string;
    readonly modelId?: string;
    readonly provider?: string;
    readonly limit?: number;
}
export interface AppProviderCredentialsRequestV2 {
    readonly providerId: string;
    readonly forceRefresh?: boolean;
    readonly staleApiKey?: string;
}
export interface AppProviderCredentialsSuccessV2 {
    readonly apiKey: string;
    readonly baseUrl: string | null;
    readonly api: string | null;
    readonly accountId?: string;
    /** V2-only request-safe auth headers. Refresh credentials are never exposed. */
    readonly headers?: Readonly<Record<string, string>>;
}
export interface AppProviderCredentialsErrorV2 {
    readonly error: string;
}
export type AppProviderCredentialsResultV2 = AppProviderCredentialsSuccessV2 | AppProviderCredentialsErrorV2;
/** Public serializable model fields, including provider-specific constraints and pricing metadata. */
export type AppPublicModelMetadataV2 = Readonly<Record<string, unknown>>;
export interface AppProviderModelsByTypeRequestV2 {
    readonly type: string;
    readonly providerId?: string;
}
export interface AppProviderModelsByTypeResultV2 {
    readonly models: readonly AppPublicModelMetadataV2[];
}
export interface AppResolveMediaModelRequestV2 {
    readonly providerId?: string;
    readonly provider?: string;
    readonly modelId?: string;
    readonly model?: string;
    readonly capability?: string;
    readonly credentialLaneId?: string;
}
export interface AppResolveMediaModelSuccessV2 {
    readonly providerId: string;
    readonly modelId: string;
    readonly model: AppPublicModelMetadataV2;
    readonly protocolId: string | null;
    readonly capability: string | null;
    readonly credentialLaneId: string | null;
    readonly credentialProviderId: string | null;
}
export interface AppResolveMediaModelErrorV2 {
    readonly error: string;
}
export type AppResolveMediaModelResultV2 = AppResolveMediaModelSuccessV2 | AppResolveMediaModelErrorV2;
export type AppQueryAccessV2 = Readonly<Record<AppQueryBusVerb, AppQueryCapability>>;
//# sourceMappingURL=queries.d.ts.map