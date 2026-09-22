/**
 * app-contract/context.ts — generated from shared/app-contract/context.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { AppProcessV2 } from "./process.js";
import type { HanaPluginInputStatusV2 } from "./input-status.js";
import type { AppWindows } from "./windows.js";
import type { AppInstances } from "./instances.js";
import type { AppEnvironments } from "./environments.js";
import type { AppSurfaces } from "./surfaces.js";
import type { AppNotifications } from "./notifications.js";
import type { AppInputContentFrameV2, HanaPluginDismissInputPanelRequestV2, HanaPluginShowInputPanelRequestV2, HanaPluginShowInputPanelResultV2, HanaPluginUpdateInputPanelRequestV2, HanaPluginUpdateInputPanelResultV2 } from "./input-panels.js";
import type { AppTasksV2 } from "./tasks.js";
import type { HanaPluginModelsV2 } from "./models.js";
import type { HanaPluginManagedRuntimeV2 } from "./runtime.js";
import type { HanaPluginMcpV2 } from "./mcp.js";
import type { HanaPluginMediaTasksV2 } from "./media.js";
import type { HanaAppProvidersV2 } from "./providers.js";
import type { AppPublicDataV2 } from "./public-data.js";
import type { AppConfigDiscardSessionInputV2, AppConfigForkSessionInputV2, AppConfigStateOptionsV2, AppConfigStateV2 } from "./config-state.js";
import type { AppCatalogScopeOptionsV2, AppCommandCatalogEntryV2, AppToolCatalogEntryV2 } from "./catalog.js";
/**
 * shared/app-contract/context.ts — the public shape of a v2 app's `ctx`.
 *
 * This is the canonical, host-independent declaration of `HanaPluginContextV2`
 * (what a v2 app's `apply(ctx)` receives) and every type it is built from. It
 * used to live inline in `server/composition/plugin-context-v2.ts`; that file
 * now `import type`s everything here instead of declaring it, and re-exports
 * the same names from the same path so nothing outside this module tree has
 * to change its own imports. `lib/resource-io/v2-app-resource-io.ts` does the
 * same for `V2AppResources` and its two dependent shapes. Runtime behavior is
 * unchanged everywhere — this is a type-only relocation.
 *
 * Why this module tree exists: a third-party app author has never had a
 * `npm install`-able package to read these shapes from, only prose
 * (`APPS.md`). `scripts/sync-app-sdk.mjs` copies this file (and the rest of
 * `shared/app-contract/`) into `packages/app-sdk/src/`, unmodified beyond a
 * generated-file header, and that package is what gets published.
 *
 * The import boundary that makes this possible: everything in
 * `shared/app-contract/` may only import from elsewhere in `shared/` and from
 * Node/TS built-ins (enforced by `tests/app-contract-boundary.test.ts`) —
 * never `core/`, `server/`, or `lib/`. Several of the host's own richer types
 * (cordis's own service objects, the `hono` app instance, the neutral
 * host-wide `ToolRegistration` in `lib/tool-registry.ts` that MCP and custom
 * tools also register through, the session-hook registry's own message
 * shapes, …) sit on the wrong side of that line. Where a member's shape
 * needs one of those, this file declares a structurally-identical mirror
 * instead of importing the host type — the two are kept in sync by hand, the
 * same "duplicated on purpose, with a comment saying why" discipline this
 * codebase already uses for a handful of other cross-module constants. Each
 * mirror says which host type it shadows and why. Because a function
 * parameter's own domain type only needs to be *at least as permissive* as
 * what the host actually implements (contravariance), and because a plain
 * data value only needs to be *structurally identical* to what the host
 * actually reads or writes, every mirror below type-checks against the real
 * host implementation with zero casts — verified as part of this change.
 */
import type { AppHookEvent, AppHookWord } from "../app-hook-capabilities.js";
import type { HanaPluginLaunchArgsV2 } from "./cli.js";
import type { HanaPluginMessageRenderersV2, HanaPluginShortcutsV2 } from "./dynamic-ui.js";
export type { HanaPluginMessageRenderersV2, HanaPluginShortcutsV2 } from "./dynamic-ui.js";
export type { HanaPluginLaunchArgsV2 } from "./cli.js";
import type { HanaPluginBusHandlerV2, HanaPluginBusHandleOptionsV2 } from "./app-services.js";
import type { PreviewDocumentContext, V2AppDocumentAccessContext, PreviewDocumentWriteResult } from "../preview/document-contract.js";
import type { AppViewResult } from "../preview/app-view-contract.js";
export type { AppViewRequest, AppViewResult, AppViewImage } from "../preview/app-view-contract.js";
/**
 * What `ctx.tools.register()` accepts.
 *
 * Structurally identical to the host-wide neutral `ToolRegistration`
 * (`lib/tool-registry.ts`) that every tool supplier — MCP, per-agent custom
 * tools, and this door — registers through. That type stays host-side on
 * purpose: it is not v2-app-specific, and a published app types package is
 * the wrong owner for a neutral host abstraction other suppliers depend on
 * too. This mirror is what an app author actually needs to see; the host's
 * `ctx.tools.register` implementation is typed against the real
 * `ToolRegistration` and satisfies this shape structurally.
 */
