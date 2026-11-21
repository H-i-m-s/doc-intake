/**
 * The surface methods the managed AppPlatform's own in-process service
 * implements. The card-chrome methods above are not part of it: they are
 * supplied by the host-only backend facade, so the managed platform never
 * reflects onto a method it does not have.
 */
export const APP_MANAGED_SURFACE_METHODS = Object.freeze(["open", "openHost", "get", "move", "close", "workspace"]);
/** Every method the App host surface domain exposes: the managed six plus the backend card-chrome three. */
export const APP_SURFACE_METHODS = Object.freeze([
    ...APP_MANAGED_SURFACE_METHODS, "listCardChromeViews", "getCardChromeView", "setCardChrome",
]);
//# sourceMappingURL=surfaces.js.map