/**
 * app-contract/dynamic-ui.ts — generated from shared/app-contract/dynamic-ui.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** A main-window App shortcut. The host stamps App identity and validates the chord. */
export interface HanaPluginShortcutRegistrationV2 {
    readonly id: string;
    readonly key: string;
    readonly toolName: string;
    readonly args?: Readonly<Record<string, unknown>>;
    readonly title?: string;
}
export interface HanaPluginShortcutsV2 {
    readonly register: (registration: HanaPluginShortcutRegistrationV2) => () => void;
}
export declare const HANA_PLUGIN_SHORTCUTS_V2_MEMBERS: readonly string[];
/** Maps one App-owned custom message type to one of that App's routed cards. */
export interface HanaPluginMessageRendererRegistrationV2 {
    readonly customType: string;
    readonly cardId: string;
}
export interface HanaPluginMessageRenderersV2 {
    readonly register: (registration: HanaPluginMessageRendererRegistrationV2) => () => void;
}
export declare const HANA_PLUGIN_MESSAGE_RENDERERS_V2_MEMBERS: readonly string[];
/** Permission words for imperative UI registrations; both are default-deny. */
export declare const APP_SHORTCUTS_CAPABILITY = "app/ui.keybindings";
export declare const APP_MESSAGE_RENDERERS_CAPABILITY = "app/ui.message-renderers";
export declare const APP_DYNAMIC_UI_CAPABILITY_WORDS: readonly ["app/ui.keybindings", "app/ui.message-renderers"];
export type AppDynamicUiCapability = (typeof APP_DYNAMIC_UI_CAPABILITY_WORDS)[number];
//# sourceMappingURL=dynamic-ui.d.ts.map