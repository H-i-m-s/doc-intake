/**
 * app-contract/manifest.ts — generated from shared/app-contract/manifest.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppManifestActivationV2 } from "./activation.js";
import type { AppProviderDescriptorV2 } from "./providers.js";
import type { AppCliFlagV2 } from "./cli.js";
import type { AppSettingsSchemaV2 } from "./settings.js";
import type { AppServiceReferenceV2 } from "./runtime.js";
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
    readonly service?: never;
} | {
    readonly embedUrl: string;
    readonly route?: never;
    readonly service?: never;
} | {
    readonly service: AppServiceReferenceV2;
    readonly route?: never;
    readonly embedUrl?: never;
} | {
    readonly route?: undefined;
    readonly embedUrl?: undefined;
    readonly service?: undefined;
});
/**
 * 卡片三态形态（v2 推荐的新作者路径）。内容与卡体的关系：
 *   · framed        内容内缩，卡体里有一层内缩 frame；标题区占位、默认显示
 *   · structural    内容直接构成卡体，不额外套内层 frame；标题区占位、默认显示
 *   · edge-to-edge  内容铺满整个卡体（含顶部）；Chrome 悬浮，标题默认隐藏
 * 相对旧的两轴（`cardForm: framed|flush` × `titlebar: solid|translucent`），三态把
 * 形态收敛到一个字段；标题显示策略独立由 `titleMode` 控制。
 */
export declare const APP_CARD_FORMS: readonly ["framed", "structural", "edge-to-edge"];
export type AppCardFormV2 = typeof APP_CARD_FORMS[number];
/** 标题显示策略：auto 由三态派生；show / hide 显式覆盖。 */
export declare const APP_CARD_TITLE_MODES: readonly ["auto", "show", "hide"];
export type AppCardTitleModeV2 = typeof APP_CARD_TITLE_MODES[number];
/**
 * 历史 `cardForm` 写法。读时仍被接受并映射回旧观感（新作者不要使用）：
 *   · fill    = flush + 透明标题带
 *   · unified = flush（标题带那一维交还给 `titlebar`）
 *   · flush   内容贴卡体
 * @deprecated 用三态值（如 `cardForm: "structural"`）声明形态，标题策略改用 `titleMode`。
 */
export declare const APP_CARD_FORMS_LEGACY: readonly ["flush", "fill", "unified"];
export type AppCardFormLegacyV2 = typeof APP_CARD_FORMS_LEGACY[number];
/** One App card. Every card needs a bundled cover, including pages and stream cards. */
export interface AppManifestCardContributionV2 {
    readonly id: string;
    readonly title?: string;
    readonly description?: string;
    readonly route?: string;
    readonly embedUrl?: string;
    /**
     * A logical reference to one of this App's own managed services. Mutually
     * exclusive with `route` and `embedUrl`; the host resolves it through the
     * App's `_runtime` mount and never from a declaration-supplied URL.
     */
    readonly service?: AppServiceReferenceV2;
    readonly detached?: {
        readonly route: string;
    };
    readonly detachedDefaultSize?: {
        readonly width: number;
        readonly height: number;
    };
    /** 形态声明。推荐值见 {@link APP_CARD_FORMS}（framed / structural / edge-to-edge）；
        历史值 {@link APP_CARD_FORMS_LEGACY}（flush / fill / unified）仍合法（deprecated）。 */
    readonly cardForm?: string;
    /** @deprecated 材质词（solid / translucent），混合了材质与布局职责。读时仍被接受；
        新作者声明标题显示策略请用 `titleMode`，不要再用 `titlebar`。 */
    readonly titlebar?: string;
    /** 标题显示策略 {@link APP_CARD_TITLE_MODES}：auto（由三态派生）/ show / hide。缺省 auto。 */
    readonly titleMode?: string;
    readonly realization?: "card" | "page" | null;
    readonly pageOf?: string | null;
    /**
     * Compatibility only. A page card never closes, detaches or leaves its page
     * on its own, whatever this says; ordinary cards ignore it.
     */
    readonly closable?: boolean | null;
    readonly siteNavEntry?: boolean | null;
    readonly fpFullPanel?: boolean | null;
    /** route, embedUrl and service are mutually exclusive, checked by the host. */
    readonly functionPanel?: {
        readonly id: string;
        readonly label?: string;
        readonly route?: string;
        readonly embedUrl?: string;
        readonly service?: AppServiceReferenceV2;
    } | null;
    /** Required nonempty PNG, WebP or SVG file relative to this App's ui/ directory. */
    readonly face: {
        readonly image: string;
    };
    /**
     * Page navigation icon: the same base as `face.image` — a bundled PNG, WebP,
     * or static SVG under this App's own `ui/` tree. Only the whole-page primary
     * (`realization: "page"` without `pageOf`) owns its page's navigation
     * identity, so only that card's `pageIcon` takes effect; on other cards the
     * field is dropped with a diagnostic. Distinct from the App identity `icon`
     * (package root, shown in the extensions list) and from the card centre
     * `face.image` cover. Requires `minAppVersion` at/above the host that first
     * served it.
     */
    readonly pageIcon?: string;
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
    /** Style packs for Hana's casual chat; needs the `app/casual.style` capability. */
    readonly stylePacks?: readonly AppManifestStylePackContributionV2[];
}
/**
 * One style pack the App provides to Hana's casual chat (`contributes.stylePacks[]`). `id` is the pack's own id;
 * the registry id is `<appId>/<id>`. `path` is a directory inside this App's package, laid out like the built-in
 * `hana-default` pack (`pack.yaml`, `params.yaml`, `rules/<locale>/`, optional `appearance` in `pack.yaml`, and an
 * optional `stickers/` directory). The App must also declare the `app/casual.style` capability.
 */
export interface AppManifestStylePackContributionV2 {
    readonly id: string;
    readonly path: string;
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