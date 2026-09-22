/**
 * app-contract/cli.ts — generated from shared/app-contract/cli.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Static declaration for one App-owned `hana serve` argument. */
export interface AppCliFlagV2 {
    /** A lowercase identifier without dots; the App id supplies the namespace. */
    readonly name: string;
    readonly type: "boolean" | "string";
    readonly description?: string;
    readonly default?: boolean | string;
}
/** The readonly launch-argument face exposed to an App by the host. */
export interface HanaPluginLaunchArgsV2 {
    get(name: string): Promise<boolean | string | undefined>;
    getAll(): Promise<Readonly<Record<string, boolean | string>>>;
}
export declare const HANA_PLUGIN_LAUNCH_ARGS_V2_MEMBERS: readonly string[];
//# sourceMappingURL=cli.d.ts.map