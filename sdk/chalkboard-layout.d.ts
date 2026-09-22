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
export type ChalkboardScopeKind = "layout" | "workspace";
/** 主布局 scope：Workspace 只驱动内容身份，不驱动 Client Layout Profile 归属。 */
export declare const CHALKBOARD_MAIN_LAYOUT_SCOPE_KEY = "layout:main";
/** 旧版未挂工作区时的兜底 rootKey / scope key，保留兼容。 */
export declare const CHALKBOARD_NO_WORKSPACE_ROOT_KEY = "__none__";
export declare const CHALKBOARD_NO_WORKSPACE_SCOPE_KEY = "workspace:__none__";
/** 聊天页（首页）的保留 id。 */
export declare const CHALKBOARD_CHAT_PAGE_ID = "page-chat";
/** 内置群聊页的保留 id：默认第二页，可删（删除记墓碑，不复活）。 */
export declare const CHALKBOARD_CHANNELS_PAGE_ID = "page-channels";
/** 页面条目：title 可空（页面可无名）；shape 是渲染层的不透明 token
    （形状词汇表归 renderer，本层与 server 不理解也不枚举——同 renderer.kind 哲学）。 */
export interface ChalkboardPageEntry {
    id: string;
    title?: string;
    shape: string;
}
export declare function workspaceScopeKey(rootKey: string): string;
/** 解析 scope key；非法形状（含已废除的 `session:` 域）返回 null。 */
export declare function parseChalkboardScopeKey(key: unknown): {
    kind: ChalkboardScopeKind;
    ref: string;
} | null;
//# sourceMappingURL=chalkboard-layout.d.ts.map