/**
 * app-custom-themes.ts — generated from shared/app-custom-themes.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-custom-themes.ts — the user-custom-theme vocabulary: types, the
 * variable schema, whole-definition validation, and the CSS compiler.
 *
 * This is the single source for what a custom theme *is*, shared by the host
 * (`core/custom-theme-store.ts` / `core/custom-theme-service.ts`, the HTTP
 * routes, the CSS endpoint) and by app authors through `@hana/app-sdk`. It is
 * pure: no Node built-ins, no DOM, no clock, no I/O. Every host layer may
 * import it; it may not import any host layer.
 *
 * Boundary (deliberate): a custom theme is a *closed vocabulary* of known CSS
 * variables with typed values. No arbitrary CSS string, no `var()` / `url()` /
 * `calc()` input, no script. The compiler emits only declared variables plus a
 * fixed derivation set (rgb triples, `--select-arrow`). A theme that wanted to
 * style something outside the schema is out of scope by design.
 *
 * The built-in registry (`desktop/src/shared/theme-registry-data.json`,
 * `desktop/src/themes/*.css`, `shared/card-theme-palettes.generated.ts`) is a
 * completely separate authority and is never written to from here. A user
 * theme carries a `custom:` prefixed id and is resolved through its own branch;
 * it is never inserted into the built-in `THEMES` table.
 */
export const CUSTOM_THEME_FORMAT_VERSION = 1;
/** User theme ids are `custom:<uuid>`. The suffix is a host-minted random UUID. */
export const CUSTOM_THEME_ID_PREFIX = "custom:";
/**
 * An ephemeral preview is addressed by `custom-preview:<uuid>`. This id is a
 * handle for the running CSS endpoint, never a value the user may save into
 * `preferences.appearance.theme`.
 */
