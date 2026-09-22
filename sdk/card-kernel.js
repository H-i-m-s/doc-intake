/**
 * card-kernel.ts — generated from shared/card-kernel.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
export const CARD_KERNEL_CONTRACT_VERSION = 1;
export const CARD_RENDERER_LANES = [
    "native",
    "webview",
    "chat.surface",
    "artifact.html",
    "compat.iframe",
    "web.embed",
];
const CARD_RENDERER_LANE_SET = new Set(CARD_RENDERER_LANES);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed || null;
}
function optionalNonEmptyString(value) {
    const normalized = nonEmptyString(value);
    return normalized ?? undefined;
}
export function normalizeCardFormFactors(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const formFactors = [];
    for (const item of raw) {
        const normalized = nonEmptyString(item);
        // Unknown form factors are kept verbatim: a card declaring only a future
        // form factor must stay ineligible on current ones, not be widened to
        // "supports everything" by normalization.
        if (normalized && !formFactors.includes(normalized))
            formFactors.push(normalized);
    }
    return formFactors.length > 0 ? formFactors : undefined;
}
export function isEligibleForFormFactor(formFactors, formFactor) {
    return formFactors === undefined || formFactors.includes(formFactor);
}
/**
 * 插件卡形态声明（contributes.{page,widget,cards[]}.cardForm）：只管**内容与
 * 卡体的关系**这一维。标题带透不透明是另一维，由并列的 `titlebar` 独立决定，
 * 两者互不覆盖。
 *   · framed 内容装在一层内缩描边的圆角面板里（默认，也是未声明时的观感）
 *   · flush  内容直接贴着卡体，四边到卡缘，不套面板
 * 与"呈现资格"的 formFactors 无关：这里说的是同一张卡长什么样，不是它在哪种
 * 设备上出现。
 */
export const PLUGIN_CARD_FORMS = ["framed", "flush"];
const PLUGIN_CARD_FORM_SET = new Set(PLUGIN_CARD_FORMS);
export function isPluginCardForm(value) {
    return typeof value === "string" && PLUGIN_CARD_FORM_SET.has(value);
}
/**
 * 退役的形态写法。它们诞生于"一个字段说清整张卡长什么样"的时期，代价是把
 * 两个维度压进一个名字里——于是四种真实组合只有三个能说出口，"内层面板 +
 * 透明标题带"那一格没有名字。现在两维各自独立，旧值降级为读时别名。
 *   · fill    = flush + 透明标题带（旧语义自带这半，映射时必须带上）
 *   · unified = flush，标题带那一维交还给作者的 titlebar 声明
 * `framed` 新旧同名同义，不在此列。
 */
export const LEGACY_PLUGIN_CARD_FORM_ALIASES = {
    fill: { cardForm: "flush", titlebar: "translucent" },
    unified: { cardForm: "flush", titlebar: null },
};
/**
 * 插件卡的落地方式（contributes.cards[].realization）：这张卡是画布上的一张
 * 卡，还是它自己就是一整页。
 *   · card 卡实例（默认，也是未声明时的行为）：落在当前页的画布上
 *   · page 整页：宿主为它开一页、放它一张卡占满，页面切换器里多出一项
 * 与 cardForm / titlebar 正交：那两维说的是这张卡长什么样，这里说的是它落在
 * 哪儿。
 */
export const PLUGIN_CARD_REALIZATIONS = ["card", "page"];
const PLUGIN_CARD_REALIZATION_SET = new Set(PLUGIN_CARD_REALIZATIONS);
export function isPluginCardRealization(value) {
    return typeof value === "string" && PLUGIN_CARD_REALIZATION_SET.has(value);
}
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
export const PLUGIN_CARD_SITE_SURFACE_FIELDS = ["siteNavEntry", "fpFullPanel"];
export function normalizePluginCardFunctionPanel(raw) {
    if (!isRecord(raw))
        return null;
    const id = nonEmptyString(raw.id);
    if (!id)
        return null;
    const label = raw.label;
    return label === undefined || label === null ? { id } : { id, label };
}
/**
 * 形态声明的唯一解析点：加载期校验（plugin-manager、plugin-loader-v2）与
 * 渲染期解析（plugin-card-form）都读它，旧写法的映射只此一处，不各写一份。
 */
