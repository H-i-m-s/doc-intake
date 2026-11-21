/**
 * surface-activity.ts — generated from shared/surface-activity.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/surface-activity.ts — the one vocabulary for "something on this surface
 * wants attention" (a session that is running, or has output nobody has looked
 * at yet). Pages, App chrome and session projections all speak these two words
 * so a status dot means the same thing wherever it is drawn.
 *
 * Priority is fixed: `running` outranks `unread`. Callers merge several sources
 * with `mergeSurfaceActivity`, which is order-independent.
 */
export type SurfaceActivity = "running" | "unread";
export declare function isSurfaceActivity(value: unknown): value is SurfaceActivity;
/** Merge two activities by priority (running > unread). Absent or null is "none". */
export declare function mergeSurfaceActivity(a: SurfaceActivity | null | undefined, b: SurfaceActivity | null | undefined): SurfaceActivity | null;
//# sourceMappingURL=surface-activity.d.ts.map