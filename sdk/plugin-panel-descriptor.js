/**
 * plugin-panel-descriptor.ts — generated from shared/plugin-panel-descriptor.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * 功能面板的声明式内容契约。
 *
 * 插件不往面板里塞自己的 DOM，而是描述要显示什么，宿主用内置原语画出来。
 * 这样面板的观感天然与应用一致，也不需要在应用主 chrome 旁边开一个第三方
 * 文档的安全面。
 *
 * 词汇表是从真实插件里倒推的，不是从组件库导出清单倒推的：已发布的插件侧栏
 * 反复手写的就是状态行、可选列表、筛选药丸、比例条、时间戳行这几样。刻意保持
 * 小：它是一层可以整块替换的适配层，不是一套通用 UI 框架。带坐标轴的图表、
 * 多列表格、嵌入外部网页这些表达不了的场景，本来就该走插件自己的卡。
 *
 * 三条贯穿全表的规则：
 *  1. 数值一律由插件格式化好再传（万 / 亿、正号、小数位都是作者逻辑），宿主
 *     不做数字格式化，也不打算长出一套永远不够用的格式化语言。
 *  2. 语义色的极性由作者声明（tone），宿主不从数值正负推断——红涨绿跌是有些
 *     市场的惯例，内建"绿=正"会对最需要它的插件是错的。
 *  3. 交互只回传事件，怎么响应由插件自己决定。宿主唯一理解的动词是"回到我的
 *     主卡"，因为那是宿主才做得到的事。
 */
export const HANA_PANEL_KIND = "hana.panel";
export const HANA_PANEL_VERSION = 1;
/** 语义色。宿主只认这几档，具体色值由主题决定。 */
export const HANA_PANEL_TONES = Object.freeze([
    "neutral",
    "info",
    "success",
    "warning",
    "danger",
]);
const PANEL_TONE_SET = new Set(HANA_PANEL_TONES);
/** 刷新间隔下限：比这更密的轮询对侧栏没有意义，只会烧电。 */
export const HANA_PANEL_MIN_REFRESH_MS = 1_000;
/** 单次推送的 section 上限：面板是竖条，超过这个数就不是面板该干的事了。 */
export const HANA_PANEL_MAX_SECTIONS = 64;
/** 单个列表的行数上限。 */
export const HANA_PANEL_MAX_LIST_ITEMS = 200;
/**
 * 判定一次归一化是不是失败了。
 *
 * 直接写 `if (!result.ok)` 让 TypeScript 自己收窄，只在开了 strictNullChecks 的地方
 * 成立；本仓库的 tsconfig.test.json 关着它，判别联合在那里收不出来，于是同一段代码
 * 在两个 config 下一个过一个不过。用显式的类型谓词说清楚"ok 为 false 时是哪一支"，
 * 两种严格度下都成立，也不必让调用方去记住这条隐式前提。
 */
