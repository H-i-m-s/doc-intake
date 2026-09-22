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
export const APP_UI_OPEN_EXTERNAL_CAPABILITY = "app/ui.open-external";
export const APP_UI_CLIPBOARD_WRITE_CAPABILITY = "app/ui.clipboard-write";
export const APP_UI_CAPABILITY_WORDS = Object.freeze([
    APP_UI_OPEN_EXTERNAL_CAPABILITY,
    APP_UI_CLIPBOARD_WRITE_CAPABILITY,
]);
/**
 * Has `pluginId` been granted `capability`? A missing ledger, a throwing
 * query, or any decision other than `"allowed"` all read as not granted —
 * the same default-deny floor `isAppProcessSpawnGranted`
 * (`shared/app-process-capabilities.ts`) uses.
 */
export function isAppUiCapabilityGranted(pluginId, capability, ledger) {
    if (!ledger)
        return false;
    try {
        const record = ledger.query({ domain: "app", id: pluginId }, capability);
        return record?.decision === "allowed";
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=app-ui-capabilities.js.map