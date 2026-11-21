/**
 * app-input-status-icons.ts — generated from shared/app-input-status-icons.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Host-rendered icon vocabulary for App input-status contributions. */
export const APP_INPUT_STATUS_ICON_NAMES = ['check', 'pin', 'sync'];
/** Image formats a bundled input-status icon may be written in. */
export const APP_INPUT_STATUS_ICON_EXTENSIONS = ['.png', '.webp', '.svg'];
export function isAppInputStatusIconName(value) {
    return typeof value === 'string' && APP_INPUT_STATUS_ICON_NAMES.includes(value);
}
/** Whether a declaration ends in one of the bundleable image extensions. */
export function hasAppInputStatusIconExtension(value) {
    const dot = value.lastIndexOf('.');
    if (dot <= 0)
        return false;
    const ext = value.slice(dot).toLowerCase();
    return APP_INPUT_STATUS_ICON_EXTENSIONS.includes(ext);
}
//# sourceMappingURL=app-input-status-icons.js.map