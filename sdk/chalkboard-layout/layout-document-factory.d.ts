import type { ChalkboardLayoutDocument, ChalkboardSurfaceCapabilities } from './layout-document.js';
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
};
/**
 * Home surface 的能力集是跨呈现的唯一定义源：桌面出厂文档和手机档案文档
 * 都用它声明各自的 home surface，禁止在别处复制字面量。
 */
export declare const CHALKBOARD_LAYOUT_HOME_SURFACE_CAPABILITIES: ChalkboardSurfaceCapabilities;
export declare function chalkboardLayoutPageSurfaceId(pageId: string): string;
export declare function createDefaultChalkboardLayoutDocument(now?: number): ChalkboardLayoutDocument;
export declare function ensureChalkboardPageTemplate(doc: ChalkboardLayoutDocument, spec: ChalkboardPageTemplateSpec, now?: number): ChalkboardLayoutDocument;
/** The same persistent home surface, with no cards selected for its initial contents. */
export declare function createEmptyChalkboardLayoutDocument(): ChalkboardLayoutDocument;
//# sourceMappingURL=layout-document-factory.d.ts.map