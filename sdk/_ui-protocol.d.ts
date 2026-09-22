export declare const PLUGIN_UI_PROTOCOL: "hana.plugin.ui";
export declare const PLUGIN_UI_PROTOCOL_VERSION: 1;
/**
 * App surface session 的线协议名（#1629，v2 应用通道续用同一套设计）：宿主把
 * 会话凭证以 `APP_SURFACE_SESSION_QUERY` 追加在 iframe src 上；iframe 页面调用
 * 本应用自己的 route handler 时通过 `APP_SURFACE_SESSION_HEADER`（或同名 query）
 * 回传。服务端、桌面宿主与 iframe SDK 共用这一份定义。
 *
 * `APP_IFRAME_TICKET_QUERY` 是另一枚凭证：只负责这份 `ui/` 文档本身的装载，不
 * 是请求级入口凭证。协议包不能 import `shared/`（独立发布），这里的三个值必须
 * 与 `shared/app-ui.ts`、`core/app-iframe-ticket-service.ts` 手动保持字面量一致
 * —— `tests/plugin-protocol-app-surface-parity.test.ts` 钉住这一致性。
 */
export declare const APP_SURFACE_SESSION_HEADER: "X-Hana-App-Surface-Session";
export declare const APP_SURFACE_SESSION_QUERY: "appSurfaceSession";
export declare const APP_IFRAME_TICKET_QUERY: "appIframeTicket";
/** Host-owned input-panel messages. App pages can provide values, never grant permissions. */
export declare const APP_INPUT_PANEL_MESSAGE: {
    readonly CONTEXT: "hana.input-panel.context";
    readonly SUBMIT: "hana.input-panel.submit";
    readonly PRESENTATION: "hana.input-panel.presentation";
};
export declare const APP_INPUT_PANEL_DATA_MAX_BYTES: number;
export interface AppInputPanelContext {
    appId: string;
    sessionId: string;
    panelId: string;
    /** Identity of this mounted document, replaced whenever the document is reloaded. */
    instanceId: string;
    revision: number;
    presentationRevision: number;
    confirmId: string | null;
    status: 'pending' | 'confirmed' | 'rejected' | 'timeout' | 'aborted' | 'active';
    retained: boolean;
    title: string;
    message: string;
    data: unknown;
    requestedSchema: unknown;
    presentation: {
        height: number | null;
        collapsedHeight: number;
        expanded: boolean;
    };
}
export interface AppInputPanelSubmitRequest {
    panelId: string;
    instanceId: string;
    revision: number;
}
export interface AppInputPanelSubmitResult extends AppInputPanelSubmitRequest {
    value: unknown;
}
/**
 * Plugin surface session 的线协议名（#1629）：宿主把会话凭证以
 * `PLUGIN_SURFACE_SESSION_QUERY` 追加在 iframe src 上；iframe 页面调用本插件
 * route handler 时通过 `PLUGIN_SURFACE_SESSION_HEADER`（或同名 query）回传。
 * 服务端、桌面宿主与 iframe SDK 共用这一份定义。
 *
 * v1 插件线的冻结兼容层名字，与上面 v2 App 的 APP_SURFACE_SESSION_* 是各自独立
 * 的线协议常量：v1 插件已经装在用户机器上，线上协议名不能跟着 v2 改名，两套
 * 名字长期并存。
 */
