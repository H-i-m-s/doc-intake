/**
 * app-contract/windows.ts — generated from shared/app-contract/windows.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** App-owned native window capability.  The host owns window identity and lifecycle. */
export declare const APP_WINDOWS_MANAGE_CAPABILITY: "app/windows.manage";
export type AppWindowState = "opening" | "ready" | "closing" | "closed";
export type AppWindowControlAction = "show" | "focus" | "minimize" | "maximize" | "toggle-fullscreen";
export interface AppWindowBounds {
    readonly width: number;
    readonly height: number;
}
export interface AppWindowContext {
    readonly windowId: string;
    readonly appId: string;
    readonly agentId: string | null;
    readonly title: string;
    readonly parentWindowId?: string;
    /** Native controls by default; custom lets an App render its own shared Chrome. */
    readonly chrome?: "native" | "custom";
    readonly data: unknown;
}
export interface AppWindowSnapshot extends AppWindowContext {
    readonly state: AppWindowState;
    readonly bounds: AppWindowBounds;
}
export interface AppWindowCallbackContext {
    readonly callToken: string;
    readonly windowId: string;
    readonly agentId: string | null;
}
export interface AppWindowCall {
    readonly callToken?: string;
}
export interface AppWindowTarget extends AppWindowCall {
    readonly windowId: string;
}
export type AppWindowEvent = {
    readonly type: "bounds-changed";
    readonly windowId: string;
    readonly bounds: AppWindowBounds;
} | {
    readonly type: "closed";
    readonly windowId: string;
    readonly bounds: AppWindowBounds;
};
export interface AppWindows {
    create(input: AppWindowCall & {
        readonly entry: string;
        readonly title: string;
        readonly bounds?: Partial<AppWindowBounds>;
        readonly parentWindowId?: string;
        readonly chrome?: "native" | "custom";
        readonly data?: unknown;
    }): Promise<AppWindowSnapshot>;
    list(input?: AppWindowCall): Promise<readonly AppWindowSnapshot[]>;
    get(input: AppWindowTarget): Promise<AppWindowSnapshot>;
    close(input: AppWindowTarget): Promise<AppWindowSnapshot>;
    control(input: AppWindowTarget & {
        readonly action: AppWindowControlAction;
    }): Promise<AppWindowSnapshot>;
    /** Sends an opaque JSON request to this window's UI and waits for its opaque JSON response. */
    request(input: AppWindowTarget & {
        readonly message: unknown;
    }): Promise<unknown>;
    /** Handles opaque requests that the window UI sends to its owning App backend. */
    handleMessages(input: AppWindowTarget, handler: (input: {
        readonly message: unknown;
        readonly context: AppWindowCallbackContext;
    }) => unknown | Promise<unknown>): {
        dispose(): void;
    };
    onEvent(input: AppWindowTarget, listener: (event: AppWindowEvent, context: AppWindowCallbackContext) => void | Promise<void>): {
        dispose(): void;
    };
}
//# sourceMappingURL=windows.d.ts.map