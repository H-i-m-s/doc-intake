/**
 * app-contract/models.ts — generated from shared/app-contract/models.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Public v2 App contract for host-provided model inference.
 *
 * Apps select a model from the host's public catalog and send conversation
 * state through this contract. Provider credentials, endpoints, headers and
 * transport configuration are deliberately absent: Hana keeps those in its
 * shared model runtime.
 */
/** Grant required before an App can read the model catalog or invoke a model. */
export const APP_MODELS_CAPABILITY = "app/models.infer";
export const HANA_PLUGIN_MODELS_V2_MEMBERS = ["cancel", "list", "stream", "utility"];
//# sourceMappingURL=models.js.map