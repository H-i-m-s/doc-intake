/**
 * chalkboard-layout.ts — generated from shared/chalkboard-layout.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Shared Chalkboard page IDs and scope-key helpers.
 *
 * Client Layout Profile is the durable layout persistence contract. This module
 * intentionally keeps only the small identifiers that are still shared by the
 * renderer, placement policy, and profile resolver.
 */
/** 主布局 scope：Workspace 只驱动内容身份，不驱动 Client Layout Profile 归属。 */
export const CHALKBOARD_MAIN_LAYOUT_SCOPE_KEY = "layout:main";
/** 旧版未挂工作区时的兜底 rootKey / scope key，保留兼容。 */
export const CHALKBOARD_NO_WORKSPACE_ROOT_KEY = "__none__";
export const CHALKBOARD_NO_WORKSPACE_SCOPE_KEY = `workspace:${CHALKBOARD_NO_WORKSPACE_ROOT_KEY}`;
/** 聊天页（首页）的保留 id。 */
export const CHALKBOARD_CHAT_PAGE_ID = "page-chat";
/** 内置群聊页的保留 id：默认第二页，可删（删除记墓碑，不复活）。 */
export const CHALKBOARD_CHANNELS_PAGE_ID = "page-channels";
export function workspaceScopeKey(rootKey) {
    if (typeof rootKey !== "string" || !rootKey) {
        throw new TypeError(`workspaceScopeKey: rootKey must be a non-empty string, got ${String(rootKey)}`);
    }
    return `workspace:${rootKey}`;
}
/** 解析 scope key；非法形状（含已废除的 `session:` 域）返回 null。 */
export function parseChalkboardScopeKey(key) {
    if (typeof key !== "string")
        return null;
    const sep = key.indexOf(":");
    if (sep <= 0)
        return null;
    const kind = key.slice(0, sep);
    const ref = key.slice(sep + 1);
    if (!ref)
        return null;
    if (kind === "layout") {
        return key === CHALKBOARD_MAIN_LAYOUT_SCOPE_KEY ? { kind, ref } : null;
    }
    if (kind === "workspace")
        return { kind, ref };
    return null;
}
//# sourceMappingURL=chalkboard-layout.js.map