export const CUSTOM_THEME_PREVIEW_ID_PREFIX = "custom-preview:";
export const CUSTOM_THEME_NAME_MIN_LENGTH = 1;
export const CUSTOM_THEME_NAME_MAX_LENGTH = 80;
export const CUSTOM_THEME_RADIUS_MIN = 0;
export const CUSTOM_THEME_RADIUS_MAX = 32;
export const CUSTOM_THEME_FONT_MIN_ITEMS = 1;
export const CUSTOM_THEME_FONT_MAX_ITEMS = 8;
export const CUSTOM_THEME_FONT_ITEM_MIN_LENGTH = 1;
export const CUSTOM_THEME_FONT_ITEM_MAX_LENGTH = 80;
/** Error codes surfaced to the App through `HanaPluginError.code`. */
export const CUSTOM_THEME_ERROR_CODE = {
    INVALID_ID: "CUSTOM_THEME_INVALID_ID",
    NOT_FOUND: "CUSTOM_THEME_NOT_FOUND",
    CONFLICT: "CUSTOM_THEME_CONFLICT",
    INVALID: "CUSTOM_THEME_INVALID",
    IN_USE: "CUSTOM_THEME_IN_USE",
    PREVIEW_BUSY: "CUSTOM_THEME_PREVIEW_BUSY",
    PREVIEW_UNAVAILABLE: "CUSTOM_THEME_PREVIEW_UNAVAILABLE",
    STORAGE_ERROR: "CUSTOM_THEME_STORAGE_ERROR",
};
/** One colour variable, optionally requiring opaque 6-digit hex. */
function color(name, group, label, opaque = false) {
    return { name, type: "color", group, label, required: true, ...(opaque ? { opaque: true } : {}) };
}
/** One radius/size variable in CSS pixels. */
function length(name, group, label) {
    return {
        name,
        type: "length",
        group,
        label,
        required: true,
        min: CUSTOM_THEME_RADIUS_MIN,
        max: CUSTOM_THEME_RADIUS_MAX,
    };
}
/** One font-family stack variable. */
function fontFamily(name, group, label) {
    return {
        name,
        type: "font-family",
        group,
        label,
        required: true,
        minItems: CUSTOM_THEME_FONT_MIN_ITEMS,
        maxItems: CUSTOM_THEME_FONT_MAX_ITEMS,
        itemMaxLength: CUSTOM_THEME_FONT_ITEM_MAX_LENGTH,
    };
}
const ANSI_COLOURS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const VARIABLE_SPECS = Object.freeze([
    // Background
    color("--bg", "background", "Background", true),
    color("--bg-card", "background", "Card background", true),
    color("--bg-glass", "background", "Glass background"),
    color("--sidebar-bg", "background", "Sidebar background"),
    // Accent / link
    color("--accent", "accent", "Accent", true),
    color("--accent-hover", "accent", "Accent hover"),
    color("--accent-light", "accent", "Accent tint"),
    color("--link", "accent", "Link", true),
    color("--link-hover", "accent", "Link hover"),
    // Text
    color("--text", "text", "Text"),
    color("--text-light", "text", "Secondary text"),
    color("--text-muted", "text", "Muted text"),
    color("--hana-text", "text", "Chat text"),
    // Structural colours
    color("--border", "structural", "Border"),
    color("--shadow", "structural", "Shadow"),
    color("--green", "structural", "Success", true),
    color("--coral", "structural", "Coral", true),
    color("--danger", "structural", "Danger", true),
    // Note pad
    color("--jian-note-bg", "note", "Note background"),
    color("--jian-note-border", "note", "Note border"),
    // Chat surfaces
    color("--mood-bg", "chat", "Mood background"),
    color("--mood-text", "chat", "Mood text"),
    color("--mood-border", "chat", "Mood border"),
    color("--tool-bg", "chat", "Tool background"),
    color("--tool-text", "chat", "Tool text"),
    color("--user-bg", "chat", "User bubble background"),
    color("--drop-overlay-bg", "chat", "Drop overlay background"),
    color("--attach-bg", "chat", "Attachment background"),
    // Overlay / scrim scale + tab slider
    color("--overlay-subtle", "overlay", "Overlay subtle"),
    color("--overlay-light", "overlay", "Overlay light"),
    color("--overlay-medium", "overlay", "Overlay medium"),
    color("--overlay-strong", "overlay", "Overlay strong"),
    color("--tab-slider-bg", "overlay", "Tab slider background"),
    // Terminal base
    color("--term-bg", "terminal", "Terminal background"),
    color("--term-fg", "terminal", "Terminal foreground"),
    color("--term-cursor", "terminal", "Terminal cursor"),
    color("--term-cursor-accent", "terminal", "Terminal cursor accent"),
    color("--term-selection-bg", "terminal", "Terminal selection"),
    ...ANSI_COLOURS.map((c) => color(`--term-ansi-${c}`, "terminal", `Terminal ANSI ${c}`)),
    ...ANSI_COLOURS.map((c) => color(`--term-ansi-bright-${c}`, "terminal", `Terminal ANSI bright ${c}`)),
    // Shape
    length("--radius-input", "shape", "Input radius"),
    length("--radius-card", "shape", "Card radius"),
    length("--radius-chat-card", "shape", "Chat card radius"),
    length("--radius-chat-surface", "shape", "Chat surface radius"),
    // Typography
    fontFamily("--font-ui", "typography", "UI font stack"),
    fontFamily("--font-serif", "typography", "Serif font stack"),
    fontFamily("--font-mono", "typography", "Monospace font stack"),
]);
export const CUSTOM_THEME_VARIABLE_SPECS = VARIABLE_SPECS;
export const CUSTOM_THEME_VARIABLE_NAMES = Object.freeze(VARIABLE_SPECS.map((spec) => spec.name));
const SPEC_BY_NAME = new Map(VARIABLE_SPECS.map((spec) => [spec.name, spec]));
/** Names that must be exactly 6 hex digits (no alpha). */
export const CUSTOM_THEME_OPAQUE_COLOR_NAMES = Object.freeze(VARIABLE_SPECS.filter((spec) => spec.type === "color" && spec.opaque).map((spec) => spec.name));
/** The colour variables that also derive an `--x-rgb` triplet for rgba() use. */
export const CUSTOM_THEME_RGB_SOURCE_NAMES = Object.freeze([
    "--accent",
    "--link",
    "--green",
    "--coral",
    "--danger",
]);
const HEX6 = /^#[0-9A-Fa-f]{6}$/;
const HEX8 = /^#[0-9A-Fa-f]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function hasControlChar(value) {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x1f || code === 0x7f)
            return true;
    }
    return false;
}
/** True when `value` is a well-formed `custom:<uuid>` id. */
export function isCustomThemeId(value) {
    if (typeof value !== "string" || !value.startsWith(CUSTOM_THEME_ID_PREFIX))
        return false;
    return UUID.test(value.slice(CUSTOM_THEME_ID_PREFIX.length));
}
/** True when `value` is a well-formed ephemeral `custom-preview:<uuid>` id. */
export function isCustomThemePreviewId(value) {
    if (typeof value !== "string" || !value.startsWith(CUSTOM_THEME_PREVIEW_ID_PREFIX))
        return false;
    return UUID.test(value.slice(CUSTOM_THEME_PREVIEW_ID_PREFIX.length));
}
/** True for a built-in theme id: no `custom:` / `custom-preview:` prefix. */
export function isBuiltInThemeId(value) {
    return typeof value === "string"
        && value.length > 0
        && !value.startsWith(CUSTOM_THEME_ID_PREFIX)
        && !value.startsWith(CUSTOM_THEME_PREVIEW_ID_PREFIX);
}
function invalid(message) {
    return { state: 'invalid', ok: false, code: CUSTOM_THEME_ERROR_CODE.INVALID, message };
}
function normalizeHex(value) {
    return `#${value.slice(1).toUpperCase()}`;
}
/**
 * Validate one whole definition (not a patch). Unknown keys, missing required
 * variables, wrong types and out-of-range values are all refused with an
 * actionable message — never coerced or dropped.
 */
