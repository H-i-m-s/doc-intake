import type { ChalkboardLayoutDocument, ChalkboardSurfaceCapabilities } from './layout-document.js';
export declare const CHALKBOARD_LAYOUT_CODE_CHAT_CARD_ID = "card:code-chat";
export declare const CHALKBOARD_LAYOUT_CODE_WORKSPACE_CARD_ID = "card:code-workspace-desk";
/** Code 页自己的终端卡实例（定义仍是终端卡，身份与首页的 card:terminal 分开）。 */
export declare const CHALKBOARD_LAYOUT_CODE_TERMINAL_CARD_ID = "card:code-terminal";
/** Code 页的改动卡实例：只在新建 Code 页模板时放入，之后由菜单开关，不随 reconcile 回填。 */
export declare const CHALKBOARD_LAYOUT_CODE_CHANGES_CARD_ID = "card:code-changes";
export declare const CHALKBOARD_LAYOUT_CODE_ACTIONS_CARD_ID = "card:code-actions";
export declare const CHALKBOARD_LAYOUT_HOME_SURFACE_ID = "surface:home";
export declare const CHALKBOARD_LAYOUT_HOME_CHAT_CARD_ID = "card:home-chat";
export declare const CHALKBOARD_LAYOUT_WORKSPACE_CARD_ID = "card:workspace-desk";
export declare const CHALKBOARD_LAYOUT_TERMINAL_CARD_ID = "card:terminal";
export declare const CHALKBOARD_LAYOUT_CHANNELS_PAGE_ID = "page-channels";
export declare const CHALKBOARD_LAYOUT_CHANNEL_CHAT_CARD_ID = "card:page:page-channels:chat";
export declare const CHALKBOARD_LAYOUT_CHANNEL_STACK_CARD_ID = "card:page:page-channels:stack";
export type ChalkboardPageTemplateSpec = {
    kind: 'empty-page';
    pageId: string;
    title?: string | null;
    shape?: string | null;
} | {
    kind: 'channels';
} | {
    kind: 'code';
};
/**
 * Home surface 的能力集是跨呈现的唯一定义源：桌面出厂文档和手机档案文档
 * 都用它声明各自的 home surface，禁止在别处复制字面量。
 */
export declare const CHALKBOARD_LAYOUT_HOME_SURFACE_CAPABILITIES: ChalkboardSurfaceCapabilities;
/** @deprecated Old page fixture id; read-time migration folds this into the Preview page card. */
export declare const CHALKBOARD_LAYOUT_STUDIO_HOME_CARD_ID = "card:studio-home";
/** @deprecated Old home-card node id; kept so persisted documents can be recognized. */
export declare const CHALKBOARD_LAYOUT_STUDIO_HOME_CARD_NODE_ID = "node:studio-window:home";
export declare const CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_ID = "card:studio-page";
export declare const CHALKBOARD_LAYOUT_STUDIO_PAGE_CARD_NODE_ID = "node:studio-window:page";
export declare const STUDIO_PAGE_MIGRATED_TABS_KEY = "studioPageTabs";
export declare const STUDIO_PAGE_MIGRATED_HOME_PAGE_KEY = "studioHomePage";
export type StudioPageMigratedTab = {
    kind: 'library';
} | {
    kind: 'folder';
    mountId: string;
};
export declare const CHALKBOARD_LAYOUT_STUDIO_SURFACE_CAPABILITIES: ChalkboardSurfaceCapabilities;
export declare function chalkboardLayoutPageSurfaceId(pageId: string): string;
export declare function createDefaultChalkboardLayoutDocument(now?: number): ChalkboardLayoutDocument;
/**
 * Read-time migration: the Studio surface's page fixture is one Preview card.
 * Older documents used a home card (sometimes in a hidden-titlebar slot) and
 * extra Studio cards to the right; those become tabs of the page card.
 */
export declare function migrateChalkboardStudioHomePage(doc: ChalkboardLayoutDocument): ChalkboardLayoutDocument;
export declare function ensureChalkboardStudioSurface(doc: ChalkboardLayoutDocument): ChalkboardLayoutDocument;
export declare function ensureChalkboardPageTemplate(doc: ChalkboardLayoutDocument, spec: ChalkboardPageTemplateSpec, now?: number): ChalkboardLayoutDocument;
/** The same persistent home surface, with no cards selected for its initial contents. */
export declare function createEmptyChalkboardLayoutDocument(): ChalkboardLayoutDocument;
/** Code uses the home composition with its own card and node identities. */
export declare function ensureCodePageTemplate(doc: ChalkboardLayoutDocument, now?: number): ChalkboardLayoutDocument;
//# sourceMappingURL=layout-document-factory.d.ts.map