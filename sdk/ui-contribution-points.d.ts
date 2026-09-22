/**
 * ui-contribution-points.ts — generated from shared/ui-contribution-points.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/ui-contribution-points.ts — the vocabulary a v2 plugin's UI
 * contributions are written in, shared between the manifest reader
 * (`server/composition/plugins/plugin-loader-v2.ts`), the registration table
 * (`server/composition/plugins/ui-contributions.ts`) and, eventually, the
 * renderer that mounts what a plugin contributed.
 *
 * Slot ids are named as constants rather than typed as a free-form string so a
 * contributor and a consumer are reading the same literal rather than two
 * strings that happen to match today. Context-menu seats live in
 * `UI_SLOT_DIRECTORY` the same way: a plugin may only sit in a seat this table
 * opens, it cannot invent a location.
 */
import type { AppInputStatusIconName } from './app-input-status-icons.js';
/** A row of actions attached to a chat message. */
export declare const UI_SLOT_MESSAGE_ACTIONS: "hana/chat.message.actions";
/** Chrome attached to a card's own frame. */
export declare const UI_SLOT_CARD_CHROME: "hana/card.chrome";
/** 会话列表·会话条目右键。 */
export declare const UI_SLOT_SESSION_CONTEXT_MENU: "hana/session.contextMenu";
/** 聊天区选中文字右键。 */
export declare const UI_SLOT_CHAT_SELECTION_CONTEXT_MENU: "hana/chat.selection.contextMenu";
/** 黑板卡（卡中心条目）右键。 */
export declare const UI_SLOT_CARD_CONTEXT_MENU: "hana/card.contextMenu";
/** Global keyboard dispatcher for a v2 app's declared keybindings. */
export declare const UI_SLOT_KEYBINDINGS: "hana/commands.keybindings";
export declare const UI_SLOT_INPUT_CONTROLS: "hana/input.controls";
/** Host-rendered launch entries for Apps that provide a Developer Space. */
export declare const UI_SLOT_HOME_ACTIONS: "hana/home.actions";
/**
 * One action a plugin adds to a chat message's action row.
 *
 * `messages` says which messages the action shows up on; a manifest that
 * leaves it out is normalized to `"assistant"` by the manifest reader, so a
 * consumer of the normalized form never sees it absent.
 */
export interface UiMessageActionContribution {
    /** Unique within this plugin's own `messageActions` array. */
    readonly id: string;
    /** What the action shows as a label. */
    readonly title: string;
    readonly icon?: string;
    /** Which messages this action is offered on. */
    readonly messages: "assistant" | "user" | "all";
    /** The tool this plugin registered that the action invokes. */
    readonly toolName: string;
    readonly args?: Record<string, unknown>;
}
/**
 * One piece of chrome a plugin attaches to a card's frame.
 *
 * Exactly one of `targetCardDefinitionId` and `targetCard` must be present —
 * enforced by the manifest reader (`plugin-loader-v2.ts`), not by this type
 * itself. `targetCardDefinitionId` names a card *definition*; `targetCard`
 * names a card *instance's owner* instead — the plugin that owns whatever
 * card the chrome should attach to, optionally narrowed to one of that
 * plugin's own static cards by `cardId`. Both are resolved optimistically,
 * the same way: a contribution naming a card definition, or a plugin/card,
 * that does not exist yet is not an error, it simply has nothing to attach to
 * until one appears.
 */
export interface UiCardChromeContribution {
    /** Unique within this plugin's own `cardChrome` array. */
    readonly id: string;
    readonly title: string;
    readonly icon?: string;
    /** The card definition this chrome attaches to. Mutually exclusive with `targetCard`. */
    readonly targetCardDefinitionId?: string;
    /**
     * The card *owner* this chrome attaches to — every card the named plugin
     * owns, or (with `cardId`) one specific static card of that plugin's.
     * Mutually exclusive with `targetCardDefinitionId`.
     */
    readonly targetCard?: {
        readonly appId: string;
        readonly cardId?: string;
    };
    /** The tool this plugin registered that the chrome invokes. */
    readonly toolName: string;
    readonly args?: Record<string, unknown>;
}
/**
 * One slot a plugin opens on its own cards — "opens", not "fills": declaring
 * a slot names a place other contributions can target, it does not itself
 * put anything there. The slot's id is `${owningApp'sAppId}/${name}`,
 * assembled by the manifest reader, never written out by the manifest
 * itself. `name` must match `/^[a-z0-9][a-z0-9-]*$/` and be unique within
 * this plugin's own `slots` array — both enforced by the manifest reader.
 *
 * The slot's *position* is not something the manifest gets to say: the host
 * fixes it at a single anchor. `host-primitive` (the default, when `render`
 * is omitted) is a button on every card this plugin owns — the in-flow
 * `ChatCardShell` action row and the chalkboard titlebar chrome row.
 * `render: "iframe"` is a fixed-height frame inside those same card shells,
 * filled by another app's `ui/` page. Declaring a slot is opening a door and
 * naming it; it is not a per-card placement choice.
 */
