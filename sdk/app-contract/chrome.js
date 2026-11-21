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
import { APP_CARD_TITLE_MODES } from "./manifest.js";
import { isSurfaceActivity } from "../surface-activity.js";
/** A full replacement carries this many bytes of UTF-8 JSON at most. */
export const APP_CHROME_MAX_JSON_BYTES = 64 * 1024;
/** Title is measured in Unicode code points, not UTF-16 units. */
export const APP_CHROME_MAX_TITLE_CODE_POINTS = 256;
export const APP_CHROME_MAX_TABS = 32;
export const APP_CHROME_MAX_ACTIONS = 16;
/** Applies to action ids, tab ids and public icon ids. */
export const APP_CHROME_MAX_ID_LENGTH = 128;
export const APP_CHROME_MAX_LABEL_LENGTH = 256;
/** Same vocabulary as the manifest's `titleMode`; one source, no copy. */
export const APP_CHROME_TITLE_MODES = APP_CARD_TITLE_MODES;
const APP_CHROME_TITLE_MODE_SET = new Set(APP_CHROME_TITLE_MODES);
/**
 * The finite set of public icon ids the host renders for controlled chrome.
 * This is a subset of the official UI icon vocabulary already shipped to App
 * pages (`APP_UI_ICON_NAMES`), so the host never invents an icon system and an
 * unknown id is refused instead of silently rendering a placeholder.
 * `tests/app-chrome-contract.test.ts` pins the two lists equal.
 */
export const APP_CHROME_PUBLIC_ICONS = ["chevron", "check", "loading", "failure"];
const APP_CHROME_PUBLIC_ICON_SET = new Set(APP_CHROME_PUBLIC_ICONS);
export function isPublicChromeIcon(value) {
    return typeof value === "string" && APP_CHROME_PUBLIC_ICON_SET.has(value);
}
/**
 * Action ids the host owns. An App may not declare these: system close/detach/
 * dock/pin stay host-owned, so a description naming them is refused outright
 * rather than silently shadowed.
 */
export const APP_CHROME_RESERVED_ACTION_IDS = ["close", "detach", "dock", "pin"];
const APP_CHROME_RESERVED_ACTION_ID_SET = new Set(APP_CHROME_RESERVED_ACTION_IDS);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function codePoints(value) {
    return Array.from(value).length;
}
const CHROME_KEYS = new Set(["revision", "title", "titleMode", "tabs", "selectedTabId", "actions", "activity"]);
const TAB_KEYS = new Set(["id", "label", "icon", "closable", "disabled"]);
const ACTION_KEYS = new Set(["id", "label", "icon", "kind", "actionId"]);
function fail(code, error) {
    return { ok: false, code, error };
}
function normalizeId(field, raw) {
    void field;
    if (typeof raw !== "string" || raw === "")
        return null;
    if (codePoints(raw) > APP_CHROME_MAX_ID_LENGTH)
        return null;
    return raw;
}
function normalizeLabel(raw) {
    if (typeof raw !== "string" || raw === "")
        return null;
    if (codePoints(raw) > APP_CHROME_MAX_LABEL_LENGTH)
        return null;
    return raw;
}
/** Returns the checked icon, `undefined` when absent, or `null` when illegal. */
function normalizeIcon(raw) {
    if (raw === undefined || raw === null)
        return undefined;
    return isPublicChromeIcon(raw) ? raw : null;
}
/**
 * Validate a full Chrome replacement. Serializability and total size are
 * checked first, so a circular/oversized payload fails inside this Result
 * contract instead of throwing; structure checks follow. The host runs this at
 * the write boundary, never on a render path.
 */
