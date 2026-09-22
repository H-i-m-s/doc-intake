import { type AppCardOpenResult, type AppActiveSession, type AppActiveSessionChanged, type AppStorageDeleteResult, type AppStorageGetAllResult, type AppStorageGetResult, type AppStorageKeysResult, type AppStorageSetResult, type AppSurfaceInteractiveRegion, type PluginStateGetResult, type PluginStateSetResult, type PluginStorageDeleteResult, type PluginStorageGetAllResult, type PluginStorageGetResult, type PluginStorageSetResult, type PluginSurfaceRuntimeBudget, type PluginSurfaceContext, type PluginResourceOpenInput, type PluginResourceOpenResult, type PluginResourcePickInput, type PluginResourcePickResult, type PluginResourceSaveFileInput, type PluginResourceSaveFileResult, type PluginResourceRequestAccessInput, type PluginResourceRequestAccessResult, type PluginUiError, type PluginUiMessage } from './_ui-protocol.js';
import { type HanaInputPanelApi } from './_ui-input-panel.js';
export type { HanaInputPanelApi, HanaInputPanelSubmitHandler, HanaInputPanelPresentationPatch } from './_ui-input-panel.js';
export type { AppInputPanelContext } from './_ui-protocol.js';
export type { AppActiveSession, AppActiveSessionChanged, AppSurfaceInteractiveRegion, } from './_ui-protocol.js';
export interface HanaPluginSize {
    width?: number;
    height?: number;
}
export interface HanaPluginThemeSnapshot {
    /** 用户当前选中的主题 id，例如注册表里的那些。 */
    theme?: string;
    /** 该主题的样式表地址。开着主题跟随时 SDK 会自己取用，插件不必管。 */
    cssUrl?: string;
    /** Declared appearance of the currently active host theme. */
    appearance?: 'light' | 'dark';
    /** Host-authorized CSS for both light and dark appearances, when provided. */
    palettes?: {
        light: {
            theme: string;
            cssUrl: string;
        };
        dark: {
            theme: string;
            cssUrl: string;
        };
    };
}
export type EnvelopeAxisMode = 'fixed' | 'flexible' | 'unbounded';
export interface EnvelopeAxis {
    mode: EnvelopeAxisMode;
    value?: number;
    max?: number;
}
export interface Envelope {
    width: EnvelopeAxis;
    height: EnvelopeAxis;
}
export type HanaPluginRuntimeSnapshot = PluginSurfaceRuntimeBudget;
export type HanaSurfaceContext = PluginSurfaceContext;
export interface HanaPluginRequestOptions {
    timeoutMs?: number;
}
/** Public document metadata; only available in a host-bound Preview surface. */
export interface HanaDocumentContext {
    documentId: string;
    viewId: string;
    providerId: string;
    appId: string;
    capabilities: Array<'read' | 'write'>;
    resource: unknown;
    version: unknown;
    generation: number;
}
export interface HanaDocumentStatus {
    revision: number;
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    recoveryKey?: string | null;
    error?: {
        code: string;
        message: string;
    } | null;
}
export interface HanaDocumentOpenInput {
    providerId: string;
    resource: Record<string, unknown>;
}
export type HanaResourceVersion = {
    mtimeMs?: number;
    size?: number | null;
    sha256?: string;
    etag?: string;
    sequence?: number;
};
export type HanaSaveFileInput = PluginResourceSaveFileInput;
export type HanaSaveFileResult = PluginResourceSaveFileResult;
export type HanaDocumentOpenDropInput = {
    dragId: string;
} | {
    file: File;
};
export type HanaDocumentRequest = {
    requestId: string;
    kind: 'save' | 'prepareClose' | 'revert' | 'undo' | 'redo';
    revision: number;
};
export type HanaDocumentRequestHandler = (request: HanaDocumentRequest) => unknown | Promise<unknown>;
export type HanaDocumentViewRequest = {
    requestId: string;
    documentId: string;
    viewId: string;
    revision: number;
    method: string;
    payload?: unknown;
};
export type HanaDocumentViewResult = {
    revision: number;
    data?: unknown;
    images?: Array<{
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
        data: string;
    }>;
};
export type HanaDocumentViewRequestHandler = (request: HanaDocumentViewRequest) => HanaDocumentViewResult | Promise<HanaDocumentViewResult>;
export type HanaToastType = 'success' | 'error' | 'info' | 'warning';
export interface HanaToastShowInput {
    message: string;
    type?: HanaToastType;
    duration?: number;
}
export interface HanaToastShowResult {
    shown: boolean;
}
export type HanaExternalOpenInput = string | {
    url: string;
};
export interface HanaExternalOpenResult {
    opened: boolean;
}
export type HanaClipboardWriteTextInput = string | {
    text: string;
};
export interface HanaClipboardWriteTextResult {
    written: boolean;
}
export interface HanaPluginMessageTransport {
    postMessage(message: PluginUiMessage): void | Promise<void>;
    onMessage(listener: (message: unknown) => void): () => void;
}
export interface HanaPluginSdkOptions {
    /** An App native-window bridge; ordinary iframes keep their parent/source checks. */
    messageTransport?: HanaPluginMessageTransport;
    parentWindow?: Window;
    targetWindow?: Window;
    targetOrigin?: string;
    requestTimeoutMs?: number;
    idFactory?: () => string;
    /**
     * 是否跟随宿主主题，默认跟随。
     *
     * 插件的主题本来就该由用户在设置里选的那个主题决定，所以这是默认行为而不是
     * 需要主动打开的功能：用户换了主题，插件界面跟着换，不需要插件写任何代码。
     *
     * 只有确实要固定成一套自己的配色、不随宿主变的插件才关掉它。关掉之后 SDK 不
     * 再碰插件文档里的样式，主题变化仍然会通知到 `hana.theme.subscribe`。
     */
    followHostTheme?: boolean;
    /**
     * 主题跟随过程中出错时的回调（例如样式表取不下来）。
     *
     * 不提供时错误会打到控制台。无论哪种方式，SDK 都不会拿一份猜出来的样式顶上：
     * 取不到就保持当前这套，并把失败说出来。
     */
    onThemeError?: (error: unknown) => void;
}
/**
 * 一个 v2 App 应用态作用域（`hana.storage.global` 或 `hana.storage.agent(id)`
 * 的返回值）。六个方法逐一映射 `APP_STORAGE_*` 宿主能力，与 host 侧
 * `AppStorageScope`（server/composition/plugin-context-v2.ts 的 ctx.storage）
 * 同构——无每键上限，只有整作用域配额；`onChanged` 见 `agent()` 自身的文档。
 */
