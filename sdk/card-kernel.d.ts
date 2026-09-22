/**
 * card-kernel.ts — generated from shared/card-kernel.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export declare const CARD_KERNEL_CONTRACT_VERSION = 1;
export declare const CARD_RENDERER_LANES: readonly ["native", "webview", "chat.surface", "artifact.html", "compat.iframe", "web.embed"];
export type CardRendererLane = typeof CARD_RENDERER_LANES[number];
export type CardSource = {
    kind: "builtin";
    builtinId: string;
} | {
    kind: "plugin";
    pluginId: string;
    contributionId: string;
} | {
    kind: "mcp";
    connectorId: string;
    toolName: string;
    resourceUri: string;
} | {
    kind: "artifact";
    sessionId: string;
    messageId?: string;
    blockId?: string;
    artifactId: string;
} | {
    kind: "resource";
    resourceRef: string;
} | {
    kind: "web";
    webCardId: string;
};
export interface CardRendererDeclaration {
    lane: CardRendererLane;
    rendererKind: string;
}
export type CardDiagnosticSeverity = "info" | "warning" | "error";
export type CardDiagnosticCode = "missing_renderer" | "unknown_renderer_lane" | "missing_plugin" | "missing_resource" | "permission_denied" | "restore_failed" | "unavailable";
export interface CardDiagnosticEntry {
    code: CardDiagnosticCode | (string & {});
    severity: CardDiagnosticSeverity;
    message: string;
    source?: CardSource;
    at?: number;
    details?: Record<string, unknown>;
}
export interface CardDiagnostics {
    status: "ok" | "degraded" | "failed";
    entries: CardDiagnosticEntry[];
}
export declare function normalizeCardFormFactors(raw: unknown): string[] | undefined;
export declare function isEligibleForFormFactor(formFactors: readonly string[] | undefined, formFactor: string): boolean;
/**
 * 插件卡形态声明（contributes.{page,widget,cards[]}.cardForm）：只管**内容与
 * 卡体的关系**这一维。标题带透不透明是另一维，由并列的 `titlebar` 独立决定，
 * 两者互不覆盖。
 *   · framed 内容装在一层内缩描边的圆角面板里（默认，也是未声明时的观感）
 *   · flush  内容直接贴着卡体，四边到卡缘，不套面板
 * 与"呈现资格"的 formFactors 无关：这里说的是同一张卡长什么样，不是它在哪种
 * 设备上出现。
 */
export declare const PLUGIN_CARD_FORMS: readonly ["framed", "flush"];
export type PluginCardForm = typeof PLUGIN_CARD_FORMS[number];
export declare function isPluginCardForm(value: unknown): value is PluginCardForm;
/**
 * 退役的形态写法。它们诞生于"一个字段说清整张卡长什么样"的时期，代价是把
 * 两个维度压进一个名字里——于是四种真实组合只有三个能说出口，"内层面板 +
 * 透明标题带"那一格没有名字。现在两维各自独立，旧值降级为读时别名。
 *   · fill    = flush + 透明标题带（旧语义自带这半，映射时必须带上）
 *   · unified = flush，标题带那一维交还给作者的 titlebar 声明
 * `framed` 新旧同名同义，不在此列。
 */
export declare const LEGACY_PLUGIN_CARD_FORM_ALIASES: Record<string, {
    cardForm: PluginCardForm;
    titlebar: "solid" | "translucent" | null;
}>;
/**
 * 插件卡的落地方式（contributes.cards[].realization）：这张卡是画布上的一张
 * 卡，还是它自己就是一整页。
 *   · card 卡实例（默认，也是未声明时的行为）：落在当前页的画布上
 *   · page 整页：宿主为它开一页、放它一张卡占满，页面切换器里多出一项
 * 与 cardForm / titlebar 正交：那两维说的是这张卡长什么样，这里说的是它落在
 * 哪儿。
 */
