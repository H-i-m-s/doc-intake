/**
 * app-theme-capabilities.ts — generated from shared/app-theme-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-theme-capabilities.ts — ledger words for a v2 App's UI-only
 * custom-theme door.
 *
 * Three graded capabilities, so a read-only browser or a pure preview App never
 * has to request write authority:
 *
 *  - `app/themes.read`    — list / get / getSchema, and subscribe to changes;
 *  - `app/themes.manage`  — create / update / remove;
 *  - `app/themes.apply`   — apply / preview / endPreview.
 *
 * They are independent: `manage` does not imply `read`, and `apply` does not
 * imply `manage`. A caller checks exactly the word the operation needs, on
 * every request, through the permission ledger (default deny).
 */
export declare const APP_THEMES_READ_CAPABILITY = "app/themes.read";
export declare const APP_THEMES_MANAGE_CAPABILITY = "app/themes.manage";
export declare const APP_THEMES_APPLY_CAPABILITY = "app/themes.apply";
export declare const APP_THEME_CAPABILITY_WORDS: readonly ["app/themes.read", "app/themes.manage", "app/themes.apply"];
export type AppThemeCapability = (typeof APP_THEME_CAPABILITY_WORDS)[number];
export type AppThemeCapabilityLedger = {
    query(subject: {
        domain: string;
        id: string;
    }, capability: string): {
        decision?: string;
    } | null | undefined;
};
/**
 * Has `appId` been granted `capability`? A missing ledger, a throwing query, or
 * any decision other than `"allowed"` all read as not granted — the same
 * default-deny floor the other App capability helpers use.
 */
export declare function isAppThemeCapabilityGranted(appId: string, capability: AppThemeCapability, ledger: AppThemeCapabilityLedger | null | undefined): boolean;
//# sourceMappingURL=app-theme-capabilities.d.ts.map