/**
 * Transcribe a session file from the current tool call or an App-owned local
 * audio file. The host enforces the media grant and both file-ownership paths.
 */
export function transcribeAudio(ctx, payload) {
    return ctx.bus.request("media:transcribe-audio", payload);
}
/** Read speech-recognition providers and their public model metadata. */
export function listSpeechRecognitionProviders(ctx) {
    return ctx.bus.request("provider:media-providers", {
        capability: "speech_recognition",
    });
}
/**
 * Synthesize speech that reads the given text aloud. Returns asynchronously:
 * the result carries task handles and frozen per-segment metadata, and the
 * finished audio is delivered as a SessionFile (session scope) or read back
 * through `ctx.media` (app scope) — not returned inline. This is text-to-speech
 * only, never transcription, music, or sound effects.
 */
export function generateSpeech(ctx, payload) {
    return ctx.bus.request("media:generate-speech", payload);
}
export const APP_MEDIA_BULK_CLEANUP_PARTIAL = "APP_MEDIA_BULK_CLEANUP_PARTIAL";
//# sourceMappingURL=media.js.map