/**
 * app-hook-capabilities.ts — generated from shared/app-hook-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-hook-capabilities.ts — the shared vocabulary for one question:
 * may a v2 app's own adjudicator run for one of the host's session-hook
 * decision words (`lib/session-hooks/registry.ts`'s `SessionHookDecision`),
 * standing alongside the host's own holders in that word's waterfall?
 *
 * Decision words and observation
 * -----------------------
 * The open decision words cover turn setup, tool execution and results,
 * compaction, provider payloads and headers, completed messages, and session
 * input. Each is independently revocable. `session/input` may rewrite text,
 * replace inline images when its second image grant is present, or block with
 * a visible reason. `messages/post-assistant` remains assistant-only; the
 * separate completed-message word preserves every message's original role.
 *
 * Observation is separately default-deny because it reads lifecycle data
 * across sessions, including provider response metadata and headers. It sees
 * plain snapshots, never a response stream or a host session object.
 *
 * On the pattern this follows
 * -----------------------------
 * `APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY` in `shared/app-tool-exposure.ts` is
 * the precedent: a permission-ledger capability word
 * (`server/composition/plugins/permission-ledger.ts`'s `"<domain>/<action>"`
 * grammar) naming a standing, revocable, per-app decision, default deny. This
 * table is the same idea repeated per hook word,
 * so `server/composition/plugin-context-v2.ts`'s `ctx.hooks.onDecision` can
 * gate each word on its own switch rather than one switch covering every hook.
 *
 * Why this lives in `shared/` rather than next to either consumer: the
 * capability words are read by the HTTP route layer that writes a grant
 * (`server/routes/permissions.ts`), by the v2 plugin context that queries the
 * ledger before consulting an app's adjudicator
 * (`server/composition/plugin-context-v2.ts`), and by the desktop settings
 * panel that lists them for the user to switch
 * (`desktop/src/react/settings/overlays/AppToolExposurePanel.tsx`) — three
 * layers of this codebase reading the same literal, which is exactly the case
 * `shared/` exists for.
 */
/** The host decisions a v2 app may register an adjudicator for. */
export type AppHookWord = "agent/before-start" | "agent/pre-step" | "tools/pre-execute" | "tools/post-execute" | "provider/before-request" | "messages/post-assistant" | "session/input" | "session.beforeCompact" | "provider/before-headers" | "messages/post-message";
/**
 * Every `AppHookWord`, in the order `lib/session-hooks/registry.ts`'s
 * `SESSION_HOOK_DECISIONS` serves them.
 */
export declare const APP_HOOK_WORDS: readonly AppHookWord[];
/**
 * One permission-ledger capability per hook word. Subject is always
 * `{ domain: "app", id: <appId> }`, on `APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY`'s
 * own terms — a v2 app's standing consent is per-app, not per-hook-invocation.
 */
export declare const APP_HOOK_CAPABILITIES: Readonly<{
    readonly "agent/before-start": "app/hooks.agent-before-start";
    readonly "agent/pre-step": "app/hooks.agent-pre-step";
    readonly "tools/pre-execute": "app/hooks.tools-pre-execute";
    readonly "tools/post-execute": "app/hooks.tools-post-execute";
    readonly "provider/before-request": "app/hooks.provider-before-request";
    readonly "messages/post-assistant": "app/hooks.messages-post-assistant";
    readonly "session.beforeCompact": "app/hooks.session-before-compact";
    readonly "session/input": "app/hooks.session-input";
    readonly "provider/before-headers": "app/hooks.provider-before-headers";
    readonly "messages/post-message": "app/hooks.messages-post-message";
}>;
/** Read-only lifecycle observation is a separate, default-deny permission. */
export declare const APP_HOOK_OBSERVE_CAPABILITY = "app/hooks.observe";
/** Separate consent for exposing or replacing inline images on session/input. */
export declare const APP_HOOK_SESSION_INPUT_IMAGES_CAPABILITY = "app/hooks.session-input-images";
/** Read-only lifecycle words that have a real Pi or host dispatch point. */
export type AppHookEvent = "agent/session-start" | "session.shutdown" | "agent/settled" | "session/compacted" | "session/compact-failed" | "provider/after-response";
export declare const APP_HOOK_EVENTS: readonly AppHookEvent[];
/** Every individually grantable Hook capability, including observation and images. */
export type AppHookCapability = (typeof APP_HOOK_CAPABILITIES)[AppHookWord] | typeof APP_HOOK_OBSERVE_CAPABILITY | typeof APP_HOOK_SESSION_INPUT_IMAGES_CAPABILITY;
/** `APP_HOOK_CAPABILITIES`'s values, in `APP_HOOK_WORDS` order — the set a route's whitelist can spread in. */
export declare const APP_HOOK_CAPABILITY_WORDS: readonly AppHookCapability[];
/** Is `word` one of the App hook words this table knows, narrowing the type when it is. */
export declare function isAppHookWord(word: string): word is AppHookWord;
export declare function isAppHookEvent(word: string): word is AppHookEvent;
//# sourceMappingURL=app-hook-capabilities.d.ts.map