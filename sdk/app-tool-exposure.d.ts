/**
 * app-tool-exposure.ts — generated from shared/app-tool-exposure.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-tool-exposure.ts — the shared vocabulary for one question: may a
 * v2 app's registered tools be handed to the model so it can call them on its
 * own, the same way the model already calls a built-in or MCP tool?
 *
 * Two words, two different consumers
 * -----------------------------------
 * `APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY` is a permission-ledger capability
 * word (`server/composition/plugins/permission-ledger.ts`'s
 * `"<domain>/<action>"` grammar) naming the decision itself — "was this app
 * granted the right to put its tools in front of the model" — as a standing,
 * revocable per-app record. The default with no record is deny, on the
 * ledger's own terms: nothing here changes that, it only gives the decision a
 * name a grant/query/revoke call can share.
 *
 * `APP_TOOL_SUPPLIER` is a different kind of word: a marker for whichever
 * table tracks which tool came from which v2 app, so that table's rows can
 * say "this one's supplier is an app" the same way an MCP-sourced tool
 * already says its own supplier there. It answers "where did this tool come
 * from", not "is it allowed to run" — the ledger word above answers that
 * half.
 *
 * Why this pair lives in `shared/` rather than next to either consumer: the
 * capability word is read by the HTTP route layer that writes the grant and,
 * later, by the model-facing tool loop that decides whether to include a
 * given app's tools — two different layers of this codebase reading the same
 * literal, which is exactly the case `shared/` exists for. Keeping the string
 * in one place means a caller on either side imports it instead of retyping
 * it, so the two can never quietly drift apart.
 */
/**
 * The permission-ledger capability naming "may this v2 app's tools be
 * exposed to the model's own tool-call loop". Subject is `{ domain: "app",
 * id: <appId> }`. `core/app-tools.ts` reads it twice: at assembly
 * (`appToolsFromRegistry`) against the persisted always-layer, to decide
 * whether the tool is offered this session at all; and again inside each
 * produced tool's `execute`, with the calling session id, so a revoke
 * takes effect on the next call instead of waiting for the next rebuild.
 * The grant route in `server/routes/permissions.ts` is the writer both
 * reads share.
 */
export declare const APP_TOOLS_EXPOSE_TO_MODEL_CAPABILITY = "app/tools.expose-to-model";
/**
 * The supplier marker for a tool registration that came from a v2 app,
 * meant for whichever table tracks a registered tool's origin (that table's
 * own metadata bag, on `lib/tool-registry.ts`'s terms — see that file's
 * header on why a registrant's own notes belong there and not in the
 * registry's typed surface). Not yet written anywhere — this constant exists
 * so the value both a future writer and a future reader use is the same
 * literal from day one.
 */
export declare const APP_TOOL_SUPPLIER = "app";
//# sourceMappingURL=app-tool-exposure.d.ts.map