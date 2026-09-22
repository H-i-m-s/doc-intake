/**
 * app-entity-capabilities.ts — generated from shared/app-entity-capabilities.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { APP_SESSIONS_SEARCH_CAPABILITY } from "./app-contract/session-search.js";
/** Standing grants for an App to cross its own Agent/session ownership boundary. */
export declare const APP_AGENTS_READ_CAPABILITY = "app/agents.read";
export declare const APP_AGENTS_MANAGE_CAPABILITY = "app/agents.manage";
export declare const APP_SESSIONS_READ_CAPABILITY = "app/sessions.read";
export declare const APP_SESSIONS_MANAGE_CAPABILITY = "app/sessions.manage";
export { APP_SESSIONS_SEARCH_CAPABILITY };
export declare const APP_ENTITY_CAPABILITY_WORDS: readonly ["app/agents.read", "app/agents.manage", "app/sessions.read", "app/sessions.manage", "app/sessions.search"];
export type AppEntityCapability = (typeof APP_ENTITY_CAPABILITY_WORDS)[number];
/** App-facing permission projection for existing bus verbs with App ownership scopes. */
export declare const APP_ENTITY_CAPABILITY_BY_BUS_VERB: Readonly<{
    readonly "agent:list": "app/agents.read";
    readonly "agent:profile": "app/agents.read";
    readonly "agent:config": "app/agents.read";
    readonly "agent:update": "app/agents.manage";
    readonly "agent:update-config": "app/agents.manage";
    readonly "agent:retire": "app/agents.manage";
    readonly "agent:purge": "app/agents.manage";
    readonly "session:get": "app/sessions.read";
    readonly "session:history": "app/sessions.read";
    readonly "session:tools": "app/sessions.read";
    readonly "session:tool-selection": "app/sessions.read";
    readonly "session:get-entry-label": "app/sessions.read";
    readonly "session:list": "app/sessions.read";
    readonly "session:search": "app/sessions.search";
    readonly "session:context": "app/sessions.read";
    readonly "session:entries": "app/sessions.read";
    readonly "session:update": "app/sessions.manage";
    readonly "session:send": "app/sessions.manage";
    readonly "session:abort": "app/sessions.manage";
    readonly "session:send-custom": "app/sessions.manage";
    readonly "session:append-entry": "app/sessions.manage";
    readonly "session:set-entry-label": "app/sessions.manage";
    readonly "session:switch-model": "app/sessions.manage";
    readonly "session:set-active-tools": "app/sessions.manage";
    readonly "session:archive": "app/sessions.manage";
    readonly "session:restore": "app/sessions.manage";
    readonly "session:delete": "app/sessions.manage";
    readonly "session:fork": "app/sessions.manage";
    readonly "session:compact": "app/sessions.manage";
}>;
export type AppEntityBusVerb = keyof typeof APP_ENTITY_CAPABILITY_BY_BUS_VERB;
export declare function isAppEntityBusVerb(value: unknown): value is AppEntityBusVerb;
export declare function appEntityCapabilityForBusVerb(verb: AppEntityBusVerb): AppEntityCapability;
//# sourceMappingURL=app-entity-capabilities.d.ts.map