export declare const PLUGIN_SURFACE_SESSION_HEADER: "X-Hana-Plugin-Surface-Session";
export declare const PLUGIN_SURFACE_SESSION_QUERY: "pluginSurfaceSession";
export declare const PLUGIN_UI_ERROR_CODE: {
    readonly BAD_MESSAGE: "BAD_MESSAGE";
    readonly UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION";
    readonly UNKNOWN_TYPE: "UNKNOWN_TYPE";
    readonly CAPABILITY_DENIED: "CAPABILITY_DENIED";
    readonly SLOT_DENIED: "SLOT_DENIED";
    readonly TIMEOUT: "TIMEOUT";
    readonly HOST_ERROR: "HOST_ERROR";
};
export declare const PLUGIN_UI_CAPABILITY: {
    readonly TOAST_SHOW: "toast.show";
    readonly EXTERNAL_OPEN: "external.open";
    readonly SESSION_FILE_OPEN: "sessionFile.open";
    readonly RESOURCE_OPEN: "resource.open";
    readonly RESOURCE_PICK: "resource.pick";
    readonly RESOURCE_SAVE_FILE: "resource.saveFile";
    readonly RESOURCE_REQUEST_ACCESS: "resource.requestAccess";
    readonly UI_RESIZE: "ui.resize";
    readonly CLIPBOARD_WRITE_TEXT: "clipboard.writeText";
    readonly STATE_GET: "hana.state.get";
    readonly STATE_SET: "hana.state.set";
    readonly STORAGE_GET: "hana.storage.get";
    readonly STORAGE_GET_ALL: "hana.storage.getAll";
    readonly STORAGE_SET: "hana.storage.set";
    readonly STORAGE_DELETE: "hana.storage.delete";
    readonly PANEL_SET: "hana.panel.set";
    readonly EMIT: "hana.emit";
    readonly TRACK: "hana.track";
    readonly UI_ACTION: "hana.ui.action";
};
export declare const PLUGIN_UI_HOST_EVENT: {
    readonly THEME_CHANGED: "hana.theme.changed";
    readonly SURFACE_RUNTIME_CHANGED: "hana.surface.runtime.changed";
    readonly SURFACE_ENVELOPE_CHANGED: "hana.surface.envelope.changed";
    readonly STORAGE_CHANGED: "hana.storage.changed";
    readonly PANEL_EVENT: "hana.panel.event";
    readonly PANEL_REFRESH: "hana.panel.refresh";
};
/**
 * 插件卡两层状态的错误码族（自成一族，不与 interactive-card 的 CARD_HOST_* 混用）。
 * 实例态超限、应用态配额透传、缺 card 上下文等显式报错，禁止静默降级。
 *
 * 应用态（hana.storage）属于 v1 插件的冻结兼容层，与上面的实例态 hana.state
 * （v1、v2 通用）并存，互不影响：v1 专属，后端 `/api/plugins/:id/storage` 只服务
 * 已安装的 v1 插件。
 */
export declare const PLUGIN_STATE_STORAGE_ERROR_CODE: {
    readonly STATE_PAYLOAD_REQUIRED: "PLUGIN_STATE_PAYLOAD_REQUIRED";
    readonly STATE_KEY_REQUIRED: "PLUGIN_STATE_KEY_REQUIRED";
    readonly STATE_TOO_LARGE: "PLUGIN_STATE_TOO_LARGE";
    readonly STATE_CARD_CONTEXT_REQUIRED: "PLUGIN_STATE_CARD_CONTEXT_REQUIRED";
    readonly STATE_CARD_NOT_FOUND: "PLUGIN_STATE_CARD_NOT_FOUND";
    readonly STORAGE_KEY_REQUIRED: "PLUGIN_STORAGE_KEY_REQUIRED";
    readonly STORAGE_QUOTA_EXCEEDED: "PLUGIN_STORAGE_QUOTA_EXCEEDED";
    readonly STORAGE_VALUE_TOO_LARGE: "PLUGIN_STORAGE_VALUE_TOO_LARGE";
    readonly STORAGE_HOST_ERROR: "PLUGIN_STORAGE_HOST_ERROR";
};
/**
 * 插件卡回传错误码族（自成一族，不与 interactive-card 的 CARD_HOST_* 混用）。
 */
export declare const PLUGIN_EMIT_ERROR_CODE: {
    readonly INPUT_INVALID: "PLUGIN_EMIT_INPUT_INVALID";
    readonly CARD_CONTEXT_REQUIRED: "PLUGIN_EMIT_CARD_CONTEXT_REQUIRED";
    readonly APP_NOT_LOADED: "PLUGIN_EMIT_APP_NOT_LOADED";
    readonly UNAUTHORIZED: "PLUGIN_EMIT_UNAUTHORIZED";
    readonly SESSION_REQUIRED: "PLUGIN_EMIT_SESSION_REQUIRED";
    readonly SESSION_NOT_FOUND: "PLUGIN_EMIT_SESSION_NOT_FOUND";
    readonly SESSION_DELETED: "PLUGIN_EMIT_SESSION_DELETED";
    readonly SESSION_LOCATOR_REQUIRED: "PLUGIN_EMIT_SESSION_LOCATOR_REQUIRED";
    readonly NO_ROUTE: "PLUGIN_EMIT_NO_ROUTE";
    readonly RATE_LIMITED: "PLUGIN_EMIT_RATE_LIMITED";
    readonly HOST_ERROR: "PLUGIN_EMIT_HOST_ERROR";
};
export declare const PLUGIN_TRACK_ERROR_CODE: {
    readonly INPUT_INVALID: "PLUGIN_TRACK_INPUT_INVALID";
    readonly CARD_CONTEXT_REQUIRED: "PLUGIN_TRACK_CARD_CONTEXT_REQUIRED";
    readonly APP_NOT_LOADED: "PLUGIN_TRACK_APP_NOT_LOADED";
    readonly RATE_LIMITED: "PLUGIN_TRACK_RATE_LIMITED";
    readonly HOST_ERROR: "PLUGIN_TRACK_HOST_ERROR";
};
export type PluginTrackErrorCode = (typeof PLUGIN_TRACK_ERROR_CODE)[keyof typeof PLUGIN_TRACK_ERROR_CODE];
export type PluginEmitErrorCode = (typeof PLUGIN_EMIT_ERROR_CODE)[keyof typeof PLUGIN_EMIT_ERROR_CODE];
/** 插件卡实例态上限：与 interactive-card 同构的 64KB（Book One v0 instance-state limit）。 */
export declare const PLUGIN_CARD_STATE_MAX_BYTES: number;
export type PluginStateStorageErrorCode = (typeof PLUGIN_STATE_STORAGE_ERROR_CODE)[keyof typeof PLUGIN_STATE_STORAGE_ERROR_CODE];
/**
 * v2 App 应用态（hana.app.storage）错误码族。自成一族而不是并进
 * `PLUGIN_STATE_STORAGE_ERROR_CODE`：那族的 STORAGE_* 三个码名字带
 * "PLUGIN_STORAGE"前缀、值也已经绑定 v1 的 server 错误码字面量
 * （PLUGIN_STORAGE_QUOTA_EXCEEDED 等，来自 core/plugin-storage-store.ts），
 * v2 的 server 错误码是新的 APP_STORAGE_* 字面量（lib/app-storage/app-storage-store.ts /
 * server/routes/apps-storage.ts），透传时不应该被改名成 v1 的码。
 * 没有「单键过大」码——v2 无每键上限，只有整作用域配额。
 */
