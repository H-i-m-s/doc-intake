/**
 * app-input-status-icons.ts — generated from shared/app-input-status-icons.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Host-rendered icon vocabulary for App input-status contributions. */
export declare const APP_INPUT_STATUS_ICON_NAMES: readonly ["check", "pin", "sync"];
export type AppInputStatusIconName = typeof APP_INPUT_STATUS_ICON_NAMES[number];
/** Image formats a bundled input-status icon may be written in. */
export declare const APP_INPUT_STATUS_ICON_EXTENSIONS: readonly [".png", ".webp", ".svg"];
export type AppInputStatusIconExtension = typeof APP_INPUT_STATUS_ICON_EXTENSIONS[number];
/**
 * What one `contributes.ui.inputStatus[].icon` may name: a host-owned icon name,
 * or a `ui/`-relative bundled image path (`icons/sticker.svg`) whose bytes the
 * host decodes and serves itself.
 */
export type AppInputStatusIcon = AppInputStatusIconName | (string & {});
export declare function isAppInputStatusIconName(value: unknown): value is AppInputStatusIconName;
/** Whether a declaration ends in one of the bundleable image extensions. */
export declare function hasAppInputStatusIconExtension(value: string): boolean;
//# sourceMappingURL=app-input-status-icons.d.ts.map