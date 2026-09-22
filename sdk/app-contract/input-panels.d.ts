/**
 * app-contract/input-panels.ts — generated from shared/app-contract/input-panels.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** An App-owned UI document and the data for this particular interaction. */
export interface AppInputContentFrameV2 {
    /** An absolute path within this App's ui/ directory, without a query or fragment. */
    readonly route: string;
    /** JSON data delivered after the mounted document completes its host handshake. */
    readonly data?: unknown;
}
/** Byte budget for one custom input panel's question data or structured answer. */
export declare const APP_INPUT_PANEL_DATA_MAX_BYTES: number;
export type AppInputPanelStatusV2 = "pending" | "confirmed" | "rejected" | "timeout" | "aborted" | "active";
/** The App-controlled allocation requested for its mounted input-panel document. */
export interface AppInputPanelPresentationV2 {
    /** Expanded iframe height in CSS pixels; null uses the host's responsive default. */
    readonly height: number | null;
    /** Collapsed iframe height in CSS pixels. */
    readonly collapsedHeight: number;
    /** The compact document stays mounted and interactive while false. */
    readonly expanded: boolean;
}
export interface AppInputPanelPresentationPatchV2 {
    readonly height?: number | null;
    readonly collapsedHeight?: number;
    readonly expanded?: boolean;
}
export declare const APP_INPUT_PANEL_DEFAULT_PRESENTATION: AppInputPanelPresentationV2;
/** Copy a validated patch without rereading untrusted caller properties. */
export declare function copyAppInputPanelPresentationPatch(value: unknown): AppInputPanelPresentationPatchV2;
/** Reject malformed writes; omitted fields retain the supplied base/default value. */
export declare function normalizeAppInputPanelPresentation(value: unknown, base?: AppInputPanelPresentationV2): AppInputPanelPresentationV2;
/** Host-owned registration of one App document in one conversation. */
export interface AppInputPanelV2 {
    readonly panelId: string;
    readonly appId: string;
    readonly appName: string;
    readonly sessionId: string;
    readonly title: string;
    readonly message: string;
    readonly contentFrame: AppInputContentFrameV2;
    readonly requestedSchema: unknown;
    readonly confirmId: string | null;
    readonly status: AppInputPanelStatusV2;
    readonly retained: boolean;
    readonly revision: number;
    readonly presentation: AppInputPanelPresentationV2;
    /** Changes independently of question/content revision. */
    readonly presentationRevision: number;
}
export interface AppInputPanelsSnapshotV2 {
    readonly sessionId: string;
    readonly revision: number;
    readonly panels: readonly AppInputPanelV2[];
}
/** Show or replace this App's non-blocking panel identified by id in one session. */
export interface HanaPluginShowInputPanelRequestV2 {
    readonly sessionId: string;
    readonly id: string;
    readonly title: string;
    readonly message?: string;
    readonly contentFrame: AppInputContentFrameV2;
    readonly presentation?: AppInputPanelPresentationPatchV2;
}
export interface HanaPluginDismissInputPanelRequestV2 {
    readonly sessionId: string;
    readonly id: string;
}
export interface HanaPluginShowInputPanelResultV2 {
    readonly panelId: string;
}
export interface HanaPluginUpdateInputPanelRequestV2 {
    readonly sessionId: string;
    readonly panelId: string;
    readonly presentation: AppInputPanelPresentationPatchV2;
}
export interface HanaPluginUpdateInputPanelResultV2 {
    readonly presentation: AppInputPanelPresentationV2;
    readonly presentationRevision: number;
}
//# sourceMappingURL=input-panels.d.ts.map