export declare const APP_STORAGE_ERROR_CODE: {
    readonly SCOPE_REQUIRED: "APP_STORAGE_SCOPE_REQUIRED";
    readonly KEY_REQUIRED: "APP_STORAGE_KEY_REQUIRED";
    readonly QUOTA_EXCEEDED: "APP_STORAGE_QUOTA_EXCEEDED";
    readonly HOST_ERROR: "APP_STORAGE_HOST_ERROR";
};
export type AppStorageErrorCode = (typeof APP_STORAGE_ERROR_CODE)[keyof typeof APP_STORAGE_ERROR_CODE];
export declare const PLUGIN_RESOURCE_CAPABILITY: {
    readonly READ: "resource.read";
    readonly SEARCH: "resource.search";
    readonly WRITE: "resource.write";
    readonly MATERIALIZE: "resource.materialize";
    readonly WATCH: "resource.watch";
};
/**
 * v2 App 应用态请求词（两作用域 global/agent，appId 命名空间，经宿主 owner
 * 凭证代调 server `/api/apps/:id/storage`）。独立于上面 `PLUGIN_UI_CAPABILITY`
 * 的 v1 `STORAGE_*` 四个词，逐字对照 `PLUGIN_RESOURCE_CAPABILITY` 的先例——
 * 自成一族而不是并进 `PLUGIN_UI_CAPABILITY`：那个常量对象的形状被
 * `tests/plugin-abi-freeze.test.ts` 逐项冻结成 v1 ABI 的一部分，往里面加
 * v2 专属的词会把这份冻结快照带红，即使 v1 自己的十八个词一个没少。与
 * `hana.state` 同级：不加能力词门（requiresGrant: false）。
 */
export declare const APP_STORAGE_CAPABILITY: {
    readonly GET: "hana.app.storage.get";
    readonly GET_ALL: "hana.app.storage.getAll";
    readonly SET: "hana.app.storage.set";
    readonly DELETE: "hana.app.storage.delete";
    readonly KEYS: "hana.app.storage.keys";
};
/**
 * v2 App 应用态变更广播：宿主消费 server 的 `app-storage-changed` 后，向同
 * appId 的所有已挂载 App 卡 iframe 推送 `{ scope, keys }`（不带值）。独立于
 * `PLUGIN_UI_HOST_EVENT` 的 v1 `STORAGE_CHANGED`，理由同上——不进那个已被
 * ABI 冻结测试逐项钉住的常量对象。
 */
export declare const APP_STORAGE_HOST_EVENT: {
    readonly CHANGED: "hana.app.storage.changed";
};
/** Open or reveal a card declared by the authenticated App itself. */
export declare const APP_CARD_CAPABILITY: {
    readonly OPEN: "hana.cards.open";
};
/**
 * v2 App-only active chat session operations. Kept out of the frozen v1 UI
 * capability map because they are available only to App iframe surfaces.
 */