export interface HanaAppStorageScope {
    get(key: string, options?: HanaPluginRequestOptions): Promise<AppStorageGetResult>;
    getAll(options?: HanaPluginRequestOptions): Promise<AppStorageGetAllResult>;
    set(key: string, value: unknown, options?: HanaPluginRequestOptions): Promise<AppStorageSetResult>;
    delete(key: string, options?: HanaPluginRequestOptions): Promise<AppStorageDeleteResult>;
    keys(options?: HanaPluginRequestOptions): Promise<AppStorageKeysResult>;
    onChanged(callback: (keys: string[]) => void): () => void;
}
export interface HanaPluginSdk {
    ready(payload?: unknown): void;
    /** Context and answer collection for a host-mounted App input panel. */
    inputPanel: HanaInputPanelApi;
    assets: {
        /**
         * Resolves `path` against the host-issued asset base (the `hana-asset-base`
         * iframe query parameter), so the returned URL carries whatever surface
         * session the host attached to it. Only works inside a host-opened app
         * surface — throws otherwise. Because the URL carries a credential, do not
         * persist it or write it to logs; treat it as a value to use immediately.
         */
        url(path: string): string;
    };
    api: {
        /** Managed-service paths carry a surface credential for relative assets and WebSockets. Do not log or persist the returned URL. */
        url(path: string): string;
        fetch(path: string, init?: RequestInit): Promise<Response>;
    };
    ui: {
        resize(size: HanaPluginSize): void;
    };
    theme: {
        getSnapshot(): HanaPluginThemeSnapshot;
        subscribe(callback: (theme: HanaPluginThemeSnapshot) => void): () => void;
    };
    envelope: {
        getSnapshot(): Envelope | null;
        subscribe(callback: (envelope: Envelope | null) => void): () => void;
    };
    lifecycle: {
        getSnapshot(): HanaPluginRuntimeSnapshot;
        subscribe(callback: (snapshot: HanaPluginRuntimeSnapshot) => void): () => void;
    };
    cards: {
        open(cardId: string): Promise<AppCardOpenResult>;
    };
    surface: {
        getContext(): HanaSurfaceContext | null;
        onContextChanged(callback: (context: HanaSurfaceContext | null) => void): () => void;
        setInteractiveRegions(regions: AppSurfaceInteractiveRegion[], options?: HanaPluginRequestOptions): Promise<{
            applied: true;
        }>;
    };
    sessions: {
        getActive(options?: HanaPluginRequestOptions): Promise<AppActiveSession | null>;
        focus(input: {
            sessionId: string;
        }, options?: HanaPluginRequestOptions): Promise<AppActiveSession>;
        onActiveChanged(callback: (change: AppActiveSessionChanged) => void, onError?: (error: HanaPluginError) => void): () => void;
    };
    performance: {
        requestAnimationFrame(callback: FrameRequestCallback): number;
        cancelAnimationFrame(handle: number): void;
    };
    host: {
        request<T = unknown>(type: string, payload?: unknown, options?: HanaPluginRequestOptions): Promise<T>;
    };
    toast: {
        show(input: HanaToastShowInput, options?: HanaPluginRequestOptions): Promise<HanaToastShowResult>;
    };
    external: {
        open(input: HanaExternalOpenInput, options?: HanaPluginRequestOptions): Promise<HanaExternalOpenResult>;
    };
    clipboard: {
        writeText(input: HanaClipboardWriteTextInput, options?: HanaPluginRequestOptions): Promise<HanaClipboardWriteTextResult>;
    };
    resources: {
        open(input: PluginResourceOpenInput, options?: HanaPluginRequestOptions): Promise<PluginResourceOpenResult>;
        pick(input?: PluginResourcePickInput, options?: HanaPluginRequestOptions): Promise<PluginResourcePickResult>;
        saveFile(input: HanaSaveFileInput, options?: HanaPluginRequestOptions): Promise<HanaSaveFileResult>;
        requestAccess(input: PluginResourceRequestAccessInput, options?: HanaPluginRequestOptions): Promise<PluginResourceRequestAccessResult>;
    };
    /**
     * The document surface is deliberately separate from `resources`: it can
     * only read the resource the host bound to this iframe, and has no API for
     * substituting a path or ref.
     */
    document: {
        getContext(options?: HanaPluginRequestOptions): Promise<HanaDocumentContext | null>;
        read(options?: HanaPluginRequestOptions): Promise<unknown>;
        reportStatus(status: HanaDocumentStatus, options?: HanaPluginRequestOptions): Promise<void>;
        open(input: HanaDocumentOpenInput, options?: HanaPluginRequestOptions): Promise<{
            opened: true;
        }>;
        rebind(input: {
            saveReceipt: string;
            expectedRevision: number;
        }, options?: HanaPluginRequestOptions): Promise<{
            rebound: true;
            context: HanaDocumentContext;
            status: HanaDocumentStatus;
        }>;
        openDrop(event: DragEvent, options?: HanaPluginRequestOptions): Promise<{
            opened: true;
        } | null>;
        /** Handles a host command. No handler means the host receives an explicit refusal. */
        onRequest(handler: HanaDocumentRequestHandler): () => void;
        /** Handles App-defined view requests independently from document lifecycle requests. */
        onViewRequest(handler: HanaDocumentViewRequestHandler): () => void;
    };
    /**
     * 实例态：卡实例私有的草稿纸。只在 WebView 卡（card slot）里可用，随 Client Layout
     * Profile 持久化（应用重启活、跨端不共享），卡实例销毁即亡（除非进档案）。64KB 上限。
     */
    state: {
        get(key?: string, options?: HanaPluginRequestOptions): Promise<PluginStateGetResult>;
        set(keyOrState: string | Record<string, unknown>, value?: unknown, options?: HanaPluginRequestOptions): Promise<PluginStateSetResult>;
    };
    /**
     * 应用态：插件级 KV（pluginId 命名空间）。同插件所有表面形式共享同一份，跨端一致；
     * 约 1MB/插件、256KB/键，超额显式报错（PLUGIN_STORAGE_QUOTA_EXCEEDED / VALUE_TOO_LARGE）。
     * onChanged 订阅其它卡/端写入引发的变更（只带 keys，自行重拉）。
     *
     * v1 插件专属的冻结兼容层能力：已安装的 v1 插件永远能读写它。v2 App 的应用态
     * 由 `global`/`agent(id)` 两个作用域提供（同一个 `storage` 对象上并存，
     * 互不影响），不走这五个扁平方法。
     */
    storage: {
        get(key: string, options?: HanaPluginRequestOptions): Promise<PluginStorageGetResult>;
        getAll(options?: HanaPluginRequestOptions): Promise<PluginStorageGetAllResult>;
        set(key: string, value: unknown, options?: HanaPluginRequestOptions): Promise<PluginStorageSetResult>;
        delete(key: string, options?: HanaPluginRequestOptions): Promise<PluginStorageDeleteResult>;
        onChanged(callback: (keys: string[]) => void): () => void;
        /**
         * v2 App 应用态，全局作用域（对标 VS Code 的 globalState）：跨这个 App
         * 的所有 agent 共享。无每键上限，只在整作用域序列化超过 512KB 时宿主记
         * 警告，超过 16MB 硬上限显式抛 `APP_STORAGE_QUOTA_EXCEEDED`。
         */
        global: HanaAppStorageScope;
        /**
         * v2 App 应用态，agent 作用域（对标 VS Code 的 workspaceState）：私有于
         * 一个 agent。省略 agentId 时，`get`/`getAll`/`set`/`delete`/`keys` 由宿主
         * 按这张卡自己归属的 agent 解析；`onChanged` 在省略 agentId 时没有一个
         * 稳定的作用域可订阅（订阅比任何一次请求活得都久），因此显式抛错——
         * 需要长期订阅时传入明确的 agentId。
         */
        agent(agentId?: string): HanaAppStorageScope;
    };
    /**
     * 回传：把一次用户操作送进会话并唤醒 agent。形态对齐 card.emit。
     * userGesture 由 SDK 注入层采集，作者不可自报。
     * 只有用户明确要求发到别处时才传 to。
     * 成功回执为 { delivered: true, to? }，调用带了 to 时回显。
     */
    emit(name: string, payload?: unknown, to?: string, options?: HanaPluginRequestOptions): Promise<HanaEmitResult>;
    /**
     * 安静日志：写入独立活动仓，不唤醒 agent。形态对齐 card.track。
     */
    track(name: string, payload?: unknown, options?: HanaPluginRequestOptions): Promise<HanaTrackResult>;
    /**
     * 功能面板：把要显示的内容推给宿主，宿主用内置原语画。面板跟着这张卡走，
     * 只在卡片表面可用。
     */
    panel: {
        /** 推一次面板内容。返回宿主收下的段数，以及被丢弃的段落及其原因。 */
        set(props: HanaPanelPushProps, options?: HanaPluginRequestOptions): Promise<HanaPanelSetResult>;
        /** 用户在面板里点了什么 */
        onEvent(callback: (event: HanaPanelIncomingEvent) => void): () => void;
        /** 到了声明的刷新节奏，宿主催你重推一次（面板不可见时不会来） */
        onRefresh(callback: () => void): () => void;
    };
}
/** 面板内容。段落词汇表见 shared/plugin-panel-descriptor 的声明式契约。 */
export interface HanaPanelPushProps {
    sections: unknown[];
    refresh?: {
        intervalMs: number;
        pauseWhenHidden?: boolean;
    } | null;
}
export interface HanaPanelSetResult {
    accepted: number;
    dropped: string[];
}
export interface HanaEmitResult {
    delivered: boolean;
    to?: string;
}
export interface HanaTrackResult {
    accepted: boolean;
}
export interface HanaPanelIncomingEvent {
    sectionId: string;
    itemId?: string;
    kind: 'select' | 'action' | 'toggle';
    checked?: boolean;
}
export declare class HanaPluginError extends Error {
    name: string;
    readonly code: string;
    readonly details?: unknown;
    constructor(error: PluginUiError);
}
export declare function createHanaPluginSdk(options?: HanaPluginSdkOptions): HanaPluginSdk;
export declare const hana: HanaPluginSdk;