export interface UiPluginSlotDeclaration {
    readonly name: string;
    readonly title?: string;
    /** When present must be `"iframe"`; omitted means host-primitive. */
    readonly render?: "iframe";
}
/**
 * One button a plugin (any plugin, including the slot's own owner) adds to
 * another plugin's declared slot. `slot` is the full slot id
 * (`${slotOwningApp'sAppId}/${name}`) — not a local name, since the
 * slot being targeted usually belongs to a different plugin than the one
 * contributing to it.
 *
 * Resolved optimistically, the same way a card-chrome target is: a
 * contribution naming a slot that does not exist yet (or ever) is not an
 * error, it simply has nothing to attach to until one appears — the
 * registry's existing "a contribution to an undeclared slot is invisible,
 * not rejected" behavior already provides this for free.
 *
 * A `hana/`-prefixed slot (one of the host's own built-in slots, declared in
 * `UI_SLOT_DIRECTORY`) can never be targeted this way — the host's own slots
 * take contributions through their own keys (`messageActions`, `cardChrome`),
 * not through `slotContributions`. The manifest reader refuses a `slot`
 * starting with `hana/` for exactly this reason.
 *
 * Two shapes, picked by which field is present (they are mutually exclusive
 * at read time): a host-primitive fill carries `title` + `toolName` (and
 * optional `icon` / `args`); an iframe fill carries `route` and does not
 * require `toolName`. `channel` / `routeUrl` are host-stamped on the HTTP
 * projection, never read from the manifest.
 */
export interface UiPluginSlotContribution {
    readonly slot: string;
    /** Unique within this plugin's own `slotContributions` array. */
    readonly id: string;
    readonly title?: string;
    readonly icon?: string;
    /** The tool this plugin registered that the button invokes. Required for host-primitive fills. */
    readonly toolName?: string;
    readonly args?: Record<string, unknown>;
    /** `ui/`-relative path for an iframe fill. Required when `toolName` is absent. */
    readonly route?: string;
    /** Host-stamped on the wire for iframe fills; always `"app"`. */
    readonly channel?: "app";
    /** Host-stamped document path `/api/apps/<contributorAppId>/ui<route>`. */
    readonly routeUrl?: string;
}
/**
 * One item a plugin adds to a host-owned context menu.
 *
 * `surface` names a seat in `UI_SLOT_DIRECTORY` whose `render` is
 * `context-menu` and whose `access` is `plugin`. The manifest reader drops
 * an entry whose surface is unknown or still closed, with a warning, rather
 * than failing the whole app — whether a surface is open is a fact of this
 * host version, not of the entry's own shape. Clicking the item is wired in a
 * later batch; until then the contribution is stored and projected, not drawn.
 */
export interface UiContextMenuContribution {
    /** Unique within this plugin's own `contextMenus` array. */
    readonly id: string;
    /** What the item shows as a label. The plugin supplies copy; there is no i18n. */
    readonly title: string;
    readonly icon?: string;
    /** A host context-menu slot id this version has opened to plugins. */
    readonly surface: string;
    /** The tool this plugin registered that the item invokes. */
    readonly toolName: string;
    readonly args?: Record<string, unknown>;
}
/**
 * One keyboard shortcut a plugin contributes. Clicking is not involved:
 * the host's global dispatcher matches the chord and invokes `toolName`
 * through the same ui-actions channel a message-action button uses.
 *
 * `key` is stored in the canonical form `parseKeybinding` answers
 * (`Mod+Shift+K`, not `shift+mod+k`). The manifest reader drops an entry
 * whose chord is illegal or reserved by the host, with a warning, rather
 * than failing the whole app — those are occupancy facts, not a broken
 * entry shape.
 */