export function validateCustomThemeDefinition(input) {
    if (!isPlainObject(input))
        return invalid("Definition must be an object.");
    if (input.formatVersion !== CUSTOM_THEME_FORMAT_VERSION) {
        return invalid(`formatVersion must be ${CUSTOM_THEME_FORMAT_VERSION}.`);
    }
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < CUSTOM_THEME_NAME_MIN_LENGTH || name.length > CUSTOM_THEME_NAME_MAX_LENGTH) {
        return invalid(`name must be 1..${CUSTOM_THEME_NAME_MAX_LENGTH} characters after trimming.`);
    }
    if (hasControlChar(name))
        return invalid("name must not contain control characters.");
    const appearance = input.appearance;
    if (appearance !== "light" && appearance !== "dark") {
        return invalid('appearance must be "light" or "dark".');
    }
    const rawVariables = input.variables;
    if (!isPlainObject(rawVariables))
        return invalid("variables must be an object.");
    for (const key of Object.keys(rawVariables)) {
        if (!SPEC_BY_NAME.has(key))
            return invalid(`Unknown variable "${key}".`);
    }
    const variables = {};
    for (const spec of VARIABLE_SPECS) {
        if (!Object.prototype.hasOwnProperty.call(rawVariables, spec.name)) {
            return invalid(`Missing required variable "${spec.name}".`);
        }
        const checked = validateVariableValue(spec, rawVariables[spec.name]);
        if (typeof checked === "string" && checked.startsWith("\0")) {
            return invalid(checked.slice(1));
        }
        variables[spec.name] = checked;
    }
    return {
        ok: true,
        state: 'valid',
        value: Object.freeze({
            formatVersion: CUSTOM_THEME_FORMAT_VERSION,
            name,
            appearance,
            variables: Object.freeze(variables),
        }),
    };
}
/** Returns the normalized value, or a `\0`-prefixed message on failure. */
function validateVariableValue(spec, value) {
    if (spec.type === "color") {
        if (typeof value !== "string")
            return `\0Variable "${spec.name}" must be a hex colour string.`;
        if (!HEX6.test(value) && !HEX8.test(value)) {
            return `\0Variable "${spec.name}" must be #RRGGBB or #RRGGBBAA.`;
        }
        if (spec.opaque && !HEX6.test(value)) {
            return `\0Variable "${spec.name}" must be an opaque #RRGGBB colour.`;
        }
        return normalizeHex(value);
    }
    if (spec.type === "length") {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return `\0Variable "${spec.name}" must be a finite number.`;
        }
        if (value < (spec.min ?? 0) || value > (spec.max ?? 0)) {
            return `\0Variable "${spec.name}" must be within ${spec.min}..${spec.max}.`;
        }
        return value;
    }
    // font-family
    if (!Array.isArray(value))
        return `\0Variable "${spec.name}" must be an array of font names.`;
    if (value.length < (spec.minItems ?? 1) || value.length > (spec.maxItems ?? 8)) {
        return `\0Variable "${spec.name}" must list 1..${spec.maxItems ?? 8} font names.`;
    }
    const items = [];
    for (const item of value) {
        if (typeof item !== "string")
            return `\0Variable "${spec.name}" font names must be strings.`;
        const trimmed = item.trim();
        if (trimmed.length < CUSTOM_THEME_FONT_ITEM_MIN_LENGTH || trimmed.length > (spec.itemMaxLength ?? 80)) {
            return `\0Variable "${spec.name}" font names must be 1..${spec.itemMaxLength ?? 80} characters.`;
        }
        if (hasControlChar(trimmed))
            return `\0Variable "${spec.name}" font names must not contain control characters.`;
        items.push(trimmed);
    }
    return Object.freeze(items);
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
// ---------------------------------------------------------------------------
// Schema (with a neutral initial draft)
// ---------------------------------------------------------------------------
/** A standalone neutral light draft. Not derived from any built-in theme. */
export const CUSTOM_THEME_INITIAL_DEFINITION = Object.freeze({
    formatVersion: CUSTOM_THEME_FORMAT_VERSION,
    name: "My theme",
    appearance: "light",
    variables: Object.freeze({
        "--bg": "#F6F6F4",
        "--bg-card": "#FCFCFB",
        "--bg-glass": "#F6F6F4F0",
        "--sidebar-bg": "#EFEFED",
        "--accent": "#5B6B8C",
        "--accent-hover": "#4A5877",
        "--accent-light": "#5B6B8C14",
        "--link": "#4A5877",
        "--link-hover": "#3E4A66",
        "--text": "#33363B",
        "--text-light": "#5F646C",
        "--text-muted": "#83888F",
        "--hana-text": "#2E3A4A",
        "--border": "#C9CCD1",
        "--shadow": "#33363B17",
        "--green": "#4F8A6A",
        "--coral": "#E0857F",
        "--danger": "#9B4A44",
        "--jian-note-bg": "#FAF7EF",
        "--jian-note-border": "#C9C2B4",
        "--mood-bg": "#6B4A6B12",
        "--mood-text": "#6B4A6B",
        "--mood-border": "#6B4A6B2E",
        "--tool-bg": "#00000008",
        "--tool-text": "#5F646C",
        "--user-bg": "#5B6B8C14",
        "--drop-overlay-bg": "#F6F6F4D9",
        "--attach-bg": "#0000000A",
        "--overlay-subtle": "#00000008",
        "--overlay-light": "#0000000D",
        "--overlay-medium": "#00000014",
        "--overlay-strong": "#00000026",
        "--tab-slider-bg": "#00000026",
        "--term-bg": "#4A5877",
        "--term-fg": "#FCFCFB",
        "--term-cursor": "#FCFCFB",
        "--term-cursor-accent": "#4A5877",
        "--term-selection-bg": "#FFFFFF40",
        "--term-ansi-black": "#2B3340",
        "--term-ansi-red": "#C07A75",
        "--term-ansi-green": "#7BAE7F",
        "--term-ansi-yellow": "#C6A15B",
        "--term-ansi-blue": "#7A9CC6",
        "--term-ansi-magenta": "#A98BC0",
        "--term-ansi-cyan": "#79B4BC",
        "--term-ansi-white": "#E6E8EA",
        "--term-ansi-bright-black": "#6F757D",
        "--term-ansi-bright-red": "#D99A95",
        "--term-ansi-bright-green": "#9CC9A0",
        "--term-ansi-bright-yellow": "#DCC088",
        "--term-ansi-bright-blue": "#9DB8D9",
        "--term-ansi-bright-magenta": "#C4ACD6",
        "--term-ansi-bright-cyan": "#9CCCD2",
        "--term-ansi-bright-white": "#FFFFFF",
        "--radius-input": 6,
        "--radius-card": 8,
        "--radius-chat-card": 8,
        "--radius-chat-surface": 16,
        "--font-ui": Object.freeze(["-apple-system", "Segoe UI", "sans-serif"]),
        "--font-serif": Object.freeze(["Georgia", "Times New Roman", "serif"]),
        "--font-mono": Object.freeze(["JetBrains Mono", "monospace"]),
    }),
});
export function buildCustomThemeSchema() {
    return Object.freeze({
        formatVersion: CUSTOM_THEME_FORMAT_VERSION,
        variables: CUSTOM_THEME_VARIABLE_SPECS,
        initialDefinition: CUSTOM_THEME_INITIAL_DEFINITION,
    });
}
// ---------------------------------------------------------------------------
// CSS compiler
// ---------------------------------------------------------------------------
function parseHex6(value) {
    return [
        Number.parseInt(value.slice(1, 3), 16),
        Number.parseInt(value.slice(3, 5), 16),
        Number.parseInt(value.slice(5, 7), 16),
    ];
}
/** A fixed dropdown-arrow SVG carrying the validated muted text colour. */
function selectArrowFor(textMuted) {
    const stroke = `%23${textMuted.slice(1, 7).toUpperCase()}`;
    return `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='${stroke}' fill='none' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`;
}
function formatFontStack(names) {
    return names.map((name) => JSON.stringify(name)).join(", ");
}
/**
 * The `name: value;` declarations a compiled theme emits, in schema order.
 * Input must already be validated (see {@link validateCustomThemeDefinition}).
 */