export interface HanaPluginToolRegistrationV2 {
    /** The name the model calls. Unique across the host's tool registry. */
    readonly name: string;
    /** What the tool does, for the model. Required — never defaulted to `""`. */
    readonly description: string;
    /** JSON Schema for the arguments. Required — never defaulted to an empty schema. */
    readonly parameters: Record<string, unknown>;
    /** The implementation. Arity is deliberately unchecked at this type — see `execute`'s own call-site contract in `APPS.md`. */
    readonly execute: (...args: never[]) => unknown;
    /** Which calling convention the host should dispatch through. Absent lets the host decide. */
    readonly invocationStyle?: "sdk_tool" | "pi_tool";
    /** The registrant's own private notes. Never read by the registry itself. */
    readonly metadata?: Record<string, unknown>;
    /** The tool's permission declaration. Shape is read by the host's permission layer, not by this door. */
    readonly sessionPermission?: Record<string, unknown>;
    /** Whether this tool is offered to a given agent configuration. */
    readonly isEnabledForAgentConfig?: (...args: never[]) => boolean;
    /** Which supplier registered this tool. The host overwrites this on the way in — see `APPS.md`. */
    readonly lane?: string;
    /**
     * Opt in to a host-minted document context for this tool. The model still
     * supplies a documentId argument; it never supplies the access context.
     */
    readonly documentAccess?: "read" | "write";
    /** Optional association with this App's Preview provider. Requires documentAccess. */
    readonly view?: {
        providerId: string;
    };
}
/**
 * One tool `ctx.tools.listOwn()` hands back — the same three fields a
 * registration itself requires, never `execute`, `metadata` or
 * `sessionPermission`.
 */
export interface HanaPluginOwnToolV2 {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
}
/**
 * The tool-registration door, and the read-back of only what it installed.
 *
 * No bare `list()`/`get(name)` onto the shared registry itself — either would
 * let one app enumerate or read every tool every other supplier in the
 * process registered. `listOwn` is scoped by construction to this app's own
 * registrations.
 */
export interface HanaPluginToolsV2 {
    /** Register one tool; the returned disposer removes it again. Bound to this app's own lifetime. */
    readonly register: (registration: HanaPluginToolRegistrationV2) => () => void;
    /** Every tool this app's own `register` calls currently have installed, in registration order. */
    readonly listOwn: () => readonly HanaPluginOwnToolV2[];
    /** Safe directory projection; `scope: "all"` requires app/tools.read. */
    readonly list: (options?: AppCatalogScopeOptionsV2) => Promise<readonly AppToolCatalogEntryV2[]>;
}
export declare const HANA_PLUGIN_TOOLS_V2_MEMBERS: readonly string[];
/**
 * The `context` bag a v2 tool `execute` receives as part of its single
 * argument. `callToken` is present on the model-loop channel — see
 * `APPS.md`'s "工具" section for the full contract of what it is for.
 */
export interface HanaPluginToolExecuteContextV2 {
    readonly sessionPath: string | null;
    readonly messageId: string | null;
    readonly messageText: string | null;
    readonly callToken?: string;
    /** Present only when the host has authorized this tool for a bound document. */
    readonly document?: {
        context: PreviewDocumentContext;
        access: V2AppDocumentAccessContext;
    };
}
export declare const HANA_PLUGIN_TOOL_EXECUTE_CONTEXT_V2_MEMBERS: readonly string[];
/** One log line's worth of arguments. */
export type HanaPluginLogMethodV2 = (format: unknown, ...param: unknown[]) => void;
/** The four severities, and nothing else — the same four words a v1 plugin's `ctx.log` has. */
export interface HanaPluginLoggerV2 {
    readonly debug: HanaPluginLogMethodV2;
    readonly error: HanaPluginLogMethodV2;
    readonly info: HanaPluginLogMethodV2;
    readonly warn: HanaPluginLogMethodV2;
}
export declare const HANA_PLUGIN_LOGGER_V2_MEMBERS: readonly string[];
/**
 * The v2 App bus, whose host requests use the published App allowlist. An App
 * may also register its own short service name through `handle`; the host
 * assigns `app:<appId>/<name>` and never lets it replace a host verb.
 * `clear` and `registerCapability` remain bus housekeeping, not App APIs.
 * `model:sample-text` and `utility:call-text` are not App request verbs;
 * calling them rejects the returned Promise. The frozen v1 `sampleText`
 * helper does not extend this bus's reach, nor does Provider registration.
 */
export interface HanaPluginBusV2 {
    readonly emit: (event: unknown, sessionPath?: string | null) => void;
    readonly subscribe: (callback: (...args: never[]) => unknown, filter?: unknown) => () => void;
    readonly handle: (name: string, handler: HanaPluginBusHandlerV2, options?: HanaPluginBusHandleOptionsV2) => () => void;
    readonly request: (type: string, payload?: unknown, options?: unknown) => Promise<unknown>;
    readonly hasHandler: (type: string) => boolean;
    readonly getCapability: (type: string) => unknown;
    readonly listCapabilities: () => unknown[];
}
export declare const HANA_PLUGIN_BUS_V2_MEMBERS: readonly string[];
/** One question asked of the user through `ctx.userInteraction.ask()`. */
export interface HanaPluginAskUserRequestV2 {
    readonly sessionPath: string;
    readonly title: string;
    readonly message: string;
    /**
     * A JSON Schema the front end renders as a form: string/number/integer/
     * boolean/enum properties, with at most one level of `type: "object"`
     * grouping. Absent (or `null`) is a plain confirm/decline question.
     */
    readonly requestedSchema?: unknown;
    /** A trusted App-owned question UI; requires app/input.panels permission. */
    readonly contentFrame?: AppInputContentFrameV2;
    /** App-controlled allocation for a trusted custom input panel. */
    readonly presentation?: import("./input-panels.ts").AppInputPanelPresentationPatchV2;
    /** How long to wait before this settles as `"timeout"`. Capped at ten minutes. */
    readonly timeoutMs?: number;
}
/**
 * What the user decided.
 *
 * Structurally identical to `lib/user-interaction.ts`'s host-side
 * `AskUserQuestionAnswer` — that type is not app-contract-specific (an MCP
 * elicitation shares the same store and answer shape), so it stays host-side
 * and this is a mirror, not a re-export.
 */
