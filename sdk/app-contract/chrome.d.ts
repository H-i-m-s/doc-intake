/**
 * app-contract/chrome.ts — generated from shared/app-contract/chrome.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-contract/chrome.ts — the v2 App **current-view Chrome** contract:
 * a pure-data description an App submits for its own card's title bar (dynamic
 * title, controlled tabs, controlled actions) and the validator the host runs
 * at the write boundary.
 *
 * Pure data only: no DOM nodes, functions, class instances or opaque handles
 * ever cross this boundary. Everything here is JSON-serializable and is
 * validated once, at the write boundary, before it reaches any renderer.
 *
 * Identity is not part of this payload. The host owns pluginId / slot / card
 * instance / surface readiness from the iframe handshake, and it mints the
 * per-view scope; an App cannot self-report any of them.
 */
import { type AppCardTitleModeV2 } from "./manifest.js";
import { type SurfaceActivity } from "../surface-activity.js";
/** A full replacement carries this many bytes of UTF-8 JSON at most. */
export declare const APP_CHROME_MAX_JSON_BYTES: number;
/** Title is measured in Unicode code points, not UTF-16 units. */
export declare const APP_CHROME_MAX_TITLE_CODE_POINTS = 256;
export declare const APP_CHROME_MAX_TABS = 32;
export declare const APP_CHROME_MAX_ACTIONS = 16;
/** Applies to action ids, tab ids and public icon ids. */
export declare const APP_CHROME_MAX_ID_LENGTH = 128;
export declare const APP_CHROME_MAX_LABEL_LENGTH = 256;
/** Same vocabulary as the manifest's `titleMode`; one source, no copy. */
export declare const APP_CHROME_TITLE_MODES: readonly ["auto", "show", "hide"];
export type AppChromeTitleMode = AppCardTitleModeV2;
/**
 * The finite set of public icon ids the host renders for controlled chrome.
 * This is a subset of the official UI icon vocabulary already shipped to App
 * pages (`APP_UI_ICON_NAMES`), so the host never invents an icon system and an
 * unknown id is refused instead of silently rendering a placeholder.
 * `tests/app-chrome-contract.test.ts` pins the two lists equal.
 */
export declare const APP_CHROME_PUBLIC_ICONS: readonly ["chevron", "check", "loading", "failure"];
export type AppChromeIconId = typeof APP_CHROME_PUBLIC_ICONS[number];
export declare function isPublicChromeIcon(value: unknown): value is AppChromeIconId;
/**
 * Action ids the host owns. An App may not declare these: system close/detach/
 * dock/pin stay host-owned, so a description naming them is refused outright
 * rather than silently shadowed.
 */
export declare const APP_CHROME_RESERVED_ACTION_IDS: readonly ["close", "detach", "dock", "pin"];
/**
 * Stable error codes. Callers branch on the code; the message is for humans.
 */
export type AppChromeErrorCode = "payload_not_serializable" | "payload_too_large" | "not_an_object" | "unknown_field" | "bad_revision" | "bad_title" | "bad_title_mode" | "too_many_tabs" | "bad_tab" | "unknown_icon" | "duplicate_id" | "bad_label" | "bad_selection" | "too_many_actions" | "bad_action" | "reserved_action_id" | "bad_activity";
export interface AppChromeTabV2 {
    readonly id: string;
    readonly label: string;
    readonly icon?: AppChromeIconId;
    readonly closable?: boolean;
    readonly disabled?: boolean;
}
/**
 * A controlled action is a discriminated union:
 *   · `callback` — the host routes the request back to the owning page; the
 *     App answers through `hana.chrome.onAction`'s receipt.
 *   · `declared` — references an action id the App already registered as a
 *     card-chrome contribution; the host runs it through the existing
 *     authorized contribution route. It never carries an arbitrary tool name
 *     or arguments, and it is not a way to execute tools.
 */
export type AppChromeActionV2 = {
    readonly id: string;
    readonly label: string;
    readonly icon?: AppChromeIconId;
    readonly kind: "callback";
} | {
    readonly id: string;
    readonly label: string;
    readonly icon?: AppChromeIconId;
    readonly kind: "declared";
    /** An already-registered card-chrome contribution action id. */
    readonly actionId: string;
};
/**
 * The status dot this App's card asks the host to show on its page button:
 * `"running"` while work is in flight, `"unread"` when there is output the user
 * has not looked at. Absent or `null` means no dot. It is the same vocabulary
 * as the host's own session status, so the App cannot invent a new one.
 */
export type AppChromeActivityV2 = SurfaceActivity;
export interface AppChromeDescriptionV2 {
    /** Positive safe integer. Strictly increasing within one view scope. */
    readonly revision: number;
    readonly title?: string;
    readonly titleMode?: AppChromeTitleMode;
    /** `null` clears controlled tabs back to the manifest default. */
    readonly tabs?: readonly AppChromeTabV2[] | null;
    readonly selectedTabId?: string | null;
    readonly actions?: readonly AppChromeActionV2[];
    /**
     * Page-level status dot for this card. Like every other field it describes
     * the App's full current state: a description without `activity` (or with
     * `null`) clears the dot on the next accepted revision.
     */
    readonly activity?: AppChromeActivityV2 | null;
}
export type AppChromeValidationResult = {
    readonly ok: true;
    readonly value: AppChromeDescriptionV2;
} | {
    readonly ok: false;
    readonly code: AppChromeErrorCode;
    readonly error: string;
};
/**
 * Validate a full Chrome replacement. Serializability and total size are
 * checked first, so a circular/oversized payload fails inside this Result
 * contract instead of throwing; structure checks follow. The host runs this at
 * the write boundary, never on a render path.
 */
export declare function validateAppChromeDescription(raw: unknown): AppChromeValidationResult;
//# sourceMappingURL=chrome.d.ts.map