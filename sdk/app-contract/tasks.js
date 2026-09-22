/**
 * app-contract/tasks.ts — generated from shared/app-contract/tasks.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Durable tasks that a v2 App owns on the Hana host.
 *
 * `callToken` is accepted by session-scoped create and schedule. It is a
 * short-lived invocation proof, never a task identifier or persisted value.
 * Once a task exists, ownership comes from the host-generated task id and its
 * persisted `appId` metadata.
 */
export const APP_TASKS_CAPABILITY = "app/tasks.manage";
export const APP_TASKS_READ_ALL_CAPABILITY = "app/tasks.read-all";
export const APP_TASKS_MANAGE_ALL_CAPABILITY = "app/tasks.manage-all";
export const APP_TASKS_CAPABILITY_WORDS = Object.freeze([
    APP_TASKS_CAPABILITY,
    APP_TASKS_READ_ALL_CAPABILITY,
    APP_TASKS_MANAGE_ALL_CAPABILITY,
]);
//# sourceMappingURL=tasks.js.map