export declare const APP_SESSION_CAPABILITY: {
    readonly GET_ACTIVE: "hana.sessions.get-active";
    readonly SUBSCRIBE: "hana.sessions.subscribe-active";
    readonly UNSUBSCRIBE: "hana.sessions.unsubscribe-active";
    readonly FOCUS: "hana.sessions.focus";
};
/** v2 App-only active chat session events sent from the host to an iframe. */
export declare const APP_SESSION_HOST_EVENT: {
    readonly ACTIVE_CHANGED: "hana.sessions.active-changed";
    readonly ERROR: "hana.sessions.error";
};
export interface AppActiveSession {
    sessionId: string;
    sessionPath: string;
    title: string | null;
    agentId: string | null;
}
export interface AppActiveSessionChanged {
    previous: AppActiveSession | null;
    current: AppActiveSession | null;
    timestamp: number;
}
/** v2 App iframe-only surface request; kept outside frozen v1 capability maps. */
export declare const APP_SURFACE_CAPABILITY: {
    readonly SET_INTERACTIVE_REGIONS: "hana.surface.set-interactive-regions";
};
export interface AppSurfaceInteractiveRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface AppSurfaceInteractiveRegionsInput {
    regions: AppSurfaceInteractiveRegion[];
}
export declare function parseAppSurfaceInteractiveRegions(value: unknown): {
    ok: true;
    value: AppSurfaceInteractiveRegionsInput;
} | {
    ok: false;
    error: string;
};
export interface AppCardOpenResult {
    cardInstanceId: string;
    existing: boolean;
    detached: boolean;
}
/** v2 App-only host metadata; kept out of the frozen v1 host-event vocabulary. */
export declare const APP_SURFACE_HOST_EVENT: {
    readonly CONTEXT: "hana.surface.context";
};
export type AppStorageCapabilityName = (typeof APP_STORAGE_CAPABILITY)[keyof typeof APP_STORAGE_CAPABILITY];
export type AppStorageHostEventName = (typeof APP_STORAGE_HOST_EVENT)[keyof typeof APP_STORAGE_HOST_EVENT];
export type AppSessionCapabilityName = (typeof APP_SESSION_CAPABILITY)[keyof typeof APP_SESSION_CAPABILITY];
export type AppSessionHostEventName = (typeof APP_SESSION_HOST_EVENT)[keyof typeof APP_SESSION_HOST_EVENT];
export type PluginUiErrorCode = (typeof PLUGIN_UI_ERROR_CODE)[keyof typeof PLUGIN_UI_ERROR_CODE];
export type PluginUiCapabilityName = (typeof PLUGIN_UI_CAPABILITY)[keyof typeof PLUGIN_UI_CAPABILITY];
export type PluginResourceCapabilityName = (typeof PLUGIN_RESOURCE_CAPABILITY)[keyof typeof PLUGIN_RESOURCE_CAPABILITY];
export type PluginUiHostEventName = (typeof PLUGIN_UI_HOST_EVENT)[keyof typeof PLUGIN_UI_HOST_EVENT];
export type PluginResourceRef = {
    kind: 'local-file';
    path: string;
} | {
    kind: 'mount';
    mountId: string;
    path: string;
} | {
    kind: 'session-file';
    fileId: string;
    sessionId?: string;
    sessionPath?: string;
} | {
    kind: 'resource';
    resourceId: string;
} | {
    kind: 'url';
    url: string;
};
export interface PluginResourceVersion {
    mtimeMs?: number;
    size?: number | null;
    sha256?: string;
    etag?: string;
    sequence?: number;
}
export type PluginResourceDescriptor = PluginResourceRef & {
    provider?: string;
    filePath?: string;
    displayName?: string;
};
export interface PluginResourceStat {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    exists: boolean;
    isDirectory: boolean;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceReadResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    content: Uint8Array;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceMutationResult {
    changeType: 'created' | 'modified';
    resourceKey: string;
    resource: PluginResourceDescriptor;
    version?: PluginResourceVersion;
    filePath?: string;
}
export interface PluginResourceWriteConflictResult {
    ok: false;
    conflict: true;
    resourceKey: string;
    resource: PluginResourceDescriptor;
    version?: PluginResourceVersion;
    filePath?: string;
}
export type PluginResourceWriteExpectedVersionResult = PluginResourceMutationResult | PluginResourceWriteConflictResult;
export interface PluginResourceMoveResult {
    oldResourceKey: string;
    newResourceKey: string;
    oldResource: PluginResourceDescriptor;
    newResource: PluginResourceDescriptor;
    oldFilePath?: string;
    newFilePath?: string;
}
export interface PluginResourceTrashOptions {
    namespace?: string;
    metadata?: Record<string, unknown>;
}
export interface PluginResourceTrashResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    trashId: string;
    trashPath?: string;
    payloadPath?: string;
    filePath?: string;
}
export interface PluginResourceEdit {
    oldText: string;
    newText: string;
}
export interface PluginResourceListItem {
    name: string;
    isDirectory: boolean;
    size: number | null;
    mtimeMs: number;
}
export interface PluginResourceListResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    items: PluginResourceListItem[];
}
export interface PluginResourceSearchOptions {
    query?: string;
    [key: string]: unknown;
}
export interface PluginResourceSearchMatch {
    filePath: string;
    line: number;
    text: string;
    name?: string;
    relativePath?: string;
    parentSubdir?: string;
    isDirectory?: boolean;
    size?: number | null;
    mtimeMs?: number;
}
export interface PluginResourceSearchResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    matches: PluginResourceSearchMatch[];
}
export interface PluginResourceMaterializeResult {
    resourceKey: string;
    resource: PluginResourceDescriptor;
    filePath: string;
    version?: PluginResourceVersion;
}
export interface PluginResourceWatchTarget {
    ref?: PluginResourceRef;
    filePath: string;
    isDirectory?: boolean;
    resourceKey: string;
    resource: PluginResourceDescriptor;
}
export interface PluginResourceEventCursor {
    streamId?: string;
    sequence: number;
    occurredAt?: string;
}
export interface PluginResourceError {
    code: string;
    message: string;
    capability?: PluginResourceCapabilityName | string;
    resource?: PluginResourceDescriptor;
    cursor?: PluginResourceEventCursor;
    safeMessage?: string;
    details?: unknown;
}
export interface PluginResourceOpenInput {
    resource: PluginResourceRef | Record<string, unknown>;
    mode?: 'preview' | 'reveal' | 'download' | string;
}
export interface PluginResourceOpenResult {
    opened: boolean;
}
export interface PluginResourcePickInput {
    mode?: 'file' | 'directory' | string;
    multiple?: boolean;
    capability?: PluginResourceCapabilityName | string;
}
export interface PluginResourcePickResult {
    resources: Array<PluginResourceRef | Record<string, unknown>>;
}
/** A user-facing save request. The iframe never supplies a destination path. */
export interface PluginResourceSaveFileInput {
    suggestedName: string;
    mimeType: string;
    contentBase64: string;
}
export type PluginResourceSaveFileResult = {
    kind: 'canceled';
} | {
    kind: 'saved';
    resource: {
        kind: 'local-file';
        path: string;
    };
    version: PluginResourceVersion;
    overwritten: boolean;
    saveReceipt: string;
} | {
    kind: 'conflict';
    resource: {
        kind: 'local-file';
        path: string;
    };
    version: PluginResourceVersion | null;
    /** An after-write mismatch means another writer may have replaced bytes after this save. */
    phase?: 'after-write';
    mayHaveWritten?: boolean;
}
/** A browser download was triggered; this is not evidence that bytes reached disk. */
 | {
    kind: 'download-started';
    suggestedName: string;
    mimeType: string;
};
export interface PluginResourceRequestAccessInput {
    capability: PluginResourceCapabilityName | string;
    resource?: PluginResourceRef | Record<string, unknown>;
    reason?: string;
}
export interface PluginResourceRequestAccessResult {
    granted: boolean;
    capability: PluginResourceCapabilityName | string;
}
export interface PluginStateGetInput {
    key?: string;
}
export interface PluginStateGetResult {
    state: Record<string, unknown>;
    key?: string;
    value?: unknown;
}
export interface PluginStateSetInput {
    state?: Record<string, unknown>;
    key?: string;
    value?: unknown;
    delete?: boolean;
}
export interface PluginStateSetResult {
    state: Record<string, unknown>;
}
export interface PluginStorageGetInput {
    key: string;
}
export interface PluginStorageGetResult {
    key: string;
    value: unknown;
}
export interface PluginStorageGetAllResult {
    entries: Record<string, unknown>;
}
export interface PluginStorageSetInput {
    key: string;
    value: unknown;
}
export interface PluginStorageSetResult {
    ok: true;
    key: string;
}
export interface PluginStorageDeleteInput {
    key: string;
}
export interface PluginStorageDeleteResult {
    ok: true;
    key: string;
}
export interface PluginStorageChangedEvent {
    keys: string[];
}
/**
 * v2 App 应用态（hana.storage.global / hana.storage.agent(id)）的输入/输出
 * 形状。与上面的 v1 Plugin* 系列各自独立、两套并存——两作用域，`scope`
 * 显式携带，无每键上限（无 VALUE_TOO_LARGE 对应形状），只有整作用域配额。
 */