export interface HanaPluginAskUserAnswerV2 {
    /** `"confirmed"` / `"rejected"` from the user, `"timeout"` / `"aborted"` from the store. */
    action?: string;
    /** The structured answer, for a form that was filled in. */
    value?: unknown;
}
/** `userInteraction`: block a v2 app's tool call on a question only a person can answer. */
export interface HanaPluginUserInteractionV2 {
    readonly ask: (request: HanaPluginAskUserRequestV2) => Promise<HanaPluginAskUserAnswerV2>;
    /** Show a trusted App's persistent, non-blocking input panel. Requires app/input.panels. */
    readonly show: (request: HanaPluginShowInputPanelRequestV2) => Promise<HanaPluginShowInputPanelResultV2>;
    /** Remove only a non-blocking panel previously shown by this App under the same id. */
    readonly dismiss: (request: HanaPluginDismissInputPanelRequestV2) => Promise<void>;
    /** Update only this App's registered panel allocation without replacing its document. */
    readonly updatePanel: (request: HanaPluginUpdateInputPanelRequestV2) => Promise<HanaPluginUpdateInputPanelResultV2>;
}
export declare const HANA_PLUGIN_USER_INTERACTION_V2_MEMBERS: readonly string[];
/**
 * One button on a banner.
 *
 * Structurally identical to `server/composition/plugins/input-banners.ts`'s
 * host-side `InputBannerButton` — that table also serves the user's own
 * button-click/dismiss path, so it stays host-side and this is a mirror.
 */
export interface HanaPluginInputBannerButtonV2 {
    readonly id: string;
    readonly title: string;
    readonly action: {
        readonly kind: "notify-plugin";
    } | {
        readonly kind: "post-message";
        readonly text: string;
    };
}
/** One request to `ctx.inputBanner.set()`. */
export interface HanaPluginInputBannerSetRequestV2 {
    readonly sessionPath: string;
    readonly bannerId: string;
    readonly text: string;
    readonly buttons: readonly HanaPluginInputBannerButtonV2[];
}
/** One request to `ctx.inputBanner.dismiss()` — the banner this app itself queued, by id. */
export interface HanaPluginInputBannerDismissRequestV2 {
    readonly sessionPath: string;
    readonly bannerId: string;
}
/** `inputBanner`: post a non-blocking attention strip above a session's input box, or take one back down. */
export interface HanaPluginInputBannerV2 {
    readonly set: (request: HanaPluginInputBannerSetRequestV2) => void;
    readonly dismiss: (request: HanaPluginInputBannerDismissRequestV2) => void;
}
export declare const HANA_PLUGIN_INPUT_BANNER_V2_MEMBERS: readonly string[];
/**
 * Which scope a `ctx.config` call targets, for a field its own schema
 * declared `per-agent` or `per-session`; a global field ignores this
 * entirely.
 *
 * Structurally identical to `server/routes/settings-contributions.ts`'s
 * host-side `SettingsContributionScopeOptions` — that module also serves the
 * settings window's own save path, so it stays host-side and this is a
 * mirror.
 */
export interface HanaPluginConfigScopeOptionsV2 {
    readonly agentId?: string;
    readonly sessionId?: string;
    readonly sessionPath?: string;
}
/**
 * `config`: read and write the settings group this app itself declared in
 * its manifest's `contributes.settings`. `get`/`getAll` return the real
 * stored value with schema defaults filled in, never masked. An app that
 * declared no `contributes.settings` gets `undefined`/`{}` from
 * `get`/`getAll` and a thrown `SettingsContributionValidationError` from
 * `set`/`setMany` naming every key as unknown.
 */
export interface HanaPluginConfigV2 {
    readonly get: (key: string, opts?: HanaPluginConfigScopeOptionsV2) => unknown;
    readonly getAll: (opts?: HanaPluginConfigScopeOptionsV2) => Record<string, unknown>;
    readonly getSchema: () => Record<string, unknown> | null;
    readonly getState: (options?: AppConfigStateOptionsV2) => AppConfigStateV2;
    readonly forkSession: (input: AppConfigForkSessionInputV2) => {
        copied: boolean;
    };
    readonly discardSession: (input: AppConfigDiscardSessionInputV2) => {
        discarded: boolean;
    };
    readonly set: (key: string, value: unknown, opts?: HanaPluginConfigScopeOptionsV2) => void;
    readonly setMany: (patch: Record<string, unknown>, opts?: HanaPluginConfigScopeOptionsV2) => void;
}
export declare const HANA_PLUGIN_CONFIG_V2_MEMBERS: readonly string[];
/** What a v2 app's slash-command handler receives. */
export interface HanaPluginCommandInvocationV2 {
    readonly commandName: string;
    readonly rawText: string;
    readonly args: string;
    readonly sessionPath: string | null;
    readonly reply: (text: string) => Promise<void> | void;
}
/**
 * One slash command a v2 app hands to `ctx.commands.register`.
 *
 * There is no `permission` field — every command registered through this
 * door carries a fixed identity (`source: "app"`) and a fixed permission
 * (`"owner"`); see `APPS.md`'s "命令" section.
 */
export interface HanaPluginCommandRegistrationV2 {
    readonly name: string;
    /** Alternate slash words; all must be available or registration rolls back. */
    readonly aliases?: readonly string[];
    readonly description?: string;
    readonly usage?: string;
    readonly handler: (invocation: HanaPluginCommandInvocationV2) => Promise<string | void> | string | void;
}
/** One command `ctx.commands.listOwn()` hands back — display text only, never the `handler`. */
export interface HanaPluginOwnCommandV2 {
    readonly name: string;
    readonly description?: string;
    readonly usage?: string;
}
/**
 * `commands`: put one `/name` command into the same registry the chat
 * dispatcher and the input box's slash menu already read, and get back the
 * way to take it off again. No `unregister(name)` and no bare `list()` — the
 * same reasoning `tools` gives for refusing both.
 */
