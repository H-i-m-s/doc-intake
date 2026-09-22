/**
 * app-entity-capabilities.ts — generated from shared/app-entity-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { APP_SESSIONS_SEARCH_CAPABILITY } from "./app-contract/session-search.js";
/** Standing grants for an App to cross its own Agent/session ownership boundary. */
export const APP_AGENTS_READ_CAPABILITY = "app/agents.read";
export const APP_AGENTS_MANAGE_CAPABILITY = "app/agents.manage";
export const APP_SESSIONS_READ_CAPABILITY = "app/sessions.read";
export const APP_SESSIONS_MANAGE_CAPABILITY = "app/sessions.manage";
export { APP_SESSIONS_SEARCH_CAPABILITY };
export const APP_ENTITY_CAPABILITY_WORDS = Object.freeze([
    APP_AGENTS_READ_CAPABILITY,
    APP_AGENTS_MANAGE_CAPABILITY,
    APP_SESSIONS_READ_CAPABILITY,
    APP_SESSIONS_MANAGE_CAPABILITY,
    APP_SESSIONS_SEARCH_CAPABILITY,
]);
/** App-facing permission projection for existing bus verbs with App ownership scopes. */
export const APP_ENTITY_CAPABILITY_BY_BUS_VERB = Object.freeze({
    "agent:list": APP_AGENTS_READ_CAPABILITY,
    "agent:profile": APP_AGENTS_READ_CAPABILITY,
    "agent:config": APP_AGENTS_READ_CAPABILITY,
    "agent:update": APP_AGENTS_MANAGE_CAPABILITY,
    "agent:update-config": APP_AGENTS_MANAGE_CAPABILITY,
    "agent:retire": APP_AGENTS_MANAGE_CAPABILITY,
    "agent:purge": APP_AGENTS_MANAGE_CAPABILITY,
    "session:get": APP_SESSIONS_READ_CAPABILITY,
    "session:history": APP_SESSIONS_READ_CAPABILITY,
    "session:tools": APP_SESSIONS_READ_CAPABILITY,
    "session:tool-selection": APP_SESSIONS_READ_CAPABILITY,
    "session:get-entry-label": APP_SESSIONS_READ_CAPABILITY,
    "session:list": APP_SESSIONS_READ_CAPABILITY,
    "session:search": APP_SESSIONS_SEARCH_CAPABILITY,
    "session:context": APP_SESSIONS_READ_CAPABILITY,
    "session:entries": APP_SESSIONS_READ_CAPABILITY,
    "session:update": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:send": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:abort": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:send-custom": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:append-entry": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:set-entry-label": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:switch-model": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:set-active-tools": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:archive": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:restore": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:delete": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:fork": APP_SESSIONS_MANAGE_CAPABILITY,
    "session:compact": APP_SESSIONS_MANAGE_CAPABILITY,
});
export function isAppEntityBusVerb(value) {
    return typeof value === "string" && Object.hasOwn(APP_ENTITY_CAPABILITY_BY_BUS_VERB, value);
}
export function appEntityCapabilityForBusVerb(verb) {
    return APP_ENTITY_CAPABILITY_BY_BUS_VERB[verb];
}
//# sourceMappingURL=app-entity-capabilities.js.map