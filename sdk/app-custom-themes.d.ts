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
export declare const CUSTOM_THEME_FORMAT_VERSION: 1;
/** User theme ids are `custom:<uuid>`. The suffix is a host-minted random UUID. */
export declare const CUSTOM_THEME_ID_PREFIX: "custom:";
/**
 * An ephemeral preview is addressed by `custom-preview:<uuid>`. This id is a
 * handle for the running CSS endpoint, never a value the user may save into
 * `preferences.appearance.theme`.
 */
export declare const CUSTOM_THEME_PREVIEW_ID_PREFIX: "custom-preview:";
export declare const CUSTOM_THEME_NAME_MIN_LENGTH = 1;
export declare const CUSTOM_THEME_NAME_MAX_LENGTH = 80;
export declare const CUSTOM_THEME_RADIUS_MIN = 0;
export declare const CUSTOM_THEME_RADIUS_MAX = 32;
export declare const CUSTOM_THEME_FONT_MIN_ITEMS = 1;
export declare const CUSTOM_THEME_FONT_MAX_ITEMS = 8;
export declare const CUSTOM_THEME_FONT_ITEM_MIN_LENGTH = 1;
export declare const CUSTOM_THEME_FONT_ITEM_MAX_LENGTH = 80;
/** Error codes surfaced to the App through `HanaPluginError.code`. */
export declare const CUSTOM_THEME_ERROR_CODE: {
    readonly INVALID_ID: "CUSTOM_THEME_INVALID_ID";
    readonly NOT_FOUND: "CUSTOM_THEME_NOT_FOUND";
    readonly CONFLICT: "CUSTOM_THEME_CONFLICT";
    readonly INVALID: "CUSTOM_THEME_INVALID";
    readonly IN_USE: "CUSTOM_THEME_IN_USE";
    readonly PREVIEW_BUSY: "CUSTOM_THEME_PREVIEW_BUSY";
    readonly PREVIEW_UNAVAILABLE: "CUSTOM_THEME_PREVIEW_UNAVAILABLE";
    readonly STORAGE_ERROR: "CUSTOM_THEME_STORAGE_ERROR";
};
export type CustomThemeErrorCode = (typeof CUSTOM_THEME_ERROR_CODE)[keyof typeof CUSTOM_THEME_ERROR_CODE];
export type CustomThemeAppearance = "light" | "dark";
export type CustomThemeVariableType = "color" | "length" | "font-family";
export type CustomThemeVariableValue = string | number | readonly string[];
/** The full variable bag of one definition, keyed by CSS variable name. */
export type CustomThemeVariables = Readonly<Record<string, CustomThemeVariableValue>>;
export type CustomThemeId = `custom:${string}`;
export type CustomThemePreviewId = `custom-preview:${string}`;
/** The authored, validated content of one user theme. */
export interface CustomThemeDefinition {
    readonly formatVersion: typeof CUSTOM_THEME_FORMAT_VERSION;
    /** Trimmed, 1..80 characters. */
    readonly name: string;
    readonly appearance: CustomThemeAppearance;
    /** Every schema variable, each value typed and range-checked. */
    readonly variables: CustomThemeVariables;
}
/** A stored user theme: the definition plus host-minted identity and history. */
export interface CustomThemeRecord extends CustomThemeDefinition {
    readonly id: CustomThemeId;
    /** Starts at 1; every successful `update` bumps it by one. */
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
}
export interface CustomThemeSummary {
    readonly id: CustomThemeId;
    readonly name: string;
    readonly appearance: CustomThemeAppearance;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
}
/**
 * A live preview handle. `themeId` echoes the saved theme the preview was
 * opened against (if any) purely so the caller can reason about occupancy; it
 * never decides the colours shown.
 */