export interface HanaPluginCommandsV2 {
    readonly register: (registration: HanaPluginCommandRegistrationV2) => () => void;
    readonly listOwn: () => readonly HanaPluginOwnCommandV2[];
    /** Safe directory projection; `scope: "all"` requires app/commands.read. */
    readonly list: (options?: AppCatalogScopeOptionsV2) => Promise<readonly AppCommandCatalogEntryV2[]>;
}
export declare const HANA_PLUGIN_COMMANDS_V2_MEMBERS: readonly string[];
/** The `{sessionId, sessionPath}` identity pair every `ctx.hooks` invocation carries. */
export interface HanaPluginHookSessionV2 {
    readonly sessionId: string | null;
    readonly sessionPath: string | null;
}
export declare const HANA_PLUGIN_HOOK_SESSION_V2_MEMBERS: readonly string[];
/** `session/input`: the user's own input text, immediately before it becomes part of a session. */
export interface HanaPluginHookSessionInputInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly text: string;
    /** Inline images, present only with the separate images capability grant. */
    readonly images?: readonly HanaPluginHookInputImageV2[];
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_SESSION_INPUT_INVOCATION_V2_MEMBERS: readonly string[];
export interface HanaPluginHookInputImageV2 {
    readonly type: "image";
    readonly data: string;
    readonly mimeType: string;
}
/**
 * Replace the user's own input text or inline images, or block before the
 * input side effect with a visible reason. Returning nothing (or throwing, or
 * an empty/non-string `text`) leaves the corresponding value alone.
 */
export interface HanaPluginHookSessionInputDecisionV2 {
    readonly text?: string;
    /** `[]` removes inline images; requires the separate images capability grant. */
    readonly images?: readonly HanaPluginHookInputImageV2[];
    readonly block?: boolean;
    readonly reason?: string;
}
/** `agent/before-start`: the turn's own prompt and system prompt, before the agent loop starts. */
export interface HanaPluginHookAgentBeforeStartInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly prompt: string;
    readonly systemPrompt: string;
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_AGENT_BEFORE_START_INVOCATION_V2_MEMBERS: readonly string[];
/**
 * A custom message a hook can inject before the agent loop starts.
 *
 * Structurally identical to `lib/session-hooks/registry.ts`'s host-side
 * `HookMessage` (itself a subset of Pi's own `CustomMessage`) — that registry
 * is not app-contract-specific, so it stays host-side and this is a mirror.
 */
export interface HanaPluginHookMessageV2 {
    customType: string;
    content: string;
    /** Whether the message is shown in the transcript. Absent means the host's default. */
    display?: boolean;
    details?: unknown;
}
/** Replace the system prompt, inject a message before the loop starts, or both. */
export interface HanaPluginHookAgentBeforeStartDecisionV2 {
    readonly systemPrompt?: string;
    readonly message?: HanaPluginHookMessageV2;
}
/** `agent/pre-step`: the messages about to be sent to the model. */
export interface HanaPluginHookAgentPreStepInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly messages: unknown[];
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_AGENT_PRE_STEP_INVOCATION_V2_MEMBERS: readonly string[];
/** Replace the messages this turn sends. Returning nothing leaves them alone; Promise results are awaited. */
export interface HanaPluginHookAgentPreStepDecisionV2 {
    readonly messages: unknown[];
}
/** `tools/pre-execute`: one tool call, before it executes. */
export interface HanaPluginHookToolsPreExecuteInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly toolName: string | undefined;
    readonly input: unknown;
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_TOOLS_PRE_EXECUTE_INVOCATION_V2_MEMBERS: readonly string[];
/** Block the call, replace its input, or both. Returning nothing leaves the tool to run as called. */
export interface HanaPluginHookToolsPreExecuteDecisionV2 {
    readonly block?: boolean;
    readonly terminate?: boolean;
    readonly reason?: string;
    readonly input?: unknown;
}
/** `tools/post-execute`: one tool's result, before the session records it. */
export interface HanaPluginHookToolsPostExecuteInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly toolName: string | undefined;
    readonly content: unknown;
    readonly details?: unknown;
    readonly isError: boolean | undefined;
    readonly usage?: unknown;
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_TOOLS_POST_EXECUTE_INVOCATION_V2_MEMBERS: readonly string[];
/** Replace a tool result's content. Returning nothing leaves it alone; Promise results are awaited. */
export interface HanaPluginHookToolsPostExecuteDecisionV2 {
    readonly content: unknown;
    readonly details?: unknown;
    readonly isError?: boolean;
    readonly usage?: unknown;
}
export interface HanaPluginHookSessionBeforeCompactInvocationV2 {
    readonly session: HanaPluginHookSessionV2;
    /** Aborts when the host cancels this compaction attempt. */
    readonly signal?: AbortSignal;
    readonly preparation?: unknown;
    readonly customInstructions?: unknown;
    readonly branchEntries?: unknown[];
}
export declare const HANA_PLUGIN_HOOK_SESSION_BEFORE_COMPACT_INVOCATION_V2_MEMBERS: readonly string[];
export type HanaPluginHookSessionBeforeCompactDecisionV2 = {
    readonly cancel: true;
} | {
    readonly compaction: unknown;
};
export interface HanaPluginHookProviderBeforeHeadersInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly session: HanaPluginHookSessionV2;
    readonly headers: Readonly<Record<string, string | undefined>>;
}
export declare const HANA_PLUGIN_HOOK_PROVIDER_BEFORE_HEADERS_INVOCATION_V2_MEMBERS: readonly string[];
export interface HanaPluginHookProviderBeforeHeadersDecisionV2 {
    readonly headers: Readonly<Record<string, string | null>>;
}
/** `provider/before-request`: the fully-serialized request the host is about to send the model provider. */
export interface HanaPluginHookProviderBeforeRequestInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly payload: unknown;
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_PROVIDER_BEFORE_REQUEST_INVOCATION_V2_MEMBERS: readonly string[];
/** Replace the outgoing provider request payload. Returning nothing leaves it alone; Promise results are awaited. */
export interface HanaPluginHookProviderBeforeRequestDecisionV2 {
    readonly payload: unknown;
}
/**
 * The one field this vocabulary reads off an assistant message for
 * `messages/post-assistant` — everything else travels opaque.
 *
 * Structurally identical to `lib/session-hooks/registry.ts`'s host-side
 * `HookRoleBearingMessage` — that registry is not app-contract-specific, so
 * it stays host-side and this is a mirror.
 */