export declare const PLUGIN_CARD_REALIZATIONS: readonly ["card", "page"];
export type PluginCardRealization = typeof PLUGIN_CARD_REALIZATIONS[number];
export declare function isPluginCardRealization(value: unknown): value is PluginCardRealization;
/**
 * 整页卡的两个"全站"声明（contributes.cards[].siteNavEntry / .fpFullPanel）。
 * 两者都是布尔，都缺省 false，且**只在 realization 为 "page" 时有意义**——它们
 * 说的是"这一整页在宿主全站范围里怎么占位"，画布上的一张卡没有这个位可占，
 * 所以非整页卡上的声明按未声明处理。
 *   · siteNavEntry 入口常驻全站导航：这一页的入口一直挂在全站导航上，点击行为
 *     与群聊页一致——直接打开它、已经开着就聚焦过去，不是新建一份。
 *   · fpFullPanel  功能面板全占：切到这一页时，左侧功能面板隐掉中间那段固定
 *     系统区，本页自己的面板内容占满整条；页面切换条与底部用户条照常保留。
 *
 * v1 仍只对一方（source === "builtin"）开放：社区 v1 插件写了这两个字段，
 * 宿主一律不认，拒绝落进该插件的诊断投影。v2 整页卡（realization === "page"）
 * 写布尔即生效，投影进卡片目录；非整页卡上的声明仍按未声明处理。
 */
export declare const PLUGIN_CARD_SITE_SURFACE_FIELDS: readonly ["siteNavEntry", "fpFullPanel"];
export type PluginCardSiteSurfaceField = typeof PLUGIN_CARD_SITE_SURFACE_FIELDS[number];
export interface PluginCardSiteSurfaceDeclaration {
    /** 入口常驻全站导航；缺省 false。仅 realization === "page" 时有意义。 */
    siteNavEntry?: boolean;
    /** 切到本页时功能面板由本页内容全占；缺省 false。仅 realization === "page" 时有意义。 */
    fpFullPanel?: boolean;
}
/**
 * 卡片向功能面板贡献一段内容的声明（contributes.cards[].functionPanel）。
 *
 * 声明只说"这张卡有一块面板、它叫什么"；内容是运行时由插件推过来的，因为面板
 * 内容天然会变（列表增删、选中态跟着主卡走），静态清单表达不了。
 *
 * 面板跟着卡走：卡在哪一页，面板就出现在那一页的功能面板里；卡关掉、插件停用、
 * 或卡被拖到不收面板贡献的落位面（画布、拆窗），面板随之不在场。一张卡一块
 * 面板——面板是一条 180 到 400 像素宽的竖栏，再多没有意义。
 */
export interface PluginCardFunctionPanelDeclaration {
    /** 插件内唯一的面板 id */
    id: string;
    /** 段落标题。只有同一页上出现多块面板时才显示 */
    label?: unknown;
    /**
     * 功能面板 iframe 的 loopback 地址。有合法值时宿主画 iframe，不再收
     * `hana.panel.set` 原语。文法与卡体 `embedUrl` 相同。
     */
    embedUrl?: string;
}
export declare function normalizePluginCardFunctionPanel(raw: unknown): PluginCardFunctionPanelDeclaration | null;
export interface ResolvedPluginCardFormDeclaration {
    /** 归一化后的内容形态；undefined = 没声明（观感同 framed，但保留"没说"的语义）。 */
    cardForm: PluginCardForm | undefined;
    /** 退役写法自带的标题带含义；非 null 时压过并列的 titlebar 声明。 */
    titlebarFromLegacyForm: "solid" | "translucent" | null;
    /** 命中的退役写法原名，供加载期提示迁移；null = 没用旧写法。 */
    legacyForm: string | null;
    /** 声明了，但既不是现行值也不是退役写法。 */
    invalid: boolean;
}
/**
 * 形态声明的唯一解析点：加载期校验（plugin-manager、plugin-loader-v2）与
 * 渲染期解析（plugin-card-form）都读它，旧写法的映射只此一处，不各写一份。
 */
export declare function resolvePluginCardFormDeclaration(raw: unknown): ResolvedPluginCardFormDeclaration;
export declare function normalizeCardRendererLane(value: unknown): CardRendererLane | null;
export declare function normalizeCardRendererDeclaration(raw: unknown): CardRendererDeclaration | null;
export declare function normalizeCardSource(raw: unknown): CardSource | null;
export declare function cardDiagnosticsStatusForEntries(entries: readonly Pick<CardDiagnosticEntry, "severity">[]): CardDiagnostics["status"];
export declare function createCardDiagnostics(entries?: readonly CardDiagnosticEntry[]): CardDiagnostics;
export declare function normalizeCardDiagnostics(raw: unknown): CardDiagnostics | null;
//# sourceMappingURL=card-kernel.d.ts.map