export type AppStorageScopeInput = {
    kind: 'global';
} | {
    kind: 'agent';
    agentId?: string;
};
export interface AppStorageGetInput {
    scope: AppStorageScopeInput;
    key: string;
}
export interface AppStorageGetResult {
    key: string;
    value: unknown;
}
export interface AppStorageGetAllInput {
    scope: AppStorageScopeInput;
}
export interface AppStorageGetAllResult {
    entries: Record<string, unknown>;
}
export interface AppStorageSetInput {
    scope: AppStorageScopeInput;
    key: string;
    value: unknown;
}
export interface AppStorageSetResult {
    ok: true;
    key: string;
}
export interface AppStorageDeleteInput {
    scope: AppStorageScopeInput;
    key: string;
}
export interface AppStorageDeleteResult {
    ok: true;
    key: string;
}
export interface AppStorageKeysInput {
    scope: AppStorageScopeInput;
}
export interface AppStorageKeysResult {
    keys: string[];
}
/** Host → iframe push, `PLUGIN_UI_HOST_EVENT.APP_STORAGE_CHANGED`'s payload. */
export interface AppStorageChangedEvent {
    scope: {
        kind: 'global';
    } | {
        kind: 'agent';
        agentId: string;
    };
    keys: string[];
}
export type PluginUiSlot = 'page' | 'widget' | 'card' | 'settings' | 'function-panel' | 'slot' | 'input-panel';
/** Host-stamped surface identity metadata; it does not authorize access to another surface. */
export interface PluginSurfaceContext {
    appId: string;
    slot: Extract<PluginUiSlot, 'card' | 'settings' | 'function-panel' | 'slot' | 'input-panel'>;
    cardInstanceId: string | null;
    /** Session where this surface is embedded, when the host has one. */
    embeddedSessionId?: string | null;
    /** Session that created this surface, when the host has one. */
    originSessionId?: string | null;
}
export type PluginSurfaceMotionBudget = 'full' | 'reduced' | 'paused';
export interface PluginSurfaceRuntimeBudget {
    visible: boolean;
    active: boolean;
    maxFrameRate: number;
    motion: PluginSurfaceMotionBudget;
    slot?: PluginUiSlot;
    reason?: string;
}
export type PluginUiMessageKind = 'event' | 'request' | 'response' | 'error';
export interface PluginUiError {
    code: PluginUiErrorCode | string;
    message: string;
    details?: unknown;
}
export interface PluginUiMessage {
    protocol: typeof PLUGIN_UI_PROTOCOL;
    version: typeof PLUGIN_UI_PROTOCOL_VERSION;
    id?: string;
    kind: PluginUiMessageKind;
    type: string;
    payload?: unknown;
    error?: PluginUiError;
}
export type PluginUiParseResult = {
    ok: true;
    value: PluginUiMessage;
} | {
    ok: false;
    error: {
        code: typeof PLUGIN_UI_ERROR_CODE.BAD_MESSAGE | typeof PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION;
        message: string;
    };
};
export declare function parsePluginUiMessage(value: unknown): PluginUiParseResult;
export declare function isPluginUiMessage(value: unknown): value is PluginUiMessage;
export interface PluginManifestWarning {
    /** Dotted path of the offending field, e.g. `contributes.panels`. */
    field: string;
    /** What the host actually does with the declaration, in plain words. */
    message: string;
    /** Optional "did you mean" hint; present only when a near match exists. */
    suggestion?: string;
}
/** Top-level manifest fields the host reads. Anything else is inert. */
export declare const PLUGIN_MANIFEST_TOP_LEVEL_FIELDS: readonly ["manifestVersion", "id", "name", "version", "description", "minAppVersion", "trust", "hidden", "activationEvents", "capabilities", "sensitiveCapabilities", "permissions", "network", "formFactors", "ui", "contributes", "dev"];
/**
 * Contribution kinds the host knows how to register. `page` and `widget` are
 * frozen rather than removed: they still load, and the advice to migrate off
 * them is delivered through the deprecation channel, so this validator says
 * nothing about them.
 */