export interface HanaPluginHookRoleBearingMessageV2 {
    readonly role: string;
    readonly [key: string]: unknown;
}
/**
 * `messages/post-assistant`: the assistant's own message, as it finalizes.
 * Dispatched for an assistant message alone.
 */
export interface HanaPluginHookMessagesPostAssistantInvocationV2 {
    /** Aborts when this callback is cancelled, revoked, disposed or times out. */
    readonly signal?: AbortSignal;
    readonly message: HanaPluginHookRoleBearingMessageV2;
    readonly session: HanaPluginHookSessionV2;
}
export declare const HANA_PLUGIN_HOOK_MESSAGES_POST_ASSISTANT_INVOCATION_V2_MEMBERS: readonly string[];
/**
 * Replace the finalized assistant message. Returning nothing (or throwing, or
 * a rejected promise) leaves it alone. A replacement that does not keep the original
 * message's role is discarded by the host.
 */
export interface HanaPluginHookMessagesPostAssistantDecisionV2 {
    readonly message?: HanaPluginHookRoleBearingMessageV2;
}
export type HanaPluginHookMessagesPostMessageInvocationV2 = HanaPluginHookMessagesPostAssistantInvocationV2;
export type HanaPluginHookMessagesPostMessageDecisionV2 = HanaPluginHookMessagesPostAssistantDecisionV2;
export interface HanaPluginHookEventBaseV2 {
    readonly session: HanaPluginHookSessionV2;
}
export interface HanaPluginHookEventMapV2 {
    "agent/session-start": HanaPluginHookEventBaseV2 & {
        readonly reason?: string;
        readonly previousSessionFile?: string;
    };
    "session.shutdown": HanaPluginHookEventBaseV2 & {
        readonly reason?: string;
        readonly targetSessionFile?: string;
    };
    "agent/settled": HanaPluginHookEventBaseV2;
    "session/compacted": HanaPluginHookEventBaseV2 & {
        readonly compactionEntry?: unknown;
        readonly fromExtension?: boolean;
        readonly reason?: string;
        readonly willRetry?: boolean;
    };
    "session/compact-failed": HanaPluginHookEventBaseV2 & {
        readonly reason?: string;
        readonly errorMessage?: string;
        readonly aborted?: boolean;
        readonly willRetry?: boolean;
        readonly fromExtension?: boolean;
    };
    /** Metadata only. Response headers may contain provider authentication material. */
    "provider/after-response": HanaPluginHookEventBaseV2 & {
        readonly status?: number;
        readonly headers: Readonly<Record<string, string>>;
    };
}
export type HanaPluginHookEventInvocationV2 = HanaPluginHookEventMapV2[AppHookEvent];
/** Which projected invocation and decision shape each App-open hook word carries. */
export interface HanaPluginHookDecisionMapV2 {
    "session/input": {
        invocation: HanaPluginHookSessionInputInvocationV2;
        decision: HanaPluginHookSessionInputDecisionV2 | undefined;
    };
    "agent/before-start": {
        invocation: HanaPluginHookAgentBeforeStartInvocationV2;
        decision: HanaPluginHookAgentBeforeStartDecisionV2 | undefined;
    };
    "agent/pre-step": {
        invocation: HanaPluginHookAgentPreStepInvocationV2;
        decision: HanaPluginHookAgentPreStepDecisionV2 | undefined;
    };
    "tools/pre-execute": {
        invocation: HanaPluginHookToolsPreExecuteInvocationV2;
        decision: HanaPluginHookToolsPreExecuteDecisionV2 | undefined;
    };
    "tools/post-execute": {
        invocation: HanaPluginHookToolsPostExecuteInvocationV2;
        decision: HanaPluginHookToolsPostExecuteDecisionV2 | undefined;
    };
    "session.beforeCompact": {
        invocation: HanaPluginHookSessionBeforeCompactInvocationV2;
        decision: HanaPluginHookSessionBeforeCompactDecisionV2 | undefined;
    };
    "provider/before-request": {
        invocation: HanaPluginHookProviderBeforeRequestInvocationV2;
        decision: HanaPluginHookProviderBeforeRequestDecisionV2 | undefined;
    };
    "messages/post-assistant": {
        invocation: HanaPluginHookMessagesPostAssistantInvocationV2;
        decision: HanaPluginHookMessagesPostAssistantDecisionV2 | undefined;
    };
    "messages/post-message": {
        invocation: HanaPluginHookMessagesPostMessageInvocationV2;
        decision: HanaPluginHookMessagesPostMessageDecisionV2 | undefined;
    };
    "provider/before-headers": {
        invocation: HanaPluginHookProviderBeforeHeadersInvocationV2;
        decision: HanaPluginHookProviderBeforeHeadersDecisionV2 | undefined;
    };
}
/**
 * The `HanaPluginHookDecisionMapV2` words a v2 app may register an adjudicator
 * for — re-exported here from `../app-hook-capabilities.ts` (the
 * host's own gate reads that same union) so this module does not need a
 * second, independently-maintained copy.
 */
