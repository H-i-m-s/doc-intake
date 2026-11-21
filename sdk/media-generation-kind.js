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
const AUDIO_TASK_TYPES = new Set(["speech"]);
const IMAGE_TASK_TYPES = new Set(["image", "text2image", "image2image"]);
const VIDEO_TASK_TYPES = new Set([
    "video",
    "text2video",
    "image2video",
    "frames2video",
    "multiframe2video",
    "multimodal2video",
]);
/** 任务 type → 产物 kind；未知返回 null。 */
export function mediaGenerationKindForTaskType(type) {
    const value = typeof type === "string" ? type.trim().toLowerCase() : "";
    if (!value)
        return null;
    if (AUDIO_TASK_TYPES.has(value))
        return "audio";
    if (IMAGE_TASK_TYPES.has(value))
        return "image";
    if (VIDEO_TASK_TYPES.has(value))
        return "video";
    // 与既有 task-store 判定保持一致：含 "video"→video，含 "image"→image。
    if (value.includes("video"))
        return "video";
    if (value.includes("image"))
        return "image";
    return null;
}
/** 产物 kind → 后台 deferred 类型；未知返回 null。 */
export function deferredTypeForMediaKind(kind) {
    if (kind === "image")
        return "image-generation";
    if (kind === "video")
        return "video-generation";
    if (kind === "audio")
        return "audio-generation";
    return null;
}
/** 后台 deferred 类型 → 产物 kind；未知返回 null。 */
export function mediaKindForDeferredType(type) {
    if (type === "image-generation")
        return "image";
    if (type === "video-generation")
        return "video";
    if (type === "audio-generation")
        return "audio";
    return null;
}
/** type guard：是否为已知的媒体生成 deferred 类型。 */
export function isMediaGenerationDeferredType(value) {
    return value === "image-generation" || value === "video-generation" || value === "audio-generation";
}
//# sourceMappingURL=media-generation-kind.js.map