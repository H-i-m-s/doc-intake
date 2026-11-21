/**
 * app-contract/surfaces.ts — generated from shared/app-contract/surfaces.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** A view of one declared UI contribution in an App-owned isolated instance. */
import type { AppWorkspaceCommand, AppWorkspaceConfiguration, AppWorkspaceResult } from './workspace.js';
import type { AppChromeDescriptionV2, AppChromeIconId } from './chrome.js';
export type { HanaPanelProps, HanaPanelSection } from "../plugin-panel-descriptor.js";
export type AppSurfaceSlot = "card" | "settings" | "function-panel" | "slot";
interface AppSurfaceHandleBase {
    readonly surfaceId: string;
    readonly revision: number;
    readonly windowId: string;
    readonly appId: string;
    readonly cardInstanceId: string;
    readonly definitionId: string;
    readonly slot: AppSurfaceSlot;
    readonly kind: "iframe" | "schema";
    readonly title: string;
}
export type AppSurfaceHandle = AppSurfaceHandleBase & ({
    readonly instanceId: string;
    readonly environmentId?: never;
} | {
    readonly environmentId: string;
    readonly instanceId?: never;
});
export interface AppSurfaceTarget {
    readonly callToken?: string;
    readonly surfaceId: string;
}
/** A host-rendered view of an isolated environment. No runtime credential is exposed. */
export interface AppHostSurfaceHandle {
    readonly surfaceId: string;
    readonly revision: number;
    readonly windowId: string;
    readonly environmentId: string;
    readonly kind: "host";
    readonly slot: "chat" | "preview" | "workspace";
    /** Active environment conversation; never a parent-host session or file locator. */
    readonly sessionId?: string;
    readonly agentId?: string;
    readonly title: string;
}
export type AppViewHandle = AppSurfaceHandle | AppHostSurfaceHandle;
/** One finite, App-declared action slot on the host Chat toolbar. */
export interface AppHostChatToolbarAction {
    /** Non-empty, unique within one toolbar; at most 128 characters. */
    readonly id: string;
    /** Visible label and the control's accessible name; non-empty, at most 256 characters. */
    readonly label: string;
    /** A public App icon id; an unknown id is refused rather than rendered as a placeholder. */
    readonly icon?: AppChromeIconId;
}
/**
 * The App's optional description of a host Chat surface. Every field is a
 * presentation-only hint the host validates at the open boundary; the host
 * keeps its own title and welcome defaults when a field is absent. Never a way
 * to inject transcript content, host commands or runtime credentials.
 */
export interface AppHostChatOptions {
    /** Surface/window title; the host keeps "Chat" when absent. */
    readonly title?: string;
    /** Copy for the no-session launcher; the host keeps its localized default when absent. */
    readonly welcome?: {
        readonly title?: string;
        readonly body?: string;
    };
    /** Finite action slots; the host renders no toolbar when absent. */
    readonly toolbar?: readonly AppHostChatToolbarAction[];
    /**
     * Transcript view for this one host Chat surface. `serene` folds each turn's
     * process behind a single line; `classic` keeps every step in place. Absent
     * keeps whatever view the host's own user preference already selects, which
     * is `serene` for a fresh profile. The host renders this surface with the
     * named view and never persists it, so it changes no other surface and no
     * stored preference.
     */
    readonly viewMode?: "classic" | "serene";
}
export type AppHostSurfaceOpen = {
    readonly callToken?: string;
    readonly environmentId: string;
    readonly revision: number;
    readonly windowId: string;
} & ({
    readonly slot: "chat";
    readonly sessionId?: string;
    readonly agentId?: string;
    readonly chat?: AppHostChatOptions;
} | {
    readonly slot: "preview";
    readonly filePath?: string;
    readonly source?: never;
} | {
    readonly slot: "preview";
    readonly source: {
        readonly kind: "local-file";
        readonly path: string;
    };
    readonly filePath?: never;
} | {
    readonly slot: "workspace";
    readonly configuration: AppWorkspaceConfiguration;
});
type AppSurfaceOpenBase = {
    readonly callToken?: string;
    readonly revision: number;
    readonly windowId: string;
    readonly appId?: string;
    readonly definitionId: string;
    readonly slot?: AppSurfaceSlot;
    readonly parentSurfaceId?: string;
    readonly detached?: boolean;
};
/**
 * One live card view of this App, as the App's own backend may see it. Every
 * field is derived by the host from its own persisted card binding and live
 * view record — an App never names its own card here.
 */
