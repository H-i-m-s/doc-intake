/**
 * app-resource-capabilities.ts — generated from shared/app-resource-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Ledger words for a v2 app's ResourceIO door. Paths inside that app's
 * dataDir skip the ledger; everything else needs the matching word.
 */
export declare const APP_RESOURCES_READ_CAPABILITY = "app/resources.read";
export declare const APP_RESOURCES_WRITE_CAPABILITY = "app/resources.write";
export declare const APP_RESOURCE_CAPABILITY_WORDS: readonly ["app/resources.read", "app/resources.write"];
/** The literal-union type of every word `APP_RESOURCE_CAPABILITY_WORDS` carries. */
export type AppResourceCapability = (typeof APP_RESOURCE_CAPABILITY_WORDS)[number];
//# sourceMappingURL=app-resource-capabilities.d.ts.map