export function isHanaPanelNormalizeFailure(result) {
    return result.ok === false;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function optionalText(value) {
    const found = text(value);
    return found ?? undefined;
}
function tone(value) {
    const found = text(value);
    return found && PANEL_TONE_SET.has(found) ? found : undefined;
}
function activation(value) {
    if (!isRecord(value))
        return undefined;
    const kind = text(value.kind);
    if (kind === "focus-card")
        return { kind: "focus-card" };
    if (kind === "emit")
        return { kind: "emit" };
    return undefined;
}
function normalizeRefresh(value) {
    if (!isRecord(value))
        return null;
    const raw = value.intervalMs;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
        return null;
    return {
        intervalMs: Math.max(HANA_PANEL_MIN_REFRESH_MS, Math.floor(raw)),
        pauseWhenHidden: value.pauseWhenHidden !== false,
    };
}
function normalizeSection(raw, index) {
    if (!isRecord(raw))
        return { error: `sections[${index}] is not an object` };
    const kind = text(raw.kind);
    const id = text(raw.id) ?? `section-${index}`;
    switch (kind) {
        case "section": {
            const title = text(raw.title);
            if (!title)
                return { error: `sections[${index}] (section) needs a title` };
            return { kind: "section", id, title, hint: optionalText(raw.hint) };
        }
        case "status": {
            const label = text(raw.label);
            const value = text(raw.value);
            if (!label || !value)
                return { error: `sections[${index}] (status) needs a label and a value` };
            return {
                kind: "status",
                id,
                label,
                value,
                delta: optionalText(raw.delta),
                deltaTone: tone(raw.deltaTone),
            };
        }
        case "list": {
            if (!Array.isArray(raw.items))
                return { error: `sections[${index}] (list) needs an items array` };
            const items = [];
            for (const rawItem of raw.items.slice(0, HANA_PANEL_MAX_LIST_ITEMS)) {
                if (!isRecord(rawItem))
                    continue;
                const itemId = text(rawItem.id);
                const title = text(rawItem.title);
                if (!itemId || !title)
                    continue;
                items.push({
                    id: itemId,
                    title,
                    subtitle: optionalText(rawItem.subtitle),
                    meta: optionalText(rawItem.meta),
                    badge: optionalText(rawItem.badge),
                    selected: rawItem.selected === true,
                    disabled: rawItem.disabled === true,
                    activation: activation(rawItem.activation),
                });
            }
            return { kind: "list", id, items, emptyText: optionalText(raw.emptyText) };
        }
        case "pills": {
            if (!Array.isArray(raw.items))
                return { error: `sections[${index}] (pills) needs an items array` };
            const items = [];
            for (const rawItem of raw.items) {
                if (!isRecord(rawItem))
                    continue;
                const itemId = text(rawItem.id);
                const label = text(rawItem.label);
                if (!itemId || !label)
                    continue;
                items.push({
                    id: itemId,
                    label,
                    selected: rawItem.selected === true,
                    disabled: rawItem.disabled === true,
                });
            }
            if (items.length === 0)
                return { error: `sections[${index}] (pills) has no usable items` };
            return { kind: "pills", id, items };
        }
        case "bar": {
            const ratio = typeof raw.ratio === "number" && Number.isFinite(raw.ratio) ? raw.ratio : null;
            if (ratio === null)
                return { error: `sections[${index}] (bar) needs a numeric ratio` };
            return {
                kind: "bar",
                id,
                ratio: Math.min(1, Math.max(0, ratio)),
                label: optionalText(raw.label),
                value: optionalText(raw.value),
                tone: tone(raw.tone),
            };
        }
        case "meta": {
            const value = text(raw.text);
            if (!value)
                return { error: `sections[${index}] (meta) needs text` };
            return { kind: "meta", id, text: value };
        }
        case "actions": {
            if (!Array.isArray(raw.items))
                return { error: `sections[${index}] (actions) needs an items array` };
            const items = [];
            for (const rawItem of raw.items) {
                if (!isRecord(rawItem))
                    continue;
                const itemId = text(rawItem.id);
                const label = text(rawItem.label);
                if (!itemId || !label)
                    continue;
                items.push({
                    id: itemId,
                    label,
                    tone: tone(rawItem.tone),
                    disabled: rawItem.disabled === true,
                    activation: activation(rawItem.activation),
                });
            }
            if (items.length === 0)
                return { error: `sections[${index}] (actions) has no usable items` };
            return { kind: "actions", id, items };
        }
        case "toggle": {
            const label = text(raw.label);
            if (!label)
                return { error: `sections[${index}] (toggle) needs a label` };
            return { kind: "toggle", id, label, checked: raw.checked === true, disabled: raw.disabled === true };
        }
        case "text": {
            const value = text(raw.text);
            if (!value)
                return { error: `sections[${index}] (text) needs text` };
            return { kind: "text", id, text: value, tone: tone(raw.tone) };
        }
        default:
            return { error: `sections[${index}] has unknown kind "${String(kind)}"` };
    }
}
/**
 * 校验并归一化一次面板内容推送。
 *
 * 逐段容错：一段写坏了只丢那一段，其余照常显示，坏掉的原因原样带回给调用方
 * 转交插件诊断——面板是应用主 chrome 的一部分，不能因为一段畸形声明整块空掉，
 * 也不能假装什么都没发生。
 */
export function normalizeHanaPanelProps(raw) {
    if (!isRecord(raw))
        return { ok: false, reason: "panel props must be an object" };
    if (!Array.isArray(raw.sections))
        return { ok: false, reason: "panel props need a sections array" };
    const sections = [];
    const dropped = [];
    raw.sections.slice(0, HANA_PANEL_MAX_SECTIONS).forEach((rawSection, index) => {
        const normalized = normalizeSection(rawSection, index);
        if ("error" in normalized)
            dropped.push(normalized.error);
        else
            sections.push(normalized);
    });
    if (raw.sections.length > HANA_PANEL_MAX_SECTIONS) {
        dropped.push(`sections beyond ${HANA_PANEL_MAX_SECTIONS} were ignored`);
    }
    return { ok: true, props: { sections, refresh: normalizeRefresh(raw.refresh) }, dropped };
}
//# sourceMappingURL=plugin-panel-descriptor.js.map