export interface CustomThemePreview {
    readonly previewId: string;
    readonly themeId: CustomThemeId | null;
    readonly expiresAt: string;
}
export type CustomThemeChangeKind = "created" | "updated" | "removed" | "applied" | "preview-started" | "preview-ended";
/** A coarse invalidation notice; subscribers re-read via list/get. */
export interface CustomThemeChange {
    readonly kind: CustomThemeChangeKind;
    readonly id?: CustomThemeId;
    readonly revision?: number;
}
export interface CustomThemeSchemaVariable {
    readonly name: string;
    readonly type: CustomThemeVariableType;
    readonly group: string;
    readonly label: string;
    readonly required: true;
    /** A `color` value that must be exactly 6 hex digits (no alpha). */
    readonly opaque?: true;
    /** Included in the range for `length` values, in CSS pixels. */
    readonly min?: number;
    readonly max?: number;
    readonly minItems?: number;
    readonly maxItems?: number;
    readonly itemMaxLength?: number;
}
export interface CustomThemeSchema {
    readonly formatVersion: typeof CUSTOM_THEME_FORMAT_VERSION;
    readonly variables: readonly CustomThemeSchemaVariable[];
    /**
     * A complete, neutral light draft to start editing from. It is a standalone
     * set of values, never a copy of any built-in theme.
     */
    readonly initialDefinition: CustomThemeDefinition;
}
/** The public API surface (`hana.themes.custom`) — see `APPS.md`. */
export interface CustomThemesApi {
    list(): Promise<CustomThemeSummary[]>;
    get(id: CustomThemeId): Promise<CustomThemeRecord>;
    getSchema(): Promise<CustomThemeSchema>;
    create(definition: CustomThemeDefinition): Promise<CustomThemeRecord>;
    update(id: CustomThemeId, input: {
        expectedRevision: number;
        patch: Partial<Pick<CustomThemeDefinition, "name" | "appearance">> & {
            variables?: Partial<CustomThemeVariables>;
        };
    }): Promise<CustomThemeRecord>;
    remove(id: CustomThemeId, options: {
        expectedRevision: number;
    }): Promise<void>;
    apply(id: CustomThemeId): Promise<CustomThemeRecord>;
    preview(input: {
        definition: CustomThemeDefinition;
        themeId?: CustomThemeId;
    }): Promise<CustomThemePreview>;
    endPreview(previewId: string): Promise<void>;
    subscribe(callback: (event: CustomThemeChange) => void): () => void;
}
export declare const CUSTOM_THEME_VARIABLE_SPECS: readonly CustomThemeSchemaVariable[];
export declare const CUSTOM_THEME_VARIABLE_NAMES: readonly string[];
/** Names that must be exactly 6 hex digits (no alpha). */
export declare const CUSTOM_THEME_OPAQUE_COLOR_NAMES: readonly string[];
/** The colour variables that also derive an `--x-rgb` triplet for rgba() use. */
export declare const CUSTOM_THEME_RGB_SOURCE_NAMES: readonly string[];
/** True when `value` is a well-formed `custom:<uuid>` id. */
export declare function isCustomThemeId(value: unknown): value is CustomThemeId;
/** True when `value` is a well-formed ephemeral `custom-preview:<uuid>` id. */
export declare function isCustomThemePreviewId(value: unknown): value is CustomThemePreviewId;
/** True for a built-in theme id: no `custom:` / `custom-preview:` prefix. */
export declare function isBuiltInThemeId(value: unknown): value is string;
/**
 * Validation outcome. The `state` string is the discriminant callers narrow on:
 * parts of this repo compile with `strictNullChecks: false`, under which a
 * boolean discriminant does not narrow a union.
 */
export type CustomThemeValidationResult = {
    readonly state: 'valid';
    readonly ok: true;
    readonly value: CustomThemeDefinition;
} | {
    readonly state: 'invalid';
    readonly ok: false;
    readonly code: CustomThemeErrorCode;
    readonly message: string;
};
/**
 * Validate one whole definition (not a patch). Unknown keys, missing required
 * variables, wrong types and out-of-range values are all refused with an
 * actionable message — never coerced or dropped.
 */
export declare function validateCustomThemeDefinition(input: unknown): CustomThemeValidationResult;
/** A standalone neutral light draft. Not derived from any built-in theme. */
export declare const CUSTOM_THEME_INITIAL_DEFINITION: CustomThemeDefinition;
export declare function buildCustomThemeSchema(): CustomThemeSchema;
/**
 * The `name: value;` declarations a compiled theme emits, in schema order.
 * Input must already be validated (see {@link validateCustomThemeDefinition}).
 */
export declare function customThemeDeclarations(definition: CustomThemeDefinition): string[];
/** The declaration block only (no selector), one declaration per line. */
export declare function compileCustomThemeCss(definition: CustomThemeDefinition): string;
/** A full `:root { ... }` sheet for the CSS endpoint and the renderer style node. */
export declare function customThemeRootCss(definition: CustomThemeDefinition): string;
/** The opaque window background a custom theme reports to the native shell. */
export declare function customThemeBackgroundColor(definition: CustomThemeDefinition): string;
/** The card-surface background, for native window theming. */
export declare function customThemeCardBackgroundColor(definition: CustomThemeDefinition): string;
//# sourceMappingURL=app-custom-themes.d.ts.map