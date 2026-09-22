/**
 * app-contract/sessions.ts — generated from shared/app-contract/sessions.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Stable App session references and lifecycle/runtime operations. */
export type AppSessionScopeV2 = "own" | "all";
export type AppSessionLifecycleV2 = "active" | "archived" | "all";
export interface AppSessionRefV2 {
    readonly sessionId?: string;
    readonly sessionPath?: string;
    readonly legacySessionPath?: string;
}
export interface AppSessionListRequestV2 {
    readonly scope?: AppSessionScopeV2;
    readonly lifecycle?: AppSessionLifecycleV2;
    readonly ownerPluginId?: string;
    readonly agentId?: string;
}
export interface AppSessionListEntryV2 {
    readonly sessionId: string | null;
    readonly path: string;
    readonly title?: string | null;
    readonly firstMessage?: string | null;
    readonly agentId?: string | null;
    readonly agentName?: string | null;
    readonly modelId?: string | null;
    readonly messageCount?: number | null;
    readonly cwd?: string | null;
    readonly modified?: string | number | null;
    readonly ownerPluginId: string | null;
    readonly kind: string | null;
    readonly visibility: string;
    readonly lifecycle: "active" | "archived";
    readonly archivedAt: string | null;
}
export interface AppSessionListResultV2 {
    readonly sessions: readonly AppSessionListEntryV2[];
}
export type AppSessionForkTargetV2 = {
    readonly role: "user" | "assistant";
    readonly entryId: string;
} | {
    readonly role: "assistant_turn";
    readonly turnInputEntryId: string;
};
export interface AppSessionForkRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
    readonly target: AppSessionForkTargetV2;
    readonly kind?: string;
}
export interface AppSessionForkResultV2 {
    readonly sessionId: string;
    readonly sessionPath: string;
    readonly path: string;
    readonly sourceSessionId: string;
    readonly parentSessionId: string;
    readonly forkedFromEntryId: string;
    readonly target: AppSessionForkTargetV2;
    readonly agentId?: string;
    readonly agentName?: string;
    readonly cwd?: string | null;
    readonly permissionMode?: string;
    readonly thinkingLevel?: string | null;
    readonly projectId?: string | null;
    readonly kind?: string;
    readonly sessionFiles?: unknown;
    readonly visionNotes?: unknown;
}
export interface AppSessionCompactRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
}
export interface AppSessionCompactResultV2 {
    readonly sessionId: string;
    readonly tokensBefore: number | null;
    readonly tokensAfter: number | null;
    readonly contextWindow: number | null;
}
export interface AppSessionContextRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
}
export interface AppSessionContextResultV2 {
    readonly sessionId: string;
    readonly systemPrompt: string | null;
    readonly model: Readonly<Record<string, unknown>> | null;
    readonly thinkingLevel: string | null;
    readonly isStreaming: boolean;
    readonly isCompacting: boolean;
    readonly pendingMessageCount: number | null;
    readonly contextUsage: unknown;
}
export interface AppSessionEntriesRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
}
export interface AppSessionEntriesResultV2 {
    readonly sessionId: string;
    readonly entries: readonly unknown[];
    readonly leafId: string | null;
}
export interface AppSessionLifecycleRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
}
export interface AppSessionLifecycleResultV2 {
    readonly ok: true;
    readonly sessionId: string;
    readonly [key: string]: unknown;
}
/** The durable selected tools and the runtime moment at which the selection applies. */
export interface AppSessionToolSelectionReceiptV2 {
    readonly sessionId: string;
    readonly toolNames: readonly string[];
    /** `null` means no deferred selection; `[]` means an explicit deferred empty selection. */
    readonly pendingToolNames: readonly string[] | null;
    readonly effective: "current" | "next-turn";
}
export interface AppSessionToolSelectionRequestV2 extends AppSessionRefV2 {
    readonly scope?: AppSessionScopeV2;
}
export interface AppSessionSetActiveToolsRequestV2 extends AppSessionToolSelectionRequestV2 {
    readonly toolNames: readonly string[];
}
//# sourceMappingURL=sessions.d.ts.map