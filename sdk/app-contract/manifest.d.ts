/**
 * app-contract/manifest.ts — generated from shared/app-contract/manifest.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppManifestActivationV2 } from "./activation.js";
import type { AppProviderDescriptorV2 } from "./providers.js";
import type { AppCliFlagV2 } from "./cli.js";
import type { AppSettingsSchemaV2 } from "./settings.js";
/**
 * shared/app-contract/manifest.ts — the shape of a v2 app's `manifest.json`,
 * as an author writes it.
 *
 * `server/composition/plugins/plugin-loader-v2.ts`'s `readManifest`
 * validates the runtime-readable manifest; App package admission additionally
 * requires valid card covers and validates the required identity image to generate its display copy. This type is not a
 * substitute for that validation and does not model every nested rule
 * `readManifest` enforces. Shared contribution types cover required data;
 * `APPS.md` documents additional value, path and file checks that only the
 * host can perform. This contract also captures the top-level shape the host checks
 * field-for-field, so a third-party author's own manifest gets real
 * autocomplete and a real compile error for a missing `id` or a
 * `manifestVersion` that is not `2`, without this package encoding the host's
 * entire validation surface.
 *
 * `PluginV2Manifest` (the loader's own richer, fully-checked return type)
 * `extends` this interface, narrowing `capabilities`/`network`/`contributes`
 * from "may be absent" to "always present, defaulted or nullable"; the runtime
 * replaces the author icon and contributes fields with runtime shapes that allow
 * installed legacy Apps without identity icons or card covers. See that
 * interface's own doc comment in `plugin-loader-v2.ts`.
 */
/**
 * The checked top-level `network` block, or what an author declares before
 * checking. `hosts` is not a field here — the loader refuses that v1 alias.
 */
export interface AppManifestNetworkV2 {
    readonly allowedHosts?: readonly string[];
    readonly methods?: readonly string[];
    readonly allowLocalhost?: boolean;
    readonly defaultTimeoutMs?: number;
    readonly maxResponseBytes?: number;
}
/** One file selector is ANDed; separate selectors are ORed by the host. */
export interface AppManifestPreviewerSelectorV2 {
    readonly extensions?: readonly string[];
    readonly mimeTypes?: readonly string[];
}
/** A declarative previewer rendered through this App's own `ui/` tree. */
export interface AppManifestPreviewerContributionV2 {
    readonly id: string;
    readonly title: string;
    readonly selectors: readonly AppManifestPreviewerSelectorV2[];
    readonly route: string;
    readonly mode: "read" | "edit";
    readonly icon?: string;
    readonly formFactors?: readonly string[];
}
/** A package-relative App UI document used as this App's settings page. */
export interface AppManifestSettingsUiV2 {
    /** An absolute, query-free path under this App's own `ui/` directory. */
    readonly route: string;
}
/**
 * The settings declaration's author-facing shape. The host validates the
 * schema vocabulary at load time; `ui`, when supplied, replaces only the
 * host's generic form and does not make the schema optional to `ctx.config`.
 */
export interface AppManifestSettingsContributionV2 {
    readonly title?: string;
    readonly schema?: AppSettingsSchemaV2;
    readonly ui?: AppManifestSettingsUiV2;
}
/** One optional full function-panel view declared by an App card. */
export type AppManifestFunctionPanelV2 = {
    readonly id: string;
    readonly label?: string;
} & ({
    readonly route: string;
    readonly embedUrl?: never;
} | {
    readonly embedUrl: string;
    readonly route?: never;
} | {
    readonly route?: undefined;
    readonly embedUrl?: undefined;
});
/** One App card. Every card needs a bundled cover, including pages and stream cards. */
export interface AppManifestCardContributionV2 {
    readonly id: string;
    readonly title?: string;
    readonly description?: string;
    readonly route?: string;
    readonly embedUrl?: string;
    readonly detached?: {
        readonly route: string;
    };
    readonly detachedDefaultSize?: {
        readonly width: number;
        readonly height: number;
    };
    readonly cardForm?: string;
    readonly titlebar?: string;
    readonly realization?: "card" | "page" | null;
    readonly pageOf?: string | null;
    readonly closable?: boolean | null;
    readonly siteNavEntry?: boolean | null;
    readonly fpFullPanel?: boolean | null;
    /** route and embedUrl are mutually exclusive, checked by the host. */
    readonly functionPanel?: {
        readonly id: string;
        readonly label?: string;
        readonly route?: string;
        readonly embedUrl?: string;
    } | null;
    /** Required nonempty PNG, WebP or SVG file relative to this App's ui/ directory. */
    readonly face: {
        readonly image: string;
    };
    readonly formFactors?: readonly string[] | null;
}
/**
 * Author-facing contribution vocabulary. Cards expose their required cover
 * in the SDK; path safety, file existence and other manifest rules are
 * checked by the host during package validation; runtime reads preserve legacy
 * Apps without covers and omit unusable cover files with a warning.
 */
export interface AppManifestContributesV2 {
    readonly settings?: AppManifestSettingsContributionV2;
    readonly ui?: unknown;
    readonly cards?: readonly AppManifestCardContributionV2[];
    readonly agentTypes?: unknown;
    readonly messageRenderers?: unknown;
    readonly providers?: unknown;
    readonly nativeProviders?: readonly AppProviderDescriptorV2[];
    readonly previewers?: readonly AppManifestPreviewerContributionV2[];
    /** Static, App-owned arguments accepted by `hana serve -- --app.<id>.<flag>`. */
    readonly cliFlags?: readonly AppCliFlagV2[];
    readonly homeActions?: readonly AppManifestHomeActionV2[];
}
/** A host-rendered action on the Extensions area of the App home. */
export interface AppManifestHomeActionV2 {
    readonly id: string;
    readonly title: string;
    readonly toolName: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly icon?: 'app' | 'wrench';
}
/**
 * A v2 app's `manifest.json`, as an author writes it.
 *
 * Cards, settings, previewers and other shared declarations have public
 * types. Remaining contribution payloads are host-validated JSON. See
 * `APPS.md` for the complete field rules. Package admission requires every
 * declared card's bundled cover; runtime reads allow legacy coverless cards.
 */
export interface AppManifestV2 {
    readonly manifestVersion: 2;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly entry: string;
    /** Package-relative identity image distributed with this App. */
    readonly icon: string;
    readonly capabilities?: readonly string[];
    readonly network?: AppManifestNetworkV2 | null;
    /** Opt in to static discovery with an execution process started by first use. */
    readonly activation?: AppManifestActivationV2;
    readonly minAppVersion?: string;
    readonly formFactors?: readonly string[];
    readonly contributes?: AppManifestContributesV2;
    /** A one-sentence, human-readable summary shown in the extensions list and detail page. */
    readonly description?: string;
    /**
     * When `true`, this app loads, runs, and registers its tools exactly as
     * normal, but is left out of the extensions list, the market's "installed"
     * marker, and `extension_manager`'s `list` result — an `inspect(ref)` by
     * id still finds it. Default `false`. For a bundled app that exists only
     * to back some other surface (a settings page, a background tool) with
     * nothing of its own worth a row in the list.
     */
    readonly hidden?: boolean;
}
//# sourceMappingURL=manifest.d.ts.map