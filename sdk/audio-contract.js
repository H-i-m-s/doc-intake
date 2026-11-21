/**
 * audio-contract.ts — generated from shared/audio-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/audio-contract.ts — 语音合成（TTS）的 typed 叶子契约。
 *
 * 这一层只描述"一次合成调用需要的输入"和"它吐出的流事件"，只做契约，不认识
 * engine、会话焦点、播放器或文件系统，也不携带任何具体供应商的能力清单
 * （mp3-only、preset-only、0.5..2、24000 这些属于某个适配器与模型声明，不写在
 * 共享类型里）。将来第二个供应商接入时，本文件的请求/事件类型无需改动。
 */
export const KNOWN_AUDIO_FORMATS = Object.freeze(["mp3", "wav", "pcm", "ogg_opus"]);
export function isKnownAudioFormat(value) {
    return typeof value === "string" && KNOWN_AUDIO_FORMATS.includes(value);
}
//# sourceMappingURL=audio-contract.js.map