import { randomUUID } from "node:crypto";
import { isAppRpcBulkCleanupDetails, restoreAppRpcErrorMetadata, } from "./rpc-error.js";
const MAX_PENDING = 128;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const HTTP_READ = "http.body.read";
const HTTP_CANCEL = "http.body.cancel";
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const STREAM_READ_TIMEOUT_MS = 24 * 60 * 60 * 1000;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function checkedJsonBytes(value) {
    let text;
    try {
        text = JSON.stringify(value);
    }
    catch {
        throw Object.assign(new Error("Managed runtime IPC message is not JSON serializable"), { code: "APP_RUNTIME_IPC_INVALID" });
    }
    if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) {
        throw Object.assign(new Error("Managed runtime IPC message exceeds the 32 MiB limit"), { code: "APP_RUNTIME_IPC_TOO_LARGE" });
    }
}
function restoreError(error) {
    const result = new Error(typeof error.message === "string" ? error.message : "Managed runtime host call failed");
    if (typeof error.data?.name === "string")
        result.name = error.data.name;
    if (typeof error.data?.code === "string")
        result.code = error.data.code;
    if (typeof error.data?.appId === "string")
        result.appId = error.data.appId;
    restoreAppRpcErrorMetadata(result, error.data);
    if (error.data?.code === "APP_MEDIA_BULK_CLEANUP_PARTIAL" && isAppRpcBulkCleanupDetails(error.data.details)) {
        result.details = {
            removedTaskIds: [...error.data.details.removedTaskIds],
            failedTaskId: error.data.details.failedTaskId,
        };
    }
    return result;
}
function isWireResponse(value) {
    return isRecord(value)
        && typeof value.status === "number"
        && Array.isArray(value.headers)
        && (typeof value.bodyBase64 === "string" || typeof value.bodyStreamId === "string");
}
class RuntimeIpcClient {
    nextId = 1;
    clientId = randomUUID();
    pending = new Map();
    activeBodyIds = new Set();
    closed = false;
    onMessageBound = (message) => this.onMessage(message);
    onDisconnectBound = () => this.close("Managed runtime IPC disconnected");
    constructor() {
        if (typeof process.send !== "function") {
            throw Object.assign(new Error("connectAppRuntime() is available only inside a Node managed runtime"), { code: "APP_RUNTIME_IPC_UNAVAILABLE" });
        }
        process.on("message", this.onMessageBound);
        process.once("disconnect", this.onDisconnectBound);
    }
    takePending(id) {
        const pending = this.pending.get(id);
        if (!pending)
            return undefined;
        this.pending.delete(id);
        if (pending.timer)
            clearTimeout(pending.timer);
        pending.signal?.removeEventListener("abort", pending.abort);
        return pending;
    }
    call(method, params, timeoutMs = DEFAULT_CALL_TIMEOUT_MS, signal) {
        if (this.closed)
            return Promise.reject(new Error("Managed runtime IPC is closed"));
        if (this.pending.size >= MAX_PENDING) {
            return Promise.reject(Object.assign(new Error("Managed runtime IPC concurrency limit reached"), { code: "APP_RUNTIME_IPC_BUSY" }));
        }
        const id = `${this.clientId}:${this.nextId++}`;
        const packet = { jsonrpc: "2.0", id, method, params };
        try {
            checkedJsonBytes(packet);
        }
        catch (error) {
            return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
            let timer = null;
            if (timeoutMs !== null) {
                timer = setTimeout(() => {
                    const pending = this.takePending(id);
                    if (!pending)
                        return;
                    pending.reject(Object.assign(new Error(`Managed runtime IPC ${method} timed out after ${timeoutMs}ms`), { code: "APP_RUNTIME_IPC_TIMEOUT" }));
                }, timeoutMs);
                timer.unref?.();
            }
            const abort = () => {
                const pending = this.takePending(id);
                if (pending)
                    pending.reject(Object.assign(new Error(`Managed runtime IPC ${method} was cancelled`), { code: "APP_RUNTIME_IPC_CANCELLED" }));
            };
            this.pending.set(id, { resolve, reject, timer, signal, abort });
            if (signal?.aborted) {
                abort();
                return;
            }
            signal?.addEventListener("abort", abort, { once: true });
            try {
                process.send?.(packet);
            }
            catch (error) {
                this.takePending(id)?.reject(error);
            }
        });
    }
    registerBody(id) { this.activeBodyIds.add(id); }
    releaseBody(id, notifyHost) {
        if (!this.activeBodyIds.delete(id) || !notifyHost || this.closed)
            return;
        this.notify(HTTP_CANCEL, { id });
    }
    close(reason = "Managed runtime IPC closed") {
        if (this.closed)
            return;
        // Send cancellation notifications while the fd is still usable; these do
        // not create pending replies and therefore cannot hold shutdown open.
        for (const id of [...this.activeBodyIds])
            this.releaseBody(id, true);
        this.closed = true;
        process.off("message", this.onMessageBound);
        process.off("disconnect", this.onDisconnectBound);
        for (const pending of this.pending.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.signal?.removeEventListener("abort", pending.abort);
            pending.reject(new Error(reason));
        }
        this.pending.clear();
    }
    onMessage(raw) {
        if (this.closed || !isRecord(raw) || raw.jsonrpc !== "2.0")
            return;
        try {
            checkedJsonBytes(raw);
        }
        catch {
            this.close("Managed runtime IPC received an invalid message");
            return;
        }
        if (typeof raw.id !== "string")
            return;
        const pending = this.takePending(raw.id);
        if (!pending)
            return;
        if (isRecord(raw.error)) {
            pending.reject(restoreError(raw.error));
            return;
        }
        pending.resolve(raw.result);
    }
    notify(method, params) {
        const packet = { jsonrpc: "2.0", method, params };
        try {
            checkedJsonBytes(packet);
            process.send?.(packet);
        }
        catch {
            // Shutdown must not leave a local exception after best-effort cleanup.
        }
    }
}
function responseFromWire(client, wire) {
    if (!wire.bodyStreamId) {
        return new Response(wire.bodyBase64 ? Buffer.from(wire.bodyBase64, "base64") : null, {
            status: wire.status,
            statusText: wire.statusText,
            headers: [...wire.headers],
        });
    }
    let ended = false;
    let readAbort = null;
    const streamId = wire.bodyStreamId;
    client.registerBody(streamId);
    const body = new ReadableStream({
        async pull(controller) {
            if (ended)
                return;
            try {
                readAbort = new AbortController();
                const next = await client.call(HTTP_READ, { id: streamId }, STREAM_READ_TIMEOUT_MS, readAbort.signal);
                readAbort = null;
                if (next.done === true) {
                    ended = true;
                    client.releaseBody(streamId, false);
                    controller.close();
                    return;
                }
                if (typeof next.bytes !== "string")
                    throw new Error("Invalid managed runtime HTTP stream chunk");
                const bytes = Buffer.from(next.bytes, "base64");
                if (bytes.byteLength > 64 * 1024)
                    throw new Error("Managed runtime HTTP stream chunk exceeds 64 KiB");
                controller.enqueue(bytes);
            }
            catch (error) {
                readAbort = null;
                ended = true;
                client.releaseBody(streamId, true);
                controller.error(error);
            }
        },
        async cancel() {
            if (ended)
                return;
            ended = true;
            readAbort?.abort();
            client.releaseBody(streamId, true);
        },
    }, { highWaterMark: 0 });
    return new Response(body, { status: wire.status, statusText: wire.statusText, headers: [...wire.headers] });
}
/** Connect to the parent-owned IPC channel from inside `runtime: "node"` only. */
export function connectAppRuntime() {
    const client = new RuntimeIpcClient();
    const withOptionalTail = (args, value) => value === undefined ? args : [...args, value];
    const call = (domain, method, args) => client.call("app.domain.call", { domain, method, args }, (domain === "tasks" && method === "retry") || (domain === "models" && method === "utility") ? null : undefined);
    const response = async (domain, method, args) => {
        const result = await call(domain, method, args);
        if (!isWireResponse(result))
            throw new Error(`Managed runtime ${domain}.${method} did not return an HTTP response`);
        return responseFromWire(client, result);
    };
    return {
        tasks: {
            create: (input) => call("tasks", "create", [input]),
            get: (taskId, options) => call("tasks", "get", withOptionalTail([taskId], options)),
            list: (options) => call("tasks", "list", withOptionalTail([], options)),
            update: (taskId, patch, options) => call("tasks", "update", withOptionalTail([taskId, patch], options)),
            complete: (taskId, result, options) => call("tasks", "complete", withOptionalTail([taskId, result], options)),
            fail: (taskId, error, options) => call("tasks", "fail", withOptionalTail([taskId, error], options)),
            cancel: (taskId, reason = "canceled", options) => call("tasks", "cancel", withOptionalTail([taskId, reason], options)),
            requestApproval: (input) => call("tasks", "requestApproval", [input]),
            respondApproval: (input) => call("tasks", "respondApproval", [input]),
            watch: (taskId, options) => response("tasks", "watch", withOptionalTail([taskId], options)),
            schedule: (input) => call("tasks", "schedule", [input]),
            getSchedule: (id, options) => call("tasks", "getSchedule", withOptionalTail([id], options)),
            listSchedules: (options) => call("tasks", "listSchedules", withOptionalTail([], options)),
            updateSchedule: (id, patch, options) => call("tasks", "updateSchedule", withOptionalTail([id, patch], options)),
            pauseSchedule: (id, options) => call("tasks", "pauseSchedule", withOptionalTail([id], options)),
            resumeSchedule: (id, options) => call("tasks", "resumeSchedule", withOptionalTail([id], options)),
            unschedule: (id, options) => call("tasks", "unschedule", withOptionalTail([id], options)),
            retry: (id, options) => call("tasks", "retry", withOptionalTail([id], options)),
            abort: (id, reason = "aborted", options) => call("tasks", "abort", withOptionalTail([id, reason], options)),
            recycle: (id, options) => call("tasks", "recycle", withOptionalTail([id], options)),
            getDelivery: (id, options) => call("tasks", "getDelivery", withOptionalTail([id], options)),
        },
        models: {
            list: () => call("models", "list", []),
            stream: (input) => response("models", "stream", [input]),
            utility: (input) => call("models", "utility", [input]),
            cancel: (requestId) => call("models", "cancel", [requestId]),
        },
        media: {
            listTasks: (options) => call("media", "listTasks", withOptionalTail([], options)),
            getTask: (taskId, options) => call("media", "getTask", withOptionalTail([taskId], options)),
            getTaskResources: (taskId, options) => call("media", "getTaskResources", withOptionalTail([taskId], options)),
            updateTask: (taskId, patch, options) => call("media", "updateTask", withOptionalTail([taskId, patch], options)),
            cancelTask: (taskId, options) => call("media", "cancelTask", withOptionalTail([taskId], options)),
            retryTask: (taskId, options) => call("media", "retryTask", withOptionalTail([taskId], options)),
            removeTask: (taskId, options) => call("media", "removeTask", withOptionalTail([taskId], options)),
            removeUnfavorited: (options) => call("media", "removeUnfavorited", withOptionalTail([], options)),
            listAdapters: () => call("media", "listAdapters", []),
            addModel: (providerId, capability, model) => call("media", "addModel", [providerId, capability, model]),
            updateModel: (providerId, capability, modelId, patch) => call("media", "updateModel", [providerId, capability, modelId, patch]),
            removeModel: (providerId, capability, modelId) => call("media", "removeModel", [providerId, capability, modelId]),
        },
        network: { fetch: (url, init) => response("network", "fetch", [url, init]) },
        close: () => client.close(),
    };
}
//# sourceMappingURL=runtime-client.js.map