export type { AppHookEvent, AppHookWord };
/** An App adjudicator for one of the published hook words. */
export type HanaPluginHookAdjudicatorV2<W extends AppHookWord = AppHookWord> = (invocation: HanaPluginHookDecisionMapV2[W]["invocation"]) => HanaPluginHookDecisionMapV2[W]["decision"] | Promise<HanaPluginHookDecisionMapV2[W]["decision"]>;
export type HanaPluginHookListenerV2<E extends AppHookEvent = AppHookEvent> = (invocation: HanaPluginHookEventMapV2[E]) => void | Promise<void>;
/**
 * `hooks`: join one of the host's own session-hook decisions — rewriting the
 * user's own input text, replacing the opening system prompt or injecting a
 * message, rewriting the messages a turn sends, blocking or rewriting a tool
 * call, rewriting a tool's result, rewriting the request the host sends the
 * model provider, or replacing an assistant message as it finalizes.
 * Registering always succeeds; whether this app's adjudicator is ever
 * actually consulted is a separate question the host's permission ledger
 * answers fresh on every dispatch — see `APPS.md`'s "钩子" section.
 */
export interface HanaPluginHooksV2 {
    readonly onDecision: <W extends AppHookWord>(word: W, adjudicator: HanaPluginHookAdjudicatorV2<W>) => () => void;
    readonly on: <E extends AppHookEvent>(event: E, listener: HanaPluginHookListenerV2<E>) => () => void;
}
export declare const HANA_PLUGIN_HOOKS_V2_MEMBERS: readonly string[];
/**
 * Extra knobs `network.fetch` accepts on top of a normal `RequestInit`.
 * `timeoutMs`, `maxResponseBytes` and `cacheTtlMs` are host-side bounds,
 * stripped before the underlying fetch runs.
 */
export interface HanaPluginNetworkFetchInitV2 extends RequestInit {
    timeoutMs?: number;
    maxResponseBytes?: number;
    cacheTtlMs?: number;
}
/**
 * The checked outbound HTTP door a v2 app is handed. Always present on the
 * face; `fetch` throws a structured "not declared" error until the app's
 * manifest carries a top-level `network` block (`AppManifestV2.network` in
 * `./manifest.ts`).
 */
export interface HanaPluginNetworkV2 {
    fetch(input: RequestInfo | URL, init?: HanaPluginNetworkFetchInitV2): Promise<Response>;
}
export declare const HANA_PLUGIN_NETWORK_V2_MEMBERS: readonly string[];
/**
 * The one programmatic backend-route registration an app may own.
 *
 * `register`'s callback receives the host-created app instance — a `Hono`
 * app in the host's own implementation, per `APPS.md`'s routes example
 * (`import { Hono } from "hono"`). This package does not bundle `hono`'s own
 * types (nothing outside `shared/` may be imported here), so the callback
 * parameter is typed `unknown`; an author annotates it with `Hono` from
 * their own `hono` dependency, or casts. A registrar may return a Promise;
 * the host awaits it before publishing the route app. The returned disposer
 * withdraws the whole programmatic route app; a second `register()` call is
 * refused.
 */
export interface HanaPluginRoutesV2 {
    readonly register: (registrar: (app: unknown) => unknown) => () => void;
}
export declare const HANA_PLUGIN_ROUTES_V2_MEMBERS: readonly string[];
/**
 * One scoped key-value bucket `ctx.storage` hands out — either the shared
 * `global` bucket or one private `agent(agentId)` bucket. Values must be
 * JSON-serializable. There is no per-key limit; the whole bucket's
 * serialized size is what is capped — see `APPS.md`'s "存储" section for the
 * two numbers (a 512KB soft warning, a 16MB hard `APP_STORAGE_QUOTA_EXCEEDED`
 * refusal) and why `ctx.dataDir` is the answer once an app's data outgrows
 * them. `onChanged` fires for a write made through any door reaching this
 * scope — this app's own process, an isolated copy of it, or one of its own
 * cards — including one this same subscriber made itself.
 */
export interface HanaPluginStorageScopeV2 {
    readonly get: (key: string, fallback?: unknown) => unknown;
    readonly getAll: () => Record<string, unknown>;
    readonly set: (key: string, value: unknown) => void;
    readonly delete: (key: string) => void;
    readonly keys: () => readonly string[];
    readonly onChanged: (callback: (keys: readonly string[]) => void) => () => void;
}
export declare const HANA_PLUGIN_STORAGE_SCOPE_V2_MEMBERS: readonly string[];
/**
 * `storage`: a key-value store scoped to this app, modeled on VS Code's
 * extension storage split between `globalState` and `workspaceState`.
 * `global` is shared across every agent this app ever runs under;
 * `agent(agentId)` is private to one agent. Calling `agent()` with no
 * argument resolves the agent the current tool call is running for — see
 * `makeHanaPluginContextV2`'s own header for how that default reaches across
 * an isolated app's process boundary, and for what happens (an actionable
 * throw) when there is no such call to resolve it from.
 */
