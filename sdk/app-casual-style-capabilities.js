/**
 * app-casual-style-capabilities.ts — generated from shared/app-casual-style-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/app-casual-style-capabilities.ts — the ledger word for a v2 App's casual-chat style packs
 * (`contributes.stylePacks[]`).
 *
 * `app/casual.style` lets the App's packs change how the agent speaks in casual chat (rules, length and
 * pacing parameters, sticker policy and stickers, bubble appearance). It does not let the App post or read
 * casual messages; those are separate, later words. The host registers an App's packs only while this word
 * is granted, and withdraws them when it is revoked or the App is disabled or removed.
 */
export const APP_CASUAL_STYLE_CAPABILITY = "app/casual.style";
//# sourceMappingURL=app-casual-style-capabilities.js.map