export interface UiKeybindingContribution {
    /** Unique within this plugin's own `keybindings` array. */
    readonly id: string;
    /** Canonical chord, e.g. `Mod+Shift+K`. */
    readonly key: string;
    /** The tool this plugin registered that the shortcut invokes. */
    readonly toolName: string;
    readonly args?: Record<string, unknown>;
    /** Optional label for diagnostics; not shown as a UI control. */
    readonly title?: string;
}
/** A host-rendered item in the chat input bar. */
export interface UiInputStatusContribution {
    /** Unique within this App's `inputStatus` array. */
    readonly id: string;
    /** Full label for tooltips and accessible names. Legacy declarations with no icon or text render this value. */
    readonly title: string;
    /** Optional host-owned icon. When omitted, the host does not add a default icon. */
    readonly icon?: AppInputStatusIconName;
    /** Optional visible text. When combined with `icon`, both are rendered. */
    readonly text?: string;
    readonly tooltip?: string;
    readonly toolName?: string;
    readonly args?: Record<string, unknown>;
}
export interface UiHomeActionContribution {
    readonly id: string;
    readonly title: string;
    readonly toolName: string;
    readonly args?: Record<string, unknown>;
    readonly icon?: 'app' | 'wrench';
}
/** Everything one plugin declares under `contributes.ui`. */
export interface PluginUiContributions {
    readonly messageActions: readonly UiMessageActionContribution[];
    readonly cardChrome: readonly UiCardChromeContribution[];
    /** Slots this plugin opens on its own cards. See `UiPluginSlotDeclaration`. */
    readonly slots: readonly UiPluginSlotDeclaration[];
    /** Fills this plugin contributes to slots (buttons, or iframe pages). */
    readonly slotContributions: readonly UiPluginSlotContribution[];
    /** Items this plugin adds to host-owned context menus. See `UiContextMenuContribution`. */
    readonly contextMenus: readonly UiContextMenuContribution[];
    /** Host-rendered controls and passive status in the input bar. */
    readonly inputStatus?: readonly UiInputStatusContribution[];
    /** Global keyboard shortcuts this plugin declares. See `UiKeybindingContribution`. */
    readonly keybindings?: readonly UiKeybindingContribution[];
    readonly homeActions?: readonly UiHomeActionContribution[];
}
/**
 * How a slot's content reaches the screen. `host-primitive` means the host's
 * own component renders it directly (an action button, a chrome icon);
 * `react` means a React subtree is mounted in place; `iframe` means the
 * content runs in a sandboxed frame the host does not share a DOM with;
 * `context-menu` means the host renders a `ContextMenuItem` — the plugin has
 * no UI of its own in that menu, only the item's title / icon / tool.
 */
export type UiSlotRender = "host-primitive" | "react" | "iframe" | "context-menu";
/**
 * Who is allowed to contribute to a slot. `builtin` means only the host's own
 * code fills it; `plugin` means a v2 plugin's `contributes.ui` can as well;
 * `closed` means the slot exists in the UI today but has no contribution
 * mechanism at all yet — declared so the directory below is a complete map of
 * the UI, not just the plugin-reachable part of it.
 */
export type UiSlotAccess = "builtin" | "plugin" | "closed";
/** A slot's own declaration: what it is, before anything has filled it. */
export interface UiSlotDeclaration {
    id: string;
    render: UiSlotRender;
    access: UiSlotAccess;
}
/** Where a contribution came from: the host itself, or a named plugin. */
export type UiContributionSource = "builtin" | {
    pluginId: string;
};
/**
 * One thing filling one slot. `key` is globally unique across the whole
 * registry — a plugin-sourced contribution assembles it as
 * `${pluginId}/${slotId}/${id}` so two plugins contributing an entry with the
 * same local `id` to the same slot never collide.
 */
export interface UiSlotContribution {
    key: string;
    source: UiContributionSource;
    slotId: string;
    /**
     * Narrows which "plugin of a plugin" this contribution is for — today only
     * used by card chrome, where a contribution names either the card
     * definition it attaches to (`cardDefinitionId`) or the card *owner* it
     * attaches to (`cardOwner`, projected from `UiCardChromeContribution.targetCard`).
     * Absent (or an absent sub-field) means "applies wherever the slot is asked
     * for", matching `useSlotContributions`'s own filtering rule — except
     * `cardOwner`, whose asymmetric rule that same rule's doc comment explains.
     */
    target?: {
        cardDefinitionId?: string;
        cardOwner?: {
            appId: string;
            cardId?: string;
        };
    };
    payload: unknown;
}
export type UiSlotDirectoryEntry = UiSlotDeclaration & {
    readonly implementedAt: string;
};
export declare const UI_SLOT_DIRECTORY: readonly UiSlotDirectoryEntry[];
//# sourceMappingURL=ui-contribution-points.d.ts.map