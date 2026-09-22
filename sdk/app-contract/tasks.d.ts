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
export declare const APP_TASKS_CAPABILITY: "app/tasks.manage";
export declare const APP_TASKS_READ_ALL_CAPABILITY: "app/tasks.read-all";
export declare const APP_TASKS_MANAGE_ALL_CAPABILITY: "app/tasks.manage-all";
export declare const APP_TASKS_CAPABILITY_WORDS: readonly ["app/tasks.manage", "app/tasks.read-all", "app/tasks.manage-all"];
export type AppTasksCapability = (typeof APP_TASKS_CAPABILITY_WORDS)[number];
export type AppTaskStatus = "pending" | "running" | "paused" | "blocked" | "recovering" | "completed" | "failed" | "canceled" | "aborted";
export type AppTaskApprovalOutcome = "allowed-once" | "rejected";
/** Controls when a completed task result becomes available to the source session. */
export type AppTaskDelivery = "none" | "next-step" | "next-turn";
export type AppTaskScopeV2 = "app" | "session";
export type AppTaskAccessScopeV2 = "own" | "all";
export interface AppTaskRecordV2 {
    readonly taskId: string;
    readonly type: string;
    readonly pluginId: string | null;
    readonly parentSessionId: string | null;
    readonly parentSessionPath: string | null;
    readonly status: AppTaskStatus;
    readonly progress: unknown;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly completedAt?: number;
    readonly result?: unknown;
    readonly error?: string;
    /** Normalized at creation time; older persisted tasks read as `next-turn`. */
    readonly delivery: AppTaskDelivery | null;
    readonly scope: AppTaskScopeV2 | null;
    readonly handlerKey: string | null;
    readonly retryable: boolean;
    readonly suspension: Readonly<Record<string, true>>;
    readonly metadata: Record<string, unknown>;
}
/** A just-created App task has a host-verified scope and delivery policy. */
export interface AppCreatedTaskRecordV2 extends AppTaskRecordV2 {
    readonly delivery: AppTaskDelivery;
    readonly scope: AppTaskScopeV2;
}
export interface AppTaskCreateInputV2 {
    readonly callToken?: string;
    readonly scope?: AppTaskScopeV2;
    readonly handlerKey?: string;
    readonly input?: unknown;
    readonly label: string;
    readonly externalId?: string;
    /** Defaults to `next-turn` for compatibility with tasks created by older Apps. */
    readonly delivery?: AppTaskDelivery;
    readonly metadata?: Record<string, unknown>;
}
export interface AppTaskUpdateInputV2 {
    readonly progress?: unknown;
    readonly metadata?: Record<string, unknown>;
    readonly status?: Exclude<AppTaskStatus, "completed" | "failed" | "canceled" | "aborted">;
}
export interface AppTaskAccessOptionsV2 {
    readonly scope?: AppTaskAccessScopeV2;
}
export interface AppTaskHandlerRunContextV2 {
    readonly kind: "schedule" | "retry";
    readonly input: unknown;
    readonly taskId?: string;
    readonly scheduleId?: string;
    readonly callToken?: string;
}
export interface AppTaskScheduleV2 {
    readonly scheduleId: string;
    readonly type: string;
    readonly pluginId: string | null;
    readonly handlerKey: string | null;
    readonly scope: AppTaskScopeV2 | null;
    readonly parentSessionId: string | null;
    readonly parentSessionPath: string | null;
    readonly payload: unknown;
    readonly label?: string;
    readonly intervalMs: number | null;
    readonly runAt: number | null;
    readonly enabled: boolean;
    readonly suspension: Readonly<Record<string, true>>;
    readonly nextRunAt: number | null;
    readonly lastRunAt: number | null;
    readonly lastResult?: unknown;
    readonly lastError: string | null;
    readonly runCount: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface AppTaskScheduleUpdateInputV2 {
    readonly handlerKey?: string;
    readonly payload?: unknown;
    readonly label?: string;
    readonly intervalMs?: number | null;
    readonly runAt?: number | null;
}
export interface AppTaskDeliveryStateV2 {
    readonly state: "none" | "missing" | "pending" | "resolved" | "failed" | "aborted" | "staged" | "published" | "delivered" | "suppressed";
    /** True only after the host has acknowledged actual delivery. */
    readonly delivered: boolean;
    readonly deliveryId?: string;
    readonly attemptId?: string;
}
export interface AppTaskApprovalRequestV2 {
    readonly taskId: string;
    readonly label: string;
    readonly details?: Record<string, unknown>;
    /** Zero disables automatic rejection. */
    readonly timeoutMs?: number;
}
export interface AppTaskApprovalRecordV2 extends AppTaskRecordV2 {
    readonly parentTaskId: string;
    readonly approvalId: string;
    readonly outcome?: AppTaskApprovalOutcome;
}
export interface AppTasksV2 {
    create(input: AppTaskCreateInputV2): Promise<AppCreatedTaskRecordV2>;
    get(taskId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2 | AppTaskApprovalRecordV2 | null>;
    list(options?: AppTaskAccessOptionsV2): Promise<readonly AppTaskRecordV2[]>;
    update(taskId: string, patch: AppTaskUpdateInputV2, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    /** If publishing a persisted next-step result fails, retry the identical result; terminal values cannot be replaced. */
    complete(taskId: string, result?: unknown, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    /** A failed next-step publication may be retried with the identical error, without reviving the task. */
    fail(taskId: string, error?: unknown, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    cancel(taskId: string, reason?: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    requestApproval(input: AppTaskApprovalRequestV2): Promise<AppTaskApprovalRecordV2>;
    respondApproval(input: {
        readonly approvalId: string;
        readonly outcome: AppTaskApprovalOutcome;
    }): Promise<AppTaskApprovalRecordV2>;
    /** Bounded SSE snapshots are AppTaskRecordV2 or AppTaskApprovalRecordV2 (with outcome). Reconnect with get/watch. */
    watch(taskId: string, options?: AppTaskAccessOptionsV2): Promise<Response>;
    registerHandler(handlerKey: string, handler: {
        run(context: AppTaskHandlerRunContextV2): unknown;
        abort?(taskId: string): unknown;
    }): Promise<() => void>;
    schedule(input: {
        handlerKey: string;
        scope?: AppTaskScopeV2;
        callToken?: string;
        label?: string;
        payload?: unknown;
        intervalMs?: number;
        runAt?: number;
        enabled?: boolean;
    }): Promise<AppTaskScheduleV2>;
    getSchedule(scheduleId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskScheduleV2 | null>;
    listSchedules(options?: AppTaskAccessOptionsV2): Promise<readonly AppTaskScheduleV2[]>;
    updateSchedule(scheduleId: string, patch: AppTaskScheduleUpdateInputV2, options?: AppTaskAccessOptionsV2): Promise<AppTaskScheduleV2>;
    pauseSchedule(scheduleId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskScheduleV2>;
    resumeSchedule(scheduleId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskScheduleV2>;
    unschedule(scheduleId: string, options?: AppTaskAccessOptionsV2): Promise<{
        ok: true;
    }>;
    retry(taskId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    abort(taskId: string, reason?: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskRecordV2>;
    recycle(taskId: string, options?: AppTaskAccessOptionsV2): Promise<{
        ok: true;
    }>;
    getDelivery(taskId: string, options?: AppTaskAccessOptionsV2): Promise<AppTaskDeliveryStateV2>;
}
//# sourceMappingURL=tasks.d.ts.map