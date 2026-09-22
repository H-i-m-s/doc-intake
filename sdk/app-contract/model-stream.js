import { AppSdkError } from "./sdk-error.js";
function streamError(code, message) {
    return new AppSdkError({ code, message, operation: "models.streamEvents", kind: "invalid" });
}
function isAssistantContent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const content = value;
    if (content.type === "text") {
        return typeof content.text === "string"
            && (content.textSignature === undefined || typeof content.textSignature === "string");
    }
    if (content.type === "reasoning") {
        return typeof content.reasoning === "string"
            && (content.signature === undefined || typeof content.signature === "string")
            && (content.redacted === undefined || typeof content.redacted === "boolean");
    }
    return content.type === "toolCall"
        && typeof content.id === "string"
        && typeof content.name === "string"
        && !!content.arguments
        && typeof content.arguments === "object"
        && !Array.isArray(content.arguments)
        && (content.namespace === undefined || typeof content.namespace === "string")
        && (content.thoughtSignature === undefined || typeof content.thoughtSignature === "string");
}
function isAssistantMessage(value) {
    return !!value
        && typeof value === "object"
        && !Array.isArray(value)
        && value.role === "assistant"
        && Array.isArray(value.content)
        && value.content.every(isAssistantContent);
}
async function cancelResponseBody(response) {
    try {
        await response.body?.cancel();
    }
    catch {
        // A response body may already be disturbed by the transport. The caller
        // still receives the original diagnostic rather than a cleanup failure.
    }
}
function parseEvent(line) {
    let value;
    try {
        value = JSON.parse(line);
    }
    catch {
        throw streamError("APP_MODEL_STREAM_INVALID", "The model returned an invalid JSON event.");
    }
    if (!value || typeof value !== "object")
        throw streamError("APP_MODEL_STREAM_INVALID", "The model returned a non-object event.");
    const event = value;
    if (typeof event.requestId !== "string")
        throw streamError("APP_MODEL_STREAM_INVALID", "A model event is missing its request identity.");
    const valid = event.type === "start"
        || ((event.type === "text-delta" || event.type === "reasoning-delta") && typeof event.delta === "string")
        || (event.type === "tool-call" && typeof event.id === "string" && typeof event.name === "string" && !!event.arguments && typeof event.arguments === "object" && !Array.isArray(event.arguments))
        || (event.type === "done" && ["stop", "length", "toolUse", "deferred"].includes(String(event.stopReason)) && isAssistantMessage(event.assistant))
        || (event.type === "error" && typeof event.code === "string" && typeof event.message === "string");
    if (!valid)
        throw streamError("APP_MODEL_STREAM_INVALID", "The model returned an unsupported event shape.");
    return value;
}
/** Decode a model stream and release its reader on completion, error or break. */
export async function* readAppModelStream(response, options = {}) {
    const limit = options.maxEventCharacters ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        await cancelResponseBody(response);
        throw streamError("APP_MODEL_STREAM_INVALID", "maxEventCharacters must be a positive integer.");
    }
    if (!response.ok) {
        await cancelResponseBody(response);
        throw new AppSdkError({
            code: "APP_MODEL_HTTP_ERROR", message: `Model stream failed with HTTP ${response.status}.`,
            operation: "models.streamEvents", kind: "host",
        });
    }
    if (!response.body)
        throw streamError("APP_MODEL_STREAM_EMPTY", "The model stream has no response body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "";
    let terminal = false;
    let ended = false;
    let requestId;
    const abort = () => { void reader.cancel().catch(() => { }); };
    options.signal?.addEventListener("abort", abort, { once: true });
    const checkAbort = () => {
        if (options.signal?.aborted)
            throw new AppSdkError({ code: "RPC_ABORTED", message: "Model stream was aborted.", operation: "models.streamEvents", kind: "aborted" });
    };
    const decode = (line) => {
        if (line.length > limit)
            throw streamError("APP_MODEL_STREAM_LIMIT", "A model event exceeded the configured size limit.");
        const event = parseEvent(line);
        if (requestId !== undefined && event.requestId !== requestId)
            throw streamError("APP_MODEL_STREAM_IDENTITY", "The model stream changed request identity.");
        requestId = event.requestId;
        if (event.type === "error")
            throw new AppSdkError({ code: event.code, message: event.message, operation: "models.streamEvents", kind: "host" });
        terminal = event.type === "done";
        return event;
    };
    try {
        while (!terminal) {
            checkAbort();
            const chunk = await reader.read();
            checkAbort();
            ended = chunk.done;
            try {
                pending += decoder.decode(chunk.value, { stream: !chunk.done });
            }
            catch {
                throw streamError("APP_MODEL_STREAM_INVALID", "The model stream contains invalid UTF-8.");
            }
            let newline;
            while ((newline = pending.indexOf("\n")) !== -1) {
                const line = pending.slice(0, newline).trim();
                pending = pending.slice(newline + 1);
                if (!line)
                    continue;
                yield decode(line);
                if (terminal)
                    break;
            }
            if (pending.length > limit)
                throw streamError("APP_MODEL_STREAM_LIMIT", "A model event exceeded the configured size limit.");
            if (terminal)
                break;
            if (chunk.done) {
                if (pending.trim())
                    yield decode(pending.trim());
                if (!terminal)
                    throw streamError("APP_MODEL_STREAM_TRUNCATED", "The model stream ended without a completion event.");
                break;
            }
        }
    }
    finally {
        options.signal?.removeEventListener("abort", abort);
        if (!ended)
            await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
//# sourceMappingURL=model-stream.js.map