export interface HanaPluginStorageV2 {
    readonly global: HanaPluginStorageScopeV2;
    readonly agent: (agentId?: string) => HanaPluginStorageScopeV2;
}
export declare const HANA_PLUGIN_STORAGE_V2_MEMBERS: readonly string[];
/** `appEvents`: emit onto the same local-desktop `app_event` channel a v1 plugin already has. */
export interface HanaPluginAppEventsV2 {
    emit(type: string, payload?: Record<string, unknown>): void;
}
export declare const HANA_PLUGIN_APP_EVENTS_V2_MEMBERS: readonly string[];
/**
 * Non-function fields a media adapter may declare. Methods stay on the live
 * object — an isolated app sends only this descriptor across the process
 * boundary.
 */
export interface HanaPluginMediaAdapterDescriptorV2 {
    readonly id: string;
    readonly aliases?: string[];
    readonly protocolId?: string;
    readonly protocolIds?: string[];
    readonly name?: string;
    readonly displayName?: string;
    readonly types?: string[];
    readonly capabilities?: unknown;
    readonly models?: unknown;
}
export interface HanaPluginMediaAdapterV2 extends HanaPluginMediaAdapterDescriptorV2 {
    submit?(...args: unknown[]): unknown;
    query?(...args: unknown[]): unknown;
    checkAuth?(...args: unknown[]): unknown;
}
export interface HanaPluginMediaCapabilitySourceV2 {
    refresh(...args: unknown[]): unknown;
}
/** `media`: register or withdraw a media provider adapter or capability source. Needs `app/media.provide`. */
export interface HanaPluginMediaV2 extends HanaPluginMediaTasksV2 {
    registerAdapter(adapter: HanaPluginMediaAdapterV2): Promise<{
        adapterId: string;
    }>;
    unregisterAdapter(adapterId: string): Promise<void>;
    registerCapabilitySource(providerId: string, source: HanaPluginMediaCapabilitySourceV2): Promise<void>;
    unregisterCapabilitySource(providerId: string): Promise<void>;
}
export declare const HANA_PLUGIN_MEDIA_V2_MEMBERS: readonly string[];
/**
 * Where a resource operation is coming from.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourceEventSource` — that file is the shared vocabulary for both v1's
 * and v2's ResourceIO, so it stays host-side and this is a mirror.
 */
export type V2AppResourceEventSource = "agent_tool" | "model_tool" | "provider_watch" | "api" | "plugin" | "bash_reconcile" | "mount" | "session_file" | "unknown";
/**
 * Who is performing a resource operation.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourcePrincipal` — mirrored for the same reason as
 * `V2AppResourceEventSource` above.
 */
export type V2AppResourcePrincipal = {
    kind: "agent" | "plugin" | "api" | "watch" | "system" | "app";
    agentId?: string | null;
    userId?: string | null;
    studioId?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
    pluginId?: string | null;
    /** Set when `kind` is `"app"` — the v2 app's manifest id. */
    appId?: string | null;
    connectionKind?: string | null;
    credentialKind?: string | null;
    requestId?: string | null;
};
/**
 * The optional last argument most `ctx.resources.*` methods accept.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourceOperationContext` — mirrored for the same reason as
 * `V2AppResourceEventSource` above. A v2 app rarely needs to pass this at
 * all. `principal`, `source`, `surface`, `sessionId`, `sessionPath`, `emit`,
 * and `auditRead` are compatibility fields: the host stamps them for ordinary
 * resources and App input cannot use them to gain a session grant or weaken
 * audit/event attribution. `reason` and `requestId` remain diagnostics.
 */
export type V2AppResourceOperationContext = {
    source?: V2AppResourceEventSource;
    reason?: string;
    principal?: V2AppResourcePrincipal;
    sessionId?: string | null;
    sessionPath?: string | null;
    requestId?: string | null;
    emit?: boolean;
    auditRead?: boolean;
    surface?: "user_editor";
};
/**
 * One find-and-replace edit for `ctx.resources.edit()`.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourceEdit` — mirrored for the same reason as
 * `V2AppResourceEventSource` above.
 */
export type V2AppResourceEdit = {
    oldText: string;
    newText: string;
};
/**
 * Options for `ctx.resources.trash()`.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourceTrashOptions` — mirrored for the same reason as
 * `V2AppResourceEventSource` above.
 */
export type V2AppResourceTrashOptions = {
    namespace?: string;
    metadata?: Record<string, unknown>;
};
/**
 * An expected-version stamp for `ctx.resources.writeExpectedVersion()`.
 *
 * Structurally identical to `lib/resource-io/types.ts`'s host-side
 * `ResourceVersion` — mirrored for the same reason as
 * `V2AppResourceEventSource` above.
 */
export type V2AppResourceVersion = {
    mtimeMs?: number;
    size?: number | null;
    sha256?: string;
    etag?: string;
    sequence?: number;
};
/** What `ctx.resources.watch()`/`subscribe()` hand back. */
export type V2AppResourceWatchHandle = {
    subscriptionId: string;
    resourceKeys: string[];
    unsubscribe(): boolean;
    close(): boolean;
};
/** Copy an App data file or authorized resource into a token-bound or explicitly selected session. */
export type V2AppStageFileInput = {
    path?: string;
    resource?: unknown;
    sessionId?: string;
    scope?: "own" | "all";
    name?: string;
    mime?: string;
    deliverAs?: "attachment" | "media";
};
/** Receipt from `resources.stage` or `resources.register`; the returned ref can be read through this same ResourceIO. */
export type V2AppFileDeliveryResult = {
    file: Record<string, unknown>;
    mediaItem: unknown;
    resource: {
        kind: "session-file";
        fileId: string;
        sessionId: string;
    };
};
/**
 * `resources`: the seventeen ResourceIO methods plus `stage` and `register`, sandboxed to
 * this app's own `dataDir` plus whatever the permission ledger has granted.
 * Every `ref`/`from`/`to` argument is opaque at this type — the host checks
 * it is one of the open ref kinds (`local-file` / `session-file` / `resource` / `url` / `mount` /
 * `skill` / `recipe` / `agent` / `card-document`) at the call boundary. See `APPS.md`'s "资源" section
 * for the full contract.
 */
