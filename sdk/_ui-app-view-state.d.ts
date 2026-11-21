/**
 * app-view-state.ts — generated from shared/app-view-state.ts
 * by `node scripts/sync-plugin-sdk-shared.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Client view snapshot kernel（纯边界）。
 *
 * 一个 App 卡在两个宿主/形态上跑时，各端想记住自己的界面位置（列表滚动、
 * 选中项、面板展开……）。这份内核只做一件事：把「当前客户端归属下的视图
 * 快照」读写这一层的形状、校验、隔离与版本 CAS 说清楚，且只有纯函数。
 *
 * 它不承担授权：跨文档必须由当前文档握手 token + Host captured identity 拒绝
 * 旧文档消息，revision 本身不能证明文档身份。内核只在**已授权**的调用点被使用，
 * 归属参数由宿主提供，作者不得提交任何归属参数。
 *
 * 与 hana.state 分开：这里只读写 `card.rendererState.appViewState` 这**一个**
 * 字段，不碰业务数据、不碰其它 rendererState 字段，也不新建全局 store。持久化
 * 与渲染由调用方负责，本模块只产出并校验 envelope。
 */
/** 存储 schema 版本；非 1 的已存数据按未知 schema 明确报错，不回退。 */
export declare const APP_VIEW_STATE_SCHEMA_VERSION = 1;
/** 两个互相独立的视图位。compact 与 detached 各有各的 revision 与 state。 */
export declare const APP_VIEW_STATE_KINDS: readonly ["compact", "detached"];
/** 数据递归深度上限；顶层 state 记为深度 0。 */
export declare const APP_VIEW_STATE_JSON_MAX_DEPTH = 16;
/** 单个 state 遍历节点总数上限（含容器与标量，重复引用按访问次数计）。 */
export declare const APP_VIEW_STATE_MAX_NODES = 4096;
/** 单个 state 序列化后（含 JSON 标点、键名、转义）的 UTF-8 字节上限。 */
export declare const APP_VIEW_STATE_SNAPSHOT_MAX_BYTES: number;
/** 完整 envelope 序列化后的 UTF-8 字节上限，包含两种 view 快照，绝不淘汰其一。 */
export declare const APP_VIEW_STATE_ENVELOPE_MAX_BYTES: number;
/** hostId/profileId/appId/cardInstanceId 各自的最大 UTF-16 单元数。 */
export declare const APP_VIEW_STATE_IDENTITY_FIELD_MAX_LENGTH = 256;
/** bindingKey 的最大 UTF-16 单元数。 */
export declare const APP_VIEW_STATE_BINDING_KEY_MAX_LENGTH = 4096;
export type AppViewKind = (typeof APP_VIEW_STATE_KINDS)[number];
/**
 * 客户端归属。宿主提供 Host 稳定身份、服务器返回的 profileId（即使 profile
 * 不存在也会返回）、App 与卡实例/业务绑定。字段原样保留、不 trim，供 opaque
 * 键（如 bindingKey）精确匹配。
 */
export interface AppViewStateIdentity {
    hostId: string;
    profileId: string;
    appId: string;
    cardInstanceId: string;
    bindingKey: string;
}
export type AppViewStateJson = null | boolean | number | string | AppViewStateJson[] | {
    [key: string]: AppViewStateJson;
};
export interface AppViewStateSnapshot {
    revision: number;
    state: {
        [key: string]: AppViewStateJson;
    } | null;
}
export interface AppViewStateEnvelope {
    schemaVersion: 1;
    identity: AppViewStateIdentity;
    views: {
        compact?: AppViewStateSnapshot;
        detached?: AppViewStateSnapshot;
    };
}
export type AppViewStateErrorCode = "VIEW_STATE_INVALID_INPUT" | "VIEW_STATE_TOO_LARGE" | "VIEW_STATE_INVALID_STORAGE" | "VIEW_STATE_STALE" | "VIEW_STATE_REVISION_EXHAUSTED";
export declare class AppViewStateError extends Error {
    readonly code: AppViewStateErrorCode;
    constructor(code: AppViewStateErrorCode, message: string);
}
/**
 * 严格校验并深克隆一份顶层 state（JSON 对象或 null）。
 *
 * 这是 Host 与 App SDK 共用的**唯一**一份「输入态」校验入口：拿到的是一份可以
 * 安全持有、不会被后续外部变异改动的克隆，或用 `VIEW_STATE_INVALID_INPUT` /
 * `VIEW_STATE_TOO_LARGE` 明确报错。只走「输入」语境（24KiB/state、严格 JSON、
 * 深度与节点预算），不读存储、不碰 identity/CAS，因此调用方不需要借一次 dummy
 * write 来触发校验副作用。
 */
export declare function normalizeAppViewStateValue(value: unknown): {
    [key: string]: AppViewStateJson;
} | null;
/**
 * 读取当前归属在某视图位上的快照。
 *
 * raw 只代表 `rendererState.appViewState` 字段本身。undefined/null 视为旧数据
 * 没有快照，读 `{revision:0, state:null}`，不做迁移、不主动落盘。已存数据先严格
 * 校验，再按 identity 五字段逐字匹配：不匹配即视为本客户端尚无快照，绝不返回
 * 另一方 state。这是明确的客户端隔离语义，不是故障回退。
 */
export declare function readAppViewState(raw: unknown, identity: AppViewStateIdentity, kind: AppViewKind): AppViewStateSnapshot;
/**
 * 在 CAS 保护下写入当前归属的某个视图位。
 *
 * 顺序遵循严格错误优先：先调用参数形状（identity/kind/input 与输入 state 的
 * JSON 合法性及字节预算），再已存 raw 完整性，再 revision CAS，最后构造新
 * envelope 的字节预算。只替换目标槽，另一槽逐值克隆保留；不修改任何传入对象。
 * 它不做授权判定，归属参数由已授权的调用方提供。
 */
export declare function writeAppViewState(raw: unknown, identity: AppViewStateIdentity, kind: AppViewKind, input: {
    expectedRevision: number;
    state: {
        [key: string]: AppViewStateJson;
    } | null;
}): AppViewStateEnvelope;