export function resolvePluginCardFormDeclaration(raw) {
    if (raw === undefined || raw === null) {
        return { cardForm: undefined, titlebarFromLegacyForm: null, legacyForm: null, invalid: false };
    }
    if (isPluginCardForm(raw)) {
        return { cardForm: raw, titlebarFromLegacyForm: null, legacyForm: null, invalid: false };
    }
    const alias = typeof raw === "string" ? LEGACY_PLUGIN_CARD_FORM_ALIASES[raw] : undefined;
    if (alias) {
        return {
            cardForm: alias.cardForm,
            titlebarFromLegacyForm: alias.titlebar,
            legacyForm: raw,
            invalid: false,
        };
    }
    return { cardForm: undefined, titlebarFromLegacyForm: null, legacyForm: null, invalid: true };
}
export function normalizeCardRendererLane(value) {
    return typeof value === "string" && CARD_RENDERER_LANE_SET.has(value)
        ? value
        : null;
}
export function normalizeCardRendererDeclaration(raw) {
    if (!isRecord(raw))
        return null;
    const lane = normalizeCardRendererLane(raw.lane);
    const rendererKind = nonEmptyString(raw.rendererKind);
    if (!lane || !rendererKind)
        return null;
    return { lane, rendererKind };
}
export function normalizeCardSource(raw) {
    if (!isRecord(raw))
        return null;
    if (raw.kind === "builtin") {
        const builtinId = nonEmptyString(raw.builtinId);
        return builtinId ? { kind: "builtin", builtinId } : null;
    }
    if (raw.kind === "plugin") {
        const pluginId = nonEmptyString(raw.pluginId);
        const contributionId = nonEmptyString(raw.contributionId);
        return pluginId && contributionId ? { kind: "plugin", pluginId, contributionId } : null;
    }
    if (raw.kind === "mcp") {
        const connectorId = nonEmptyString(raw.connectorId);
        const toolName = nonEmptyString(raw.toolName);
        const resourceUri = nonEmptyString(raw.resourceUri);
        return connectorId && toolName && resourceUri
            ? { kind: "mcp", connectorId, toolName, resourceUri }
            : null;
    }
    if (raw.kind === "artifact") {
        const sessionId = nonEmptyString(raw.sessionId);
        const artifactId = nonEmptyString(raw.artifactId);
        if (!sessionId || !artifactId)
            return null;
        const source = { kind: "artifact", sessionId, artifactId };
        const messageId = optionalNonEmptyString(raw.messageId);
        const blockId = optionalNonEmptyString(raw.blockId);
        if (messageId)
            source.messageId = messageId;
        if (blockId)
            source.blockId = blockId;
        return source;
    }
    if (raw.kind === "resource") {
        const resourceRef = nonEmptyString(raw.resourceRef);
        return resourceRef ? { kind: "resource", resourceRef } : null;
    }
    if (raw.kind === "web") {
        const webCardId = nonEmptyString(raw.webCardId);
        return webCardId ? { kind: "web", webCardId } : null;
    }
    return null;
}
function normalizeCardDiagnosticSeverity(value) {
    return value === "info" || value === "warning" || value === "error" ? value : null;
}
export function cardDiagnosticsStatusForEntries(entries) {
    if (entries.some((entry) => entry.severity === "error"))
        return "failed";
    if (entries.some((entry) => entry.severity === "warning"))
        return "degraded";
    return "ok";
}
export function createCardDiagnostics(entries = []) {
    return {
        status: cardDiagnosticsStatusForEntries(entries),
        entries: entries.map((entry) => ({ ...entry })),
    };
}
export function normalizeCardDiagnostics(raw) {
    if (!isRecord(raw))
        return null;
    if (!Array.isArray(raw.entries))
        return null;
    const entries = [];
    for (const item of raw.entries) {
        if (!isRecord(item))
            return null;
        const code = nonEmptyString(item.code);
        const severity = normalizeCardDiagnosticSeverity(item.severity);
        const message = nonEmptyString(item.message);
        if (!code || !severity || !message)
            return null;
        const entry = { code, severity, message };
        const source = normalizeCardSource(item.source);
        if (source)
            entry.source = source;
        if (typeof item.at === "number" && Number.isFinite(item.at))
            entry.at = item.at;
        if (isRecord(item.details))
            entry.details = JSON.parse(JSON.stringify(item.details));
        entries.push(entry);
    }
    const status = raw.status === "ok" || raw.status === "degraded" || raw.status === "failed"
        ? raw.status
        : cardDiagnosticsStatusForEntries(entries);
    if (status !== cardDiagnosticsStatusForEntries(entries))
        return null;
    return { status, entries };
}
//# sourceMappingURL=card-kernel.js.map