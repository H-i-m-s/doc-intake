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
export const APP_MEDIA_BULK_CLEANUP_PARTIAL = "APP_MEDIA_BULK_CLEANUP_PARTIAL";
//# sourceMappingURL=media.js.map