export declare const PLUGIN_MANIFEST_CONTRIBUTES_KEYS: readonly ["cards", "agentTypes", "configuration", "settingsTab", "page", "widget"];
/**
 * v2 manifest `contributes` keys. Independent of the frozen v1 table above:
 * adding a v2 word here does not change what a v1 plugin may declare.
 */
/**
 * v2 manifest `contributes` keys. Independent of the frozen v1 table above:
 * adding a v2 word here does not change what a v1 plugin may declare.
 */
export declare const PLUGIN_V2_MANIFEST_CONTRIBUTES_KEYS: readonly ["settings", "ui", "cards", "agentTypes", "messageRenderers", "providers", "nativeProviders", "previewers", "cliFlags", "homeActions"];
/** Keys one v2 `contributes.cards[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_CARD_CONTRIBUTION_KEYS: readonly ["id", "title", "description", "route", "embedUrl", "cardForm", "titlebar", "realization", "pageOf", "closable", "siteNavEntry", "fpFullPanel", "functionPanel", "detached", "detachedDefaultSize", "face", "formFactors"];
/**
 * A v2 chalkboard WebView card. `route` and `embedUrl` are mutually exclusive.
 * `route` is a `ui/`-relative path served at `/api/apps/<appId>/ui<route>`.
 * `embedUrl` is an absolute http(s) loopback URL put on the iframe `src` as
 * written — no host ticket, no wrapper page. Absent both registers the card
 * without loading an iframe.
 *
 * `cardForm` and `titlebar` have the same meaning as the v1 fields of those
 * names. A value outside the whitelist is treated as undeclared: the card
 * still registers. `realization`, `functionPanel`, and `face` follow the same
 * two-tier rule (wrong type fails the app; a wrong value is undeclared).
 * `siteNavEntry` and `fpFullPanel` are whole-page flags: a boolean on a
 * `realization: "page"` card is written through; on any other card they are
 * treated as undeclared. `pageOf` names another card in this array whose
 * `realization` is `"page"`; opening that page also places this card on it.
 * `formFactors` is the card-level form-factor filter and overrides a top-level
 * `formFactors` default when both are present.
 */