export function customThemeDeclarations(definition) {
    const vars = definition.variables;
    const lines = [];
    for (const spec of VARIABLE_SPECS) {
        const value = vars[spec.name];
        if (spec.type === "color") {
            lines.push(`${spec.name}: ${String(value)};`);
        }
        else if (spec.type === "length") {
            lines.push(`${spec.name}: ${value}px;`);
        }
        else {
            lines.push(`${spec.name}: ${formatFontStack(value)};`);
        }
    }
    for (const name of CUSTOM_THEME_RGB_SOURCE_NAMES) {
        const [r, g, b] = parseHex6(String(vars[name]));
        lines.push(`${name}-rgb: ${r}, ${g}, ${b};`);
    }
    // Input card hairline derived from the overlay hue: 12% at rest, 16% on hover/focus.
    // The source value's own alpha is dropped, so themes written before this token
    // existed still compile to the intended opacity without any migration.
    const [overlayR, overlayG, overlayB] = parseHex6(String(vars["--overlay-medium"]));
    lines.push(`--input-card-border-color: rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.12);`);
    lines.push(`--input-card-active-border-color: rgba(${overlayR}, ${overlayG}, ${overlayB}, 0.16);`);
    lines.push("--bg-texture: none;");
    lines.push("--tab-slider-shadow: none;");
    lines.push(`--select-arrow: ${selectArrowFor(String(vars["--text-muted"]))};`);
    return lines;
}
/** The declaration block only (no selector), one declaration per line. */
export function compileCustomThemeCss(definition) {
    return customThemeDeclarations(definition).join("\n");
}
/** A full `:root { ... }` sheet for the CSS endpoint and the renderer style node. */
export function customThemeRootCss(definition) {
    return `:root {\n${customThemeDeclarations(definition).map((line) => `  ${line}`).join("\n")}\n}\n`;
}
/** The opaque window background a custom theme reports to the native shell. */
export function customThemeBackgroundColor(definition) {
    return String(definition.variables["--bg"]);
}
/** The card-surface background, for native window theming. */
export function customThemeCardBackgroundColor(definition) {
    return String(definition.variables["--bg-card"]);
}
//# sourceMappingURL=app-custom-themes.js.map