export type V2AppResources = {
    stat(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    read(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    list(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    search(ref: unknown, options?: Record<string, unknown>, context?: V2AppResourceOperationContext): Promise<unknown>;
    materialize(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    write(ref: unknown, content: string | Buffer | Uint8Array | ArrayBuffer, options?: V2AppResourceOperationContext): Promise<unknown>;
    writeExpectedVersion(ref: unknown, content: string | Buffer | Uint8Array | ArrayBuffer, expectedVersion: V2AppResourceVersion | null | undefined, options?: V2AppResourceOperationContext): Promise<unknown>;
    edit(ref: unknown, edits: V2AppResourceEdit[], options?: V2AppResourceOperationContext): Promise<unknown>;
    mkdir(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    delete(ref: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    copy(from: unknown, to: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    rename(from: unknown, to: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    move(from: unknown, to: unknown, options?: V2AppResourceOperationContext): Promise<unknown>;
    trash(ref: unknown, trashOptions?: V2AppResourceTrashOptions, options?: V2AppResourceOperationContext): Promise<unknown>;
    watch(ref: unknown, options?: V2AppResourceOperationContext): V2AppResourceWatchHandle;
    subscribe(resources: unknown[], options?: V2AppResourceOperationContext): V2AppResourceWatchHandle;
    resolveWatchTarget(ref: unknown, options?: V2AppResourceOperationContext): unknown;
    stage(input: V2AppStageFileInput): Promise<V2AppFileDeliveryResult>;
    register(input: V2AppRegisterFileInput): Promise<V2AppFileDeliveryResult>;
};
/** Register an authorized existing file; its bytes stay at the materialized source location. */
export type V2AppRegisterFileInput = {
    resource: unknown;
    sessionId?: string;
    scope?: "own" | "all";
    name?: string;
    origin?: "plugin_output" | "user_upload";
};
export declare const HANA_PLUGIN_RESOURCES_V2_MEMBERS: readonly string[];
/**
 * Narrow document IO for one host-bound Preview document. Unlike
 * `ctx.resources`, this surface never accepts a resource reference from the
 * app: the host resolves it from the opaque access context.
 */
export interface HanaPluginDocumentsV2 {
    readonly read: (access: V2AppDocumentAccessContext) => Promise<unknown>;
    readonly readRelated: (access: V2AppDocumentAccessContext, relativeRef: string) => Promise<unknown>;
    readonly writeExpectedVersion: (access: V2AppDocumentAccessContext, content: string | Buffer | Uint8Array | ArrayBuffer, expectedVersion: V2AppResourceVersion) => Promise<PreviewDocumentWriteResult>;
    readonly requestView: (access: V2AppDocumentAccessContext, input: {
        method: string;
        payload?: unknown;
        expectedRevision: number;
    }) => Promise<AppViewResult>;
}
export declare const HANA_PLUGIN_DOCUMENTS_V2_MEMBERS: readonly string[];
/**
 * Everything a v2 app can reach through `apply(ctx)`.
 *
 * `tests/plugin-context-v2-freeze.test.ts` (host-side) enumerates all
 * all surfaces exhaustively against `HANA_PLUGIN_CONTEXT_V2_MEMBERS` so
 * that adding or removing a member turns a test red rather than shipping
 * quietly — that receipt, and the ctx's own freezing, stay host-side; this
 * file only owns the shape.
 */
export interface HanaPluginContextV2 {
    readonly process: AppProcessV2;
    readonly mcp: HanaPluginMcpV2;
    readonly tasks: AppTasksV2;
    readonly models: HanaPluginModelsV2;
    readonly runtime: HanaPluginManagedRuntimeV2;
    readonly appEvents: HanaPluginAppEventsV2;
    readonly tools: HanaPluginToolsV2;
    readonly logger: HanaPluginLoggerV2;
    readonly bus: HanaPluginBusV2;
    readonly userInteraction: HanaPluginUserInteractionV2;
    readonly inputBanner: HanaPluginInputBannerV2;
    readonly inputStatus: HanaPluginInputStatusV2;
    readonly config: HanaPluginConfigV2;
    readonly commands: HanaPluginCommandsV2;
    readonly hooks: HanaPluginHooksV2;
    /** Read the App's declared startup arguments for this server process. */
    readonly launchArgs: HanaPluginLaunchArgsV2;
    readonly shortcuts: HanaPluginShortcutsV2;
    readonly messageRenderers: HanaPluginMessageRenderersV2;
    readonly media: HanaPluginMediaV2;
    readonly network: HanaPluginNetworkV2;
    readonly routes: HanaPluginRoutesV2;
    readonly dataDir: string;
    readonly resources: V2AppResources;
    readonly documents: HanaPluginDocumentsV2;
    readonly storage: HanaPluginStorageV2;
    /** Registers this App's native model provider implementation. */
    readonly providers: HanaAppProvidersV2;
    readonly windows: AppWindows;
    readonly instances: AppInstances;
    readonly environments: AppEnvironments;
    readonly surfaces: AppSurfaces;
    /** Shows a grant-controlled notification through the connected local desktop. */
    readonly notifications: AppNotifications;
    /** Producer-selected in-memory snapshots shared with authorized Apps in this Hana instance. */
    readonly publicData: AppPublicDataV2;
}
/** The members of `HanaPluginContextV2`, alphabetical. */
export declare const HANA_PLUGIN_CONTEXT_V2_MEMBERS: readonly string[];
//# sourceMappingURL=context.d.ts.map