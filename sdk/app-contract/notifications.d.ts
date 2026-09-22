/**
 * app-contract/notifications.ts — generated from shared/app-contract/notifications.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Capability required for an App to show a local system notification. */
export declare const APP_NOTIFICATIONS_SHOW_CAPABILITY: "app/notifications.show";
export declare const APP_NOTIFICATIONS_CAPABILITY_WORDS: readonly ["app/notifications.show"];
export type AppNotificationsCapability = (typeof APP_NOTIFICATIONS_CAPABILITY_WORDS)[number];
/** The bounded text an App submits for one immediate local notification. */
export interface AppNotificationInput {
    readonly title: string;
    readonly body: string;
}
export interface AppNotificationResult {
    readonly shown: true;
}
/** Shows one immediate notification through the connected local desktop. */
export interface AppNotifications {
    show(input: AppNotificationInput): Promise<AppNotificationResult>;
}
//# sourceMappingURL=notifications.d.ts.map