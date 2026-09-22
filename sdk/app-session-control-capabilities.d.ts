/**
 * app-session-control-capabilities.ts — generated from shared/app-session-control-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-session-control-capabilities.ts — the shared vocabulary for two
 * questions a v2 app may ask about a session it owns. One group: may it
 * change *how* that session runs afterwards — its model, its thinking
 * level, its permission mode — rather than merely its own organizational
 * metadata (title, pin state, project assignment)? The other: may it
 * *start a conversation turn* in that session, sending content to the
 * model and spending the user's quota?
 *
 * Two groups, four words, one array
 * ---------------------------------
 * A session's model, its thinking level, and its permission mode are three
 * independently meaningful interventions — swapping the model changes what
 * the agent is; the thinking level changes how hard it reasons before
 * answering; the permission mode changes what it may do to the user's
 * machine without asking first. Starting a turn is a fourth, different
 * intervention: it does not change how the session runs afterwards, it
 * spends the user's quota right now. A user who is comfortable letting an
 * app pick a cheaper model is not thereby comfortable with that same app
 * speaking into a turn, so each word is its own standing, revocable
 * permission-ledger record.
 *
 * They still share this file and `APP_SESSION_CONTROL_CAPABILITY_WORDS`
 * because the HTTP grant whitelist (`APP_GRANTABLE_CAPABILITIES`) and the
 * settings panel both consume that one array; a second parallel list would
 * have to be kept in lockstep or grants would silently fail to write.
 *
 * `app/session.switch-model` and `app/session.thinking-level` gate
 * `hub/index.ts`'s bus doors that choose how a session runs —
 * `session:switch-model`, `session:update`'s own `thinkingLevel` field, and
 * the same three fields on `session:create` (picking a model / thinking
 * level / permission mode at create time is the same intervention as
 * changing them afterwards). `app/session.permission-mode` gates
 * `session:update`'s and `session:create`'s `permissionMode` field the same
 * way. `app/session.start-turn` gates `session:send` and any
 * `session:send-custom` whose message will enter the model — including a
 * custom message delivered while the session is already streaming, because
 * the host then queues it as follow-up for the turn already running and
 * ignores `triggerTurn: false`. An idle `session:send-custom` with
 * `triggerTurn` explicitly `false`, and `session:append-entry`, do not
 * consult this word. All four are v2-only: a v1 plugin caller and the
 * host's own internal calls are not routed through `v2AppCallerId` at all,
 * so none of this vocabulary is ever consulted for them — see
 * `hub/index.ts`'s own `assertAppSessionControlCapability` and the doc
 * comments on the gated verbs for the exact caller-generation split.
 *
 * Naming
 * ------
 * `app/session.<action>` continues the domain this codebase already uses for
 * a v2 app's other session-shaped capabilities —
 * `server/routes/plugins-v2-input-banners.ts`'s `app/session.post-message`
 * and `server/routes/plugins-v2-ui-actions.ts`'s `app/session.read-selection`
 * — rather than inventing a fourth domain prefix next to `app/tools.*`
 * (`shared/app-tool-exposure.ts`) and `app/hooks.*`
 * (`shared/app-hook-capabilities.ts`).
 *
 * Default is deny, on the same terms as every other member of this family
 * (`shared/app-tool-exposure.ts`'s and `shared/app-hook-capabilities.ts`'s
 * own headers): absence of an `"allowed"` record — no ledger, no record, or
 * an explicit `"denied"` one — all read as "not authorized". Unlike the hook
 * words, though, an unauthorized attempt to write one of these fields is not
 * treated as silent non-participation ("no opinion", the hook table's own
 * phrase) — it is a refused write with an actionable error naming the
 * missing capability, because a field that changes how a session runs must
 * never appear to have been dropped quietly. See `hub/index.ts`'s
 * `assertAppSessionControlCapability`.
 *
 * Why this lives in `shared/`: the same three-layer reuse
 * `app-tool-exposure.ts`/`app-hook-capabilities.ts` already justify —
 * `hub/index.ts` consults these words before honoring a write,
 * `server/routes/permissions.ts`'s whitelist accepts them from the grant/
 * revoke HTTP door, and the desktop settings panel
 * (`AppToolExposurePanel.tsx`) lists them per app for the user to switch.
 */
/**
 * The session-control capabilities a v2 app may be granted, independently.
 * Two semantic groups share this union so the HTTP grant whitelist and the
 * settings panel stay one list: changing how a session runs, and starting a
 * conversation turn that spends the user's quota.
 */
export type AppSessionControlCapability = "app/session.switch-model" | "app/session.thinking-level" | "app/session.permission-mode" | "app/session.start-turn"
/** Reserved until a host control door changes a session's next-run tool set. */
 | "app/session.tools.configure";
/** Gates `session:switch-model` and `session:create`'s initial `model` for a verified v2 caller. */
export declare const APP_SESSION_SWITCH_MODEL_CAPABILITY: AppSessionControlCapability;
/** Gates `session:update`'s and `session:create`'s `thinkingLevel` field for a verified v2 caller. */
export declare const APP_SESSION_THINKING_LEVEL_CAPABILITY: AppSessionControlCapability;
/** Gates `session:update`'s and `session:create`'s `permissionMode` field for a verified v2 caller. */
export declare const APP_SESSION_PERMISSION_MODE_CAPABILITY: AppSessionControlCapability;
/** Gates `session:send` and any `session:send-custom` whose message will enter the model. */
export declare const APP_SESSION_START_TURN_CAPABILITY: AppSessionControlCapability;
/** Reserved for changing a specified session's next-run tool set; no control behavior is opened here. */
export declare const APP_SESSION_TOOLS_CONFIGURE_CAPABILITY: AppSessionControlCapability;
/**
 * All four words, in the order the settings panel and this file's own header
 * present them. The first three change how a session runs; the fourth lets
 * an app start a conversation turn. Sharing one array is what keeps
 * `APP_GRANTABLE_CAPABILITIES` and the settings panel's grant door in sync
 * without a second whitelist.
 */
export declare const APP_SESSION_CONTROL_CAPABILITY_WORDS: readonly AppSessionControlCapability[];
//# sourceMappingURL=app-session-control-capabilities.d.ts.map