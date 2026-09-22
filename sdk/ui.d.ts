import { APP_CARD_CAPABILITY, APP_STORAGE_CAPABILITY, APP_SURFACE_CAPABILITY, PLUGIN_UI_CAPABILITY } from './_ui-protocol.js';
import type { HanaAppStorageScope, HanaClipboardWriteTextInput, HanaClipboardWriteTextResult, HanaDocumentContext, HanaDocumentOpenInput, HanaDocumentRequestHandler, HanaDocumentStatus, HanaDocumentViewRequestHandler, HanaEmitResult, HanaExternalOpenInput, HanaExternalOpenResult, HanaPanelIncomingEvent, HanaPanelPushProps, HanaPanelSetResult, HanaInputPanelApi, HanaPluginRequestOptions, HanaPluginSdk, HanaPluginSdkOptions, HanaPluginSize, HanaPluginThemeSnapshot, HanaResourceVersion, HanaSaveFileInput, HanaSaveFileResult, HanaSurfaceContext, HanaTrackResult, HanaPluginRuntimeSnapshot, Envelope } from './_ui-types.js';
import type { AppCardOpenResult, AppSurfaceInteractiveRegion, AppStorageDeleteResult, AppStorageGetAllResult, AppStorageGetResult, AppStorageKeysResult, AppStorageSetResult, PluginResourceOpenInput, PluginResourceOpenResult, PluginResourcePickInput, PluginResourcePickResult, PluginResourceRequestAccessInput, PluginResourceRequestAccessResult, PluginResourceSaveFileInput, PluginResourceSaveFileResult, PluginStateGetResult, PluginStateSetResult } from './_ui-protocol.js';
export type { AppSurfaceInteractiveRegion, AppCardOpenResult, AppStorageDeleteResult, AppStorageGetAllResult, AppStorageGetResult, AppStorageKeysResult, AppStorageSetResult, HanaAppStorageScope, HanaClipboardWriteTextInput, HanaClipboardWriteTextResult, HanaDocumentContext, HanaDocumentOpenInput, HanaDocumentRequestHandler, HanaDocumentStatus, HanaDocumentViewRequestHandler, HanaEmitResult, HanaExternalOpenInput, HanaExternalOpenResult, HanaPanelIncomingEvent, HanaPanelPushProps, HanaPanelSetResult, HanaInputPanelApi, HanaPluginRequestOptions, HanaPluginRuntimeSnapshot, HanaPluginSize, HanaPluginThemeSnapshot, HanaResourceVersion, HanaSaveFileInput, HanaSaveFileResult, HanaSurfaceContext, HanaTrackResult, Envelope, PluginResourceOpenInput, PluginResourceOpenResult, PluginResourcePickInput, PluginResourcePickResult, PluginResourceRequestAccessInput, PluginResourceRequestAccessResult, PluginResourceSaveFileInput, PluginResourceSaveFileResult, PluginStateGetResult, PluginStateSetResult, };
export type HanaAppUiOptions = HanaPluginSdkOptions;
export interface HanaAppSurfaceEvent {
    readonly surfaceId: string;
    readonly type: string;
    readonly payload?: unknown;
}
export interface HanaAppWindowInspection {
    readonly description?: string;
    readonly state?: Readonly<Record<string, unknown>>;
    /** Names of this App's registered tools; the host rechecks availability. */
    readonly tools?: readonly string[];
}
export interface HanaAppInspectionSurface {
    readonly surfaceId: string;
    readonly cardInstanceId?: string;
    readonly title: string;
    readonly kind: string;
}
export interface HanaAppWindowContext {
    readonly windowId: string;
    readonly appId: string;
    readonly agentId: string | null;
    readonly title: string;
    readonly platform?: string;
    readonly chrome?: 'native' | 'custom';
    readonly isFullScreen?: boolean;
    readonly bounds?: {
        readonly width: number;
        readonly height: number;
    };
    readonly parentWindowId?: string;
    readonly data?: unknown;
}
export interface HanaAppWindowUi {
    getContext(): Promise<HanaAppWindowContext>;
    /** Resolves genuine OS drop files; reading them still uses App resource authorization. */
    getDroppedResources(files: readonly File[]): Promise<readonly {
        readonly kind: 'local-file';
        readonly path: string;
    }[]>;
    request(message: unknown): Promise<unknown>;
    onRequest(handler: (message: unknown) => unknown | Promise<unknown>): () => void;
    onContextChanged(listener: (context: HanaAppWindowContext) => void): () => void;
    /** Supplies current App-owned state for the host's UI inspection tools. */
    onInspect(handler: () => HanaAppWindowInspection | Promise<HanaAppWindowInspection>): () => void;
    /** Registers an inspectable UI surface in this window; dispose on unmount. */
    registerInspectionSurface(surface: HanaAppInspectionSurface, handler: (operation: Record<string, unknown>) => unknown | Promise<unknown>): () => void;
    control(action: 'show' | 'focus' | 'minimize' | 'maximize' | 'toggle-fullscreen'): Promise<unknown>;
    close(): Promise<void>;
}
export type HanaAppUiHostRequestType = 'hana.app-surface.mount' | 'hana.app-surface.action' | 'hana.app-surface.native' | typeof APP_SURFACE_CAPABILITY.SET_INTERACTIVE_REGIONS | typeof APP_STORAGE_CAPABILITY[keyof typeof APP_STORAGE_CAPABILITY] | typeof APP_CARD_CAPABILITY[keyof typeof APP_CARD_CAPABILITY] | typeof PLUGIN_UI_CAPABILITY.TOAST_SHOW | typeof PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN | typeof PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT | typeof PLUGIN_UI_CAPABILITY.RESOURCE_OPEN | typeof PLUGIN_UI_CAPABILITY.RESOURCE_PICK | typeof PLUGIN_UI_CAPABILITY.RESOURCE_SAVE_FILE | typeof PLUGIN_UI_CAPABILITY.RESOURCE_REQUEST_ACCESS | typeof PLUGIN_UI_CAPABILITY.STATE_GET | typeof PLUGIN_UI_CAPABILITY.STATE_SET | typeof PLUGIN_UI_CAPABILITY.PANEL_SET | typeof PLUGIN_UI_CAPABILITY.EMIT | typeof PLUGIN_UI_CAPABILITY.TRACK | 'hana.document.get-context' | 'hana.document.read' | 'hana.document.report-status' | 'hana.document.open' | 'hana.document.rebind' | 'hana.document.open-drop';
export interface HanaAppUiSdk {
    /** Receives named events emitted by this App's backend through sdk.appEvents.emit. */
    readonly appEvents: {
        on(type: string, listener: (payload: Record<string, unknown>) => void): () => void;
    };
    readonly window: HanaAppWindowUi;
    readonly surfaces: {
        /** Receives host notifications for one surface owned by this native App window. */
        onEvent(surfaceId: string, listener: (event: HanaAppSurfaceEvent) => void): () => void;
    };
    readonly instances: {
        onChanged(listener: (event: {
            readonly instanceId: string;
            readonly revision: number;
            readonly state: string;
        }) => void): () => void;
    };
    readonly environments: {
        onChanged(listener: (event: {
            readonly environmentId: string;
            readonly revision: number;
            readonly state: string;
        }) => void): () => void;
    };
    ready: HanaPluginSdk['ready'];
    inputPanel: HanaPluginSdk['inputPanel'];
    assets: HanaPluginSdk['assets'];
    api: HanaPluginSdk['api'];
    ui: HanaPluginSdk['ui'];
    theme: HanaPluginSdk['theme'];
    envelope: HanaPluginSdk['envelope'];
    lifecycle: HanaPluginSdk['lifecycle'];
    cards: HanaPluginSdk['cards'];
    surface: HanaPluginSdk['surface'];
    sessions: HanaPluginSdk['sessions'];
    performance: HanaPluginSdk['performance'];
    host: {
        request<T = unknown>(type: HanaAppUiHostRequestType, payload?: unknown, options?: HanaPluginRequestOptions): Promise<T>;
    };
    toast: HanaPluginSdk['toast'];
    external: HanaPluginSdk['external'];
    clipboard: HanaPluginSdk['clipboard'];
    resources: HanaPluginSdk['resources'];
    document: HanaPluginSdk['document'];
    state: HanaPluginSdk['state'];
    storage: {
        global: HanaAppStorageScope;
        agent(agentId?: string): HanaAppStorageScope;
    };
    emit: HanaPluginSdk['emit'];
    track: HanaPluginSdk['track'];
    panel: HanaPluginSdk['panel'];
}
export declare function createHanaAppUiSdk(options?: HanaAppUiOptions): HanaAppUiSdk;
/** Ordinary iframe Apps retain the original singleton; native windows bind the same protocol to preload. */
export declare const hana: HanaAppUiSdk;
