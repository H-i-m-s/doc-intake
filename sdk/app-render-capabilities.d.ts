/**
 * app-render-capabilities.ts — generated from shared/app-render-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-render-capabilities.ts — the ledger word and bus verb that let
 * a v2 app ask the host to render HTML to a PDF using the host's own
 * Chromium print engine.
 *
 * Rendering HTML to PDF needs a Chromium instance; the sandboxed app process
 * has none and may not spawn one itself (that is `app/process.spawn`, a
 * different word in `shared/app-process-capabilities.ts`, and even a
 * granted app would still be spawning its own renderer rather than reusing
 * the host's). So this is a host verb: the app hands the host HTML, the host
 * renders it with the same helper `plugins/office/lib/html-to-pdf.ts` used
 * for the retired v1 tool, and stages the resulting file into the calling
 * session the same way `session:stage-file` does.
 *
 * Default is deny. Absence of an `"allowed"` record — no ledger, no record,
 * or an explicit `"denied"` one — all read as not authorized.
 *
 * Why this lives in `shared/`: the request door
 * (`server/composition/plugin-context-v2.ts`), the HTTP grant whitelist
 * (`APP_GRANTABLE_CAPABILITIES`), the bus request allowlist
 * (`shared/app-bus-contract.ts`), and the desktop settings panel all have to
 * name the same word.
 */
export type AppRenderCapability = "app/render.pdf";
/** Gates `render:html-to-pdf`. */
export declare const APP_RENDER_PDF_CAPABILITY: AppRenderCapability;
export declare const APP_RENDER_CAPABILITY_WORDS: readonly AppRenderCapability[];
/** The one host bus verb this capability gates. */
export declare const APP_RENDER_HTML_TO_PDF_BUS_VERB = "render:html-to-pdf";
export declare function isAppRenderBusVerb(type: unknown): type is string;
//# sourceMappingURL=app-render-capabilities.d.ts.map