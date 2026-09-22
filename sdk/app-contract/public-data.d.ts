/**
 * app-contract/public-data.ts — generated from shared/app-contract/public-data.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/** In-memory, producer-selected snapshots shared between Apps in one Hana instance. */
export declare const APP_PUBLIC_DATA_PUBLISH_CAPABILITY = "app/public-data.publish";
export declare const APP_PUBLIC_DATA_READ_CAPABILITY = "app/public-data.read";
export declare const APP_PUBLIC_DATA_CAPABILITY_WORDS: readonly ["app/public-data.publish", "app/public-data.read"];
export type AppPublicDataCapability = (typeof APP_PUBLIC_DATA_CAPABILITY_WORDS)[number];
export type AppPublicDataJsonV2 = null | boolean | number | string | readonly AppPublicDataJsonV2[] | {
    readonly [key: string]: AppPublicDataJsonV2;
};
export interface AppPublicDataPublishInputV2 {
    readonly key: string;
    readonly schemaVersion: number;
    readonly data: AppPublicDataJsonV2;
    readonly title?: string;
    readonly description?: string;
}
export interface AppPublicDataMetadataV2 {
    readonly appId: string;
    readonly key: string;
    readonly schemaVersion: number;
    readonly title: string | null;
    readonly description: string | null;
    readonly updatedAt: string;
}
export interface AppPublicDataEnvelopeV2 extends AppPublicDataMetadataV2 {
    readonly data: AppPublicDataJsonV2;
}
export interface AppPublicDataListInputV2 {
    readonly appId?: string;
    readonly limit?: number;
}
export interface AppPublicDataListResultV2 {
    readonly entries: readonly AppPublicDataMetadataV2[];
    readonly truncated: boolean;
}
export interface AppPublicDataV2 {
    publish(input: AppPublicDataPublishInputV2): Promise<AppPublicDataMetadataV2>;
    unpublish(key: string): Promise<{
        readonly removed: boolean;
    }>;
    get(input: {
        readonly appId: string;
        readonly key: string;
    }): Promise<AppPublicDataEnvelopeV2>;
    list(input?: AppPublicDataListInputV2): Promise<AppPublicDataListResultV2>;
}
//# sourceMappingURL=public-data.d.ts.map