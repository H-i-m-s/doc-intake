export declare const APP_SESSION_POST_MESSAGE_CAPABILITY = "app/session.post-message";
export declare const APP_SESSION_READ_SELECTION_CAPABILITY = "app/session.read-selection";
export declare const APP_FIRST_USE_CAPABILITY_WORDS: readonly string[];
/**
 * Grantable HTTP words plus the two first-use words the ledger already
 * holds. Resource words ride on the grantable set.
 */
export declare const APP_INTROSPECTABLE_CAPABILITIES: readonly string[];
export type AppCapabilityStatus = "always" | "session" | "denied" | "not_asked";
export type AppCapabilityEnforcement = "hard" | "advisory";
export declare function appCapabilityEnforcement(capability: string): AppCapabilityEnforcement;
export declare function projectAppCapabilityStatus(record: {
    decision?: string;
    tier?: string;
} | null | undefined): AppCapabilityStatus;
//# sourceMappingURL=app-capability-introspection.d.ts.map