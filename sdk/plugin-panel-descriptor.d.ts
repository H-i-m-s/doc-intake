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
export declare const HANA_PANEL_KIND: "hana.panel";
export declare const HANA_PANEL_VERSION: 1;
/** 语义色。宿主只认这几档，具体色值由主题决定。 */
export declare const HANA_PANEL_TONES: readonly ["neutral", "info", "success", "warning", "danger"];
export type HanaPanelTone = (typeof HANA_PANEL_TONES)[number];
/** 行/按钮被激活时做什么。emit 之外的动词必须是宿主才做得到的事。 */
export type HanaPanelActivation = 
/** 回传给插件，插件自己决定后续（默认） */
{
    kind: "emit";
}
/** 让宿主把用户带回这个插件自己的主卡 */
 | {
    kind: "focus-card";
};
export interface HanaPanelListItem {
    id: string;
    title: string;
    subtitle?: string;
    /** 行尾的短文本，例如时间或计数 */
    meta?: string;
    /** 行尾的徽标数字/短标签 */
    badge?: string;
    selected?: boolean;
    disabled?: boolean;
    activation?: HanaPanelActivation;
}
export interface HanaPanelPillItem {
    id: string;
    label: string;
    selected?: boolean;
    disabled?: boolean;
}
export interface HanaPanelActionItem {
    id: string;
    label: string;
    tone?: HanaPanelTone;
    disabled?: boolean;
    activation?: HanaPanelActivation;
}
export type HanaPanelSection = 
/** 分组标题；后续同级 section 归它管辖，纯视觉分隔 */
{
    kind: "section";
    id: string;
    title: string;
    hint?: string;
}
/** 标签 + 值 + 可选变化量。值与变化量都是插件格式化好的字符串 */
 | {
    kind: "status";
    id: string;
    label: string;
    value: string;
    delta?: string;
    deltaTone?: HanaPanelTone;
}
/** 同构可选列表，面板里最常见的主体 */
 | {
    kind: "list";
    id: string;
    items: HanaPanelListItem[];
    emptyText?: string;
}
/** 分段筛选组 */
 | {
    kind: "pills";
    id: string;
    items: HanaPanelPillItem[];
}
/** 比例条。ratio 落在 0..1，超出由宿主夹紧 */
 | {
    kind: "bar";
    id: string;
    ratio: number;
    label?: string;
    value?: string;
    tone?: HanaPanelTone;
}
/** 次要信息行，例如"最后更新于…" */
 | {
    kind: "meta";
    id: string;
    text: string;
}
/** 按钮行 */
 | {
    kind: "actions";
    id: string;
    items: HanaPanelActionItem[];
}
/** 开关行 */
 | {
    kind: "toggle";
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
}
/** 说明文案 / 空态 */
 | {
    kind: "text";
    id: string;
    text: string;
    tone?: HanaPanelTone;
};
export interface HanaPanelRefresh {
    /** 宿主按这个间隔请求插件刷新；低于下限会被夹紧 */
    intervalMs: number;
    /**
     * 面板不可见时是否暂停（默认 true）。放在宿主执行而不是插件自己计时，是因为
     * 已发布的插件各写各的定时器，总有人忘记暂停，面板收起来了还在后台轮询。
     */
    pauseWhenHidden?: boolean;
}
export interface HanaPanelProps {
    sections: HanaPanelSection[];
    refresh?: HanaPanelRefresh | null;
}
export interface HanaPanelDescriptor {
    kind: typeof HANA_PANEL_KIND;
    version: typeof HANA_PANEL_VERSION;
    props: HanaPanelProps;
}
/** 刷新间隔下限：比这更密的轮询对侧栏没有意义，只会烧电。 */
export declare const HANA_PANEL_MIN_REFRESH_MS = 1000;
/** 单次推送的 section 上限：面板是竖条，超过这个数就不是面板该干的事了。 */
export declare const HANA_PANEL_MAX_SECTIONS = 64;
/** 单个列表的行数上限。 */
export declare const HANA_PANEL_MAX_LIST_ITEMS = 200;
/** 归一化失败的那一支：只带失败原因，没有 props。 */
export type HanaPanelNormalizeFailure = {
    ok: false;
    reason: string;
};
export type HanaPanelNormalizeResult = {
    ok: true;
    props: HanaPanelProps;
    dropped: string[];
} | HanaPanelNormalizeFailure;
/**
 * 判定一次归一化是不是失败了。
 *
 * 直接写 `if (!result.ok)` 让 TypeScript 自己收窄，只在开了 strictNullChecks 的地方
 * 成立；本仓库的 tsconfig.test.json 关着它，判别联合在那里收不出来，于是同一段代码
 * 在两个 config 下一个过一个不过。用显式的类型谓词说清楚"ok 为 false 时是哪一支"，
 * 两种严格度下都成立，也不必让调用方去记住这条隐式前提。
 */
export declare function isHanaPanelNormalizeFailure(result: HanaPanelNormalizeResult): result is HanaPanelNormalizeFailure;
/**
 * 校验并归一化一次面板内容推送。
 *
 * 逐段容错：一段写坏了只丢那一段，其余照常显示，坏掉的原因原样带回给调用方
 * 转交插件诊断——面板是应用主 chrome 的一部分，不能因为一段畸形声明整块空掉，
 * 也不能假装什么都没发生。
 */
export declare function normalizeHanaPanelProps(raw: unknown): HanaPanelNormalizeResult;
//# sourceMappingURL=plugin-panel-descriptor.d.ts.map