export function validateAppChromeDescription(raw) {
    let serialized;
    try {
        serialized = JSON.stringify(raw);
    }
    catch {
        return fail("payload_not_serializable", "chrome description must be JSON-serializable");
    }
    if (serialized === undefined) {
        return fail("payload_not_serializable", "chrome description must be JSON-serializable");
    }
    if (new TextEncoder().encode(serialized).length > APP_CHROME_MAX_JSON_BYTES) {
        return fail("payload_too_large", `chrome description exceeds ${APP_CHROME_MAX_JSON_BYTES} bytes of UTF-8 JSON`);
    }
    if (!isRecord(raw))
        return fail("not_an_object", "chrome description must be an object");
    for (const key of Object.keys(raw)) {
        if (!CHROME_KEYS.has(key)) {
            return fail("unknown_field", `chrome description carries unknown key "${key}"; the host knows ${[...CHROME_KEYS].join(", ")}`);
        }
    }
    const revision = raw.revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision <= 0) {
        return fail("bad_revision", "chrome revision must be a positive safe integer");
    }
    let title;
    if (raw.title !== undefined && raw.title !== null) {
        if (typeof raw.title !== "string")
            return fail("bad_title", "chrome title must be a string when present");
        if (codePoints(raw.title) > APP_CHROME_MAX_TITLE_CODE_POINTS) {
            return fail("bad_title", `chrome title exceeds ${APP_CHROME_MAX_TITLE_CODE_POINTS} Unicode code points`);
        }
        title = raw.title;
    }
    let titleMode;
    if (raw.titleMode !== undefined && raw.titleMode !== null) {
        if (typeof raw.titleMode !== "string" || !APP_CHROME_TITLE_MODE_SET.has(raw.titleMode)) {
            return fail("bad_title_mode", `chrome titleMode must be one of ${APP_CHROME_TITLE_MODES.join(", ")}`);
        }
        titleMode = raw.titleMode;
    }
    let tabs;
    if (raw.tabs !== undefined) {
        if (raw.tabs === null) {
            tabs = null;
        }
        else {
            if (!Array.isArray(raw.tabs))
                return fail("bad_tab", "chrome tabs must be an array or null");
            if (raw.tabs.length > APP_CHROME_MAX_TABS) {
                return fail("too_many_tabs", `chrome tabs exceeds ${APP_CHROME_MAX_TABS} entries`);
            }
            const seen = new Set();
            const normalizedTabs = [];
            for (const [index, item] of raw.tabs.entries()) {
                if (!isRecord(item))
                    return fail("bad_tab", `chrome tabs[${index}] must be an object`);
                for (const key of Object.keys(item)) {
                    if (!TAB_KEYS.has(key))
                        return fail("unknown_field", `chrome tabs[${index}] carries unknown key "${key}"`);
                }
                const id = normalizeId("tabs[].id", item.id);
                if (!id)
                    return fail("bad_tab", `chrome tabs[${index}].id must be a non-empty string of at most ${APP_CHROME_MAX_ID_LENGTH} characters`);
                if (seen.has(id))
                    return fail("duplicate_id", `chrome tabs declares id ${JSON.stringify(id)} more than once`);
                seen.add(id);
                const label = normalizeLabel(item.label);
                if (label === null)
                    return fail("bad_label", `chrome tabs[${index}].label must be a non-empty string of at most ${APP_CHROME_MAX_LABEL_LENGTH} characters`);
                const icon = normalizeIcon(item.icon);
                if (icon === null)
                    return fail("unknown_icon", `chrome tabs[${index}].icon must be one of ${APP_CHROME_PUBLIC_ICONS.join(", ")}`);
                if (item.closable !== undefined && typeof item.closable !== "boolean") {
                    return fail("bad_tab", `chrome tabs[${index}].closable must be a boolean when present`);
                }
                if (item.disabled !== undefined && typeof item.disabled !== "boolean") {
                    return fail("bad_tab", `chrome tabs[${index}].disabled must be a boolean when present`);
                }
                normalizedTabs.push({
                    id,
                    label,
                    ...(icon === undefined ? {} : { icon }),
                    ...(item.closable === undefined ? {} : { closable: item.closable }),
                    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
                });
            }
            tabs = normalizedTabs;
        }
    }
    let selectedTabId;
    if (raw.selectedTabId !== undefined) {
        if (raw.selectedTabId === null) {
            selectedTabId = null;
        }
        else {
            const id = normalizeId("selectedTabId", raw.selectedTabId);
            if (!id)
                return fail("bad_selection", `chrome selectedTabId must be a non-empty string of at most ${APP_CHROME_MAX_ID_LENGTH} characters or null`);
            selectedTabId = id;
        }
    }
    if (tabs !== undefined && tabs !== null && tabs.length > 0) {
        const ids = new Set(tabs.map((tab) => tab.id));
        if (selectedTabId === null || selectedTabId === undefined) {
            return fail("bad_selection", "chrome selectedTabId must reference one of the declared tabs when tabs is non-empty");
        }
        if (!ids.has(selectedTabId)) {
            return fail("bad_selection", `chrome selectedTabId ${JSON.stringify(selectedTabId)} does not name a declared tab`);
        }
    }
    else if (selectedTabId !== undefined && selectedTabId !== null) {
        return fail("bad_selection", "chrome selectedTabId must be null when there are no controlled tabs");
    }
    let actions;
    if (raw.actions !== undefined && raw.actions !== null) {
        if (!Array.isArray(raw.actions))
            return fail("bad_action", "chrome actions must be an array when present");
        if (raw.actions.length > APP_CHROME_MAX_ACTIONS) {
            return fail("too_many_actions", `chrome actions exceeds ${APP_CHROME_MAX_ACTIONS} entries`);
        }
        const seen = new Set();
        const normalizedActions = [];
        for (const [index, item] of raw.actions.entries()) {
            if (!isRecord(item))
                return fail("bad_action", `chrome actions[${index}] must be an object`);
            for (const key of Object.keys(item)) {
                if (!ACTION_KEYS.has(key))
                    return fail("unknown_field", `chrome actions[${index}] carries unknown key "${key}"`);
            }
            const id = normalizeId("actions[].id", item.id);
            if (!id)
                return fail("bad_action", `chrome actions[${index}].id must be a non-empty string of at most ${APP_CHROME_MAX_ID_LENGTH} characters`);
            if (seen.has(id))
                return fail("duplicate_id", `chrome actions declares id ${JSON.stringify(id)} more than once`);
            if (APP_CHROME_RESERVED_ACTION_ID_SET.has(id) || id.startsWith("hana.")) {
                return fail("reserved_action_id", `chrome actions[${index}].id ${JSON.stringify(id)} is reserved by the host (${APP_CHROME_RESERVED_ACTION_IDS.join(", ")}, and the hana. prefix)`);
            }
            seen.add(id);
            const label = normalizeLabel(item.label);
            if (label === null)
                return fail("bad_label", `chrome actions[${index}].label must be a non-empty string of at most ${APP_CHROME_MAX_LABEL_LENGTH} characters`);
            const icon = normalizeIcon(item.icon);
            if (icon === null)
                return fail("unknown_icon", `chrome actions[${index}].icon must be one of ${APP_CHROME_PUBLIC_ICONS.join(", ")}`);
            if (item.kind === "callback") {
                if (item.actionId !== undefined)
                    return fail("bad_action", `chrome actions[${index}] is a callback and must not carry actionId`);
                normalizedActions.push({ id, label, kind: "callback", ...(icon === undefined ? {} : { icon }) });
            }
            else if (item.kind === "declared") {
                const actionId = normalizeId("actions[].actionId", item.actionId);
                if (!actionId) {
                    return fail("bad_action", `chrome actions[${index}].actionId must be a non-empty string of at most ${APP_CHROME_MAX_ID_LENGTH} characters`);
                }
                normalizedActions.push({ id, label, kind: "declared", actionId, ...(icon === undefined ? {} : { icon }) });
            }
            else {
                return fail("bad_action", `chrome actions[${index}].kind must be "callback" or "declared"`);
            }
        }
        actions = normalizedActions;
    }
    let activity;
    if (raw.activity !== undefined) {
        if (raw.activity === null) {
            activity = null;
        }
        else if (isSurfaceActivity(raw.activity)) {
            activity = raw.activity;
        }
        else {
            return fail("bad_activity", `chrome activity must be one of "running", "unread", or null`);
        }
    }
    return {
        ok: true,
        value: {
            revision,
            ...(title === undefined ? {} : { title }),
            ...(titleMode === undefined ? {} : { titleMode }),
            ...(tabs === undefined ? {} : { tabs }),
            ...(selectedTabId === undefined ? {} : { selectedTabId }),
            ...(actions === undefined ? {} : { actions }),
            ...(activity === undefined ? {} : { activity }),
        },
    };
}
//# sourceMappingURL=chrome.js.map