export interface PluginV2CardContribution {
    readonly id: string;
    readonly title?: string;
    /**
     * Optional model-facing summary. Same key style as `contributes.agentTypes[].description`.
     * Omitted, empty, or a non-string is undeclared; consumers fall back to `title`.
     */
    readonly description?: string;
    readonly route?: string;
    /** A complete App UI document for a detached card, including its navigation. */
    readonly detached?: {
        readonly route: string;
    };
    /** Initial CSS-pixel size for a newly detached card window. */
    readonly detachedDefaultSize?: {
        readonly width: number;
        readonly height: number;
    };
    readonly embedUrl?: string;
    /**
     * How content meets the card body (`framed` / `flush`). Same meaning as v1
     * `contributes.cards[].cardForm`. Omitted keeps the historical look; a value
     * outside the whitelist is treated as undeclared.
     */
    readonly cardForm?: string;
    /**
     * Title bar material (`solid` / `translucent`). Same meaning as v1
     * `contributes.cards[].titlebar`. Omitted is solid; a value outside the
     * whitelist is treated as undeclared.
     */
    readonly titlebar?: string;
    readonly realization?: 'card' | 'page';
    readonly pageOf?: string;
    readonly closable?: boolean;
    readonly siteNavEntry?: boolean;
    readonly fpFullPanel?: boolean;
    readonly functionPanel?: {
        id: string;
        label?: string;
        embedUrl?: string;
        route?: string;
    };
    readonly face?: {
        image: string;
    };
    readonly formFactors?: readonly string[];
}
/** Keys one v2 `contributes.messageRenderers[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_MESSAGE_RENDERER_CONTRIBUTION_KEYS: readonly ["customType", "cardId"];
/**
 * A v2 mapping from a custom-message short name to one of this app's own
 * declared cards. `customType` is the `<name>` half of the host-stamped
 * `app:<appId>/<name>` — not the prefix, and not a path with `/`. `cardId`
 * must name a `contributes.cards[]` entry that has a `route`.
 */
export interface PluginV2MessageRendererContribution {
    readonly customType: string;
    readonly cardId: string;
}
/** Keys one v2 `contributes.agentTypes[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_AGENT_TYPE_CONTRIBUTION_KEYS: readonly ["id", "title", "description", "yuan", "tools", "cards", "capabilities", "privateSession"];
/**
 * `contributes.agentTypes[].privateSession` — the private-session policy an
 * app declares for one of its own agent types. `enabled` does not by itself
 * change the created agent's visibility (it is always `plugin_private`); this
 * is stored on the created agent's `config.plugin.privateSession` as-is, for
 * a later reader to interpret.
 */
export interface PluginV2AgentTypePrivateSession {
    readonly enabled: boolean;
    readonly memory: 'plugin-private' | 'none';
}
/**
 * A v2 app's own declared private agent type — the same product concept as
 * v1's agent-type declaration (`core/plugin-manager.ts`'s
 * `normalizePluginAgentType`), carried over field for field. `yuan` omitted
 * resolves at creation time to the host default `kong`, not the general
 * `hanako` default. `tools` / `cards` / `capabilities` are declaration and
 * projection only in this version: nothing in the host validates the names
 * or enforces them as a runtime allow-list on the created agent.
 */
export interface PluginV2AgentTypeContribution {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly yuan?: string;
    readonly tools?: readonly string[];
    readonly cards?: readonly string[];
    readonly capabilities?: readonly string[];
    readonly privateSession?: PluginV2AgentTypePrivateSession;
}
/** Keys one v2 `contributes.providers[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_PROVIDER_CONTRIBUTION_KEYS: readonly ["id", "displayName", "authType", "capabilities"];
/**
 * `contributes.providers[].capabilities` — the same static shape a v1
 * provider module exports as its own `capabilities` binding
 * (`plugins/*\/providers/*.ts`). Model lists under `media` are typically
 * empty: live models are discovered at runtime through
 * `ctx.media.registerCapabilitySource`, not written into the manifest.
 */
