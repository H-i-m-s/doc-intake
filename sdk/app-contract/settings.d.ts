/**
 * app-contract/settings.ts — generated from shared/app-contract/settings.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** A static settings form an App may declare in `contributes.settings`. */
export type AppSettingsValueTypeV2 = "string" | "number" | "integer" | "boolean" | "object" | "array";
export type AppSettingsScopeV2 = "global" | "per-agent" | "per-session";
export interface AppSettingsPropertyUiV2 {
    /** Reserved host control hint. Current generic rendering does not consume it. */
    readonly control?: string;
    /** Display labels paired positionally with `enum`; stored values remain the enum values. */
    readonly enumLabels?: readonly string[];
}
export interface AppSettingsSchemaPropertyV2 {
    readonly type?: AppSettingsValueTypeV2;
    readonly title?: string;
    readonly description?: string;
    readonly default?: unknown;
    readonly enum?: readonly unknown[];
    readonly scope?: AppSettingsScopeV2;
    readonly sensitive?: boolean;
    readonly ui?: AppSettingsPropertyUiV2;
    readonly reloadRequired?: boolean;
    readonly migrationVersion?: number;
}
/** Range, format and conditional rules require an App-owned settings surface. */
export interface AppSettingsSchemaV2 {
    readonly type?: "object";
    readonly properties: Record<string, AppSettingsSchemaPropertyV2>;
    readonly required?: readonly string[];
    readonly migrationVersion?: number;
}
//# sourceMappingURL=settings.d.ts.map