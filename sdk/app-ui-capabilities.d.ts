/**
 * app-ui-capabilities.ts — generated from shared/app-ui-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Ledger words for a v2 app's iframe-facing UI door: opening a link outside
 * the app, and writing to the system clipboard from inside a card's iframe.
 * Both back a `requiresGrant: true` entry in
 * `desktop/src/react/plugin-ui/capabilities.ts`'s
 * `DEFAULT_PLUGIN_UI_CAPABILITIES` (`external.open`, `clipboard.writeText`)
 * — see `shared/app-ui-capability-map.ts` for the map from those iframe
 * capability names to these ledger words.
 */
export declare const APP_UI_OPEN_EXTERNAL_CAPABILITY = "app/ui.open-external";
export declare const APP_UI_CLIPBOARD_WRITE_CAPABILITY = "app/ui.clipboard-write";
export declare const APP_UI_CAPABILITY_WORDS: readonly ["app/ui.open-external", "app/ui.clipboard-write"];
/** The literal-union type of every word `APP_UI_CAPABILITY_WORDS` carries. */
export type AppUiCapability = (typeof APP_UI_CAPABILITY_WORDS)[number];
export type AppUiCapabilityLedger = {
    query(subject: {
        domain: string;
        id: string;
    }, capability: string): {
        decision?: string;
    } | null;
};
/**
 * Has `pluginId` been granted `capability`? A missing ledger, a throwing
 * query, or any decision other than `"allowed"` all read as not granted —
 * the same default-deny floor `isAppProcessSpawnGranted`
 * (`shared/app-process-capabilities.ts`) uses.
 */
export declare function isAppUiCapabilityGranted(pluginId: string, capability: AppUiCapability, ledger: AppUiCapabilityLedger | null | undefined): boolean;
//# sourceMappingURL=app-ui-capabilities.d.ts.map