export interface PluginV2ProviderCapabilities {
    readonly chat?: Record<string, unknown>;
    readonly media?: {
        readonly imageGeneration?: {
            readonly models: readonly unknown[];
        };
        readonly videoGeneration?: {
            readonly models: readonly unknown[];
        };
    };
}
/**
 * A v2 app's own static provider declaration — the same four fields a v1
 * provider module exports (`id`, `displayName`, `authType`, `capabilities`),
 * field for field. Pure static data: nothing here may be a function, and the
 * host refuses anything that is not plain JSON. Registered on the host's
 * provider registry once the app reaches `loaded`, and withdrawn again when
 * it disables, uninstalls, or crashes past its restart budget.
 */
export interface PluginV2ProviderContribution {
    readonly id: string;
    readonly displayName: string;
    readonly authType: 'api-key' | 'oauth' | 'none' | 'optional';
    readonly capabilities: PluginV2ProviderCapabilities;
}
/** Keys one v2 `contributes.previewers[]` entry may carry. */
export declare const PLUGIN_V2_PREVIEWER_CONTRIBUTION_KEYS: readonly ["id", "title", "selectors", "route", "mode", "icon", "formFactors"];
/** One selector is ANDed; separate selectors are ORed by the host. */
export interface PluginV2PreviewerSelector {
    readonly extensions?: readonly string[];
    readonly mimeTypes?: readonly string[];
}
/** A v2 App-owned file previewer, rendered only through its own `ui/` route. */
export interface PluginV2PreviewerContribution {
    readonly id: string;
    readonly title: string;
    readonly selectors: readonly PluginV2PreviewerSelector[];
    readonly route: string;
    readonly mode: 'read' | 'edit';
    readonly icon?: string;
    readonly formFactors?: readonly string[];
}
/** Keys a v2 `contributes.ui` block may carry. Anything else is refused. */
export declare const PLUGIN_V2_CONTRIBUTES_UI_KEYS: readonly ["messageActions", "cardChrome", "slots", "slotContributions", "contextMenus", "keybindings", "inputStatus"];
export interface PluginV2InputStatusContribution {
    readonly id: string;
    readonly title: string;
    readonly icon?: 'check' | 'pin' | 'sync';
    readonly text?: string;
    readonly tooltip?: string;
    readonly toolName?: string;
    readonly args?: Record<string, unknown>;
}
/** Keys one v2 `contributes.ui.slots[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_UI_SLOT_KEYS: readonly ["name", "title", "render"];
/** Keys one v2 `contributes.ui.slotContributions[]` entry may carry. Anything else is refused. */
export declare const PLUGIN_V2_UI_SLOT_CONTRIBUTION_KEYS: readonly ["slot", "id", "title", "icon", "toolName", "args", "route"];
/**
 * A slot this app opens on its own cards. `render: "iframe"` opts into a
 * fixed-height frame in the card shell; omitted `render` is the host-drawn
 * button (host-primitive).
 */
export interface PluginV2UiSlotDeclaration {
    readonly name: string;
    readonly title?: string;
    readonly render?: 'iframe';
}
/**
 * A fill for a named slot (`<appId>/<name>`). Host-primitive fills carry
 * `title` + `toolName`; iframe fills carry `route` and do not require
 * `toolName`. The two shapes are mutually exclusive.
 */
export interface PluginV2UiSlotContribution {
    readonly slot: string;
    readonly id: string;
    readonly title?: string;
    readonly icon?: string;
    readonly toolName?: string;
    readonly args?: Record<string, unknown>;
    readonly route?: string;
}
export declare const PLUGIN_MANIFEST_TRUST_LEVELS: readonly ["restricted", "full-access"];
/**
 * Activation events the matcher can ever satisfy. `onToolCall` and
 * `onBusRequest` also match in their `name:target` form, which is why they are
 * listed separately below.
 */
export declare const PLUGIN_MANIFEST_ACTIVATION_EVENT_NAMES: readonly ["onStartup", "onPageOpen", "onWidgetOpen", "onToolCall", "onBusRequest"];
export declare const PLUGIN_MANIFEST_ACTIVATION_EVENT_PREFIXES: readonly ["onToolCall:", "onBusRequest:"];
/**
 * Reads a plugin manifest and reports what the host will quietly ignore or
 * reinterpret. Advisory only: the result must never gate installing, loading,
 * activating, or stopping a plugin.
 *
 * A missing manifest is a supported shape, not a mistake, so it produces no
 * warnings at all.
 */
export declare function validatePluginManifest(manifest: unknown): PluginManifestWarning[];
