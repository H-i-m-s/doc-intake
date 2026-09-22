/**
 * app-contract/catalog.ts — generated from shared/app-contract/catalog.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** Scope shared by the tool and slash-command catalog readers. */
export type AppCatalogScopeOptionsV2 = {
    scope?: "own" | "all";
};
export type AppCatalogSourceV2 = {
    kind: "app" | "plugin" | "mcp" | "core" | "custom" | "unknown";
    appId?: string;
};
export type AppToolCatalogEntryV2 = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    source: AppCatalogSourceV2;
    availability: {
        registered: true;
        modelExposureAllowed?: boolean;
    };
};
export type AppCommandCatalogEntryV2 = {
    name: string;
    description?: string;
    usage?: string;
    aliases: readonly string[];
    source: AppCatalogSourceV2;
    availability: {
        registered: true;
    };
};
//# sourceMappingURL=catalog.d.ts.map