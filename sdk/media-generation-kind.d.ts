/**
 * media-generation-kind.ts — generated from shared/media-generation-kind.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/media-generation-kind.ts — 媒体生成任务/产物/deferred 的 kind 映射唯一入口。
 *
 * 只覆盖已存在的 image/video 与本次新增的 speech(audio)，不预测未来 kind。
 * 任务类别（持久）：image / video / speech。
 * 产物 kind：image / video / audio。
 * 后台 deferred 类型：image-generation / video-generation / audio-generation。
 *
 * 注意：kind "audio" 指语音合成的产物；它与"音频输入 ASR"是不同语义，ASR 不在这里。
 */
export type MediaGenerationKind = "image" | "video" | "audio";
export type MediaGenerationDeferredType = "image-generation" | "video-generation" | "audio-generation";
/** 任务 type → 产物 kind；未知返回 null。 */
export declare function mediaGenerationKindForTaskType(type: unknown): MediaGenerationKind | null;
/** 产物 kind → 后台 deferred 类型；未知返回 null。 */
export declare function deferredTypeForMediaKind(kind: unknown): MediaGenerationDeferredType | null;
/** 后台 deferred 类型 → 产物 kind；未知返回 null。 */
export declare function mediaKindForDeferredType(type: unknown): MediaGenerationKind | null;
/** type guard：是否为已知的媒体生成 deferred 类型。 */
export declare function isMediaGenerationDeferredType(value: unknown): value is MediaGenerationDeferredType;
//# sourceMappingURL=media-generation-kind.d.ts.map