export interface AppCardChromeViewSummary {
    /** Opaque, host-minted handle. Never carries a connection credential or a file locator. */
    readonly viewHandle: string;
    readonly cardInstanceId: string;
    /**
     * The App's *declared* card id (its persisted binding's `cardId`), or `null`
     * when the binding has no static declaration — a pinned stream card whose
     * registry entry names no card. It is never the renderer's generic
     * definition id, which is an implementation detail (see `definitionId`).
     */
    readonly cardId: string | null;
    /** The generic renderer definition id — an implementation detail, never the App's declaration. */
    readonly definitionId: string;
    readonly appId: string;
}
/**
 * Names one live card view: the opaque handle plus the card instance it is bound
 * to. Both are required — a handle alone would let a caller skip agreeing with
 * the card it claims to act on.
 */
export interface AppCardChromeViewTarget {
    readonly viewHandle: string;
    readonly cardInstanceId: string;
}
/**
 * An explicit refusal. `code` is a stable machine word the App branches on (the
 * host bridge owns the vocabulary); `error` is for humans. `currentRevision` is
 * a diagnostic only: a refused stale write must be re-read, never retried
 * blindly.
 */
export interface AppCardChromeRefusal {
    readonly ok: false;
    readonly code: string;
    readonly error: string;
    readonly currentRevision?: number;
}
/** The result of listing this App's own live card views. */
export type AppCardChromeViewListResult = {
    readonly ok: true;
    readonly views: readonly AppCardChromeViewSummary[];
} | AppCardChromeRefusal;
/** An answered read: the current description (null = never set) and its revision (0 when null). */
export type AppCardChromeSnapshotResult = {
    readonly ok: true;
    readonly revision: number;
    readonly description: AppChromeDescriptionV2 | null;
} | AppCardChromeRefusal;
/** An accepted write: the revision the renderer actually applied. */
export type AppCardChromeSetResult = {
    readonly ok: true;
    readonly revision: number;
} | AppCardChromeRefusal;
export interface AppSurfaces {
    open(input: (AppSurfaceOpenBase & {
        readonly instanceId: string;
        readonly environmentId?: never;
    }) | (AppSurfaceOpenBase & {
        readonly environmentId: string;
        readonly appId: string;
        readonly instanceId?: never;
    })): Promise<AppSurfaceHandle>;
    openHost(input: AppHostSurfaceOpen): Promise<AppHostSurfaceHandle>;
    get(input: AppSurfaceTarget): Promise<AppViewHandle>;
    move(input: AppSurfaceTarget & {
        readonly windowId: string;
        readonly detached?: boolean;
    }): Promise<AppViewHandle>;
    close(input: AppSurfaceTarget): Promise<{
        readonly closed: true;
    }>;
    workspace(input: AppSurfaceTarget & {
        readonly command: AppWorkspaceCommand;
    }): Promise<AppWorkspaceResult>;
    /**
     * List this App's own currently-live card views (each carrying its declared
     * `cardId`). Never lists another App's views, and never requires window or
     * instance management authority.
     */
    listCardChromeViews(): Promise<AppCardChromeViewListResult>;
    /**
     * Read the *current* Chrome of one of this App's live views, exactly as the
     * renderer holds it now — never a cached registration summary.
     */
    getCardChromeView(input: AppCardChromeViewTarget): Promise<AppCardChromeSnapshotResult>;
    /**
     * Submit a full Chrome replacement. A stale revision is refused with a stable
     * code and the current revision (a diagnostic); the caller re-reads rather
     * than retrying blindly.
     */
    setCardChrome(input: AppCardChromeViewTarget & {
        readonly description: AppChromeDescriptionV2;
    }): Promise<AppCardChromeSetResult>;
}
/**
 * The surface methods the managed AppPlatform's own in-process service
 * implements. The card-chrome methods above are not part of it: they are
 * supplied by the host-only backend facade, so the managed platform never
 * reflects onto a method it does not have.
 */
export declare const APP_MANAGED_SURFACE_METHODS: readonly ["open", "openHost", "get", "move", "close", "workspace"];
/** Every method the App host surface domain exposes: the managed six plus the backend card-chrome three. */
export declare const APP_SURFACE_METHODS: readonly ["open", "openHost", "get", "move", "close", "workspace", "listCardChromeViews", "getCardChromeView", "setCardChrome"];
/** The managed platform's slice of `AppSurfaces`; the chrome methods arrive from the host-only facade. */
export type AppManagedSurfaces = Pick<AppSurfaces, typeof APP_MANAGED_SURFACE_METHODS[number]>;
//# sourceMappingURL=surfaces.d.ts.map