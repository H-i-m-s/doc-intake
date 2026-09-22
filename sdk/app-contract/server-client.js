import { APP_SDK_BUS_METHODS } from "./bus-requests.js";
import { readAppModelStream } from "./model-stream.js";
import { AppSdkError, toAppSdkError } from "./sdk-error.js";
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function awaitRegistration(value, operation) {
    const registration = typeof value === "function" || isRecord(value) ? value : null;
    if (!registration || !(registration.ready instanceof Promise)) {
        await disposeUnsupportedRegistration(value);
        throw new AppSdkError({ code: "APP_SDK_HOST_UNSUPPORTED", kind: "unsupported", operation,
            message: "This host does not provide App registration receipts. Update Hana to use this SDK registration method." });
    }
    await registration.ready;
}
async function disposeUnsupportedRegistration(value) {
    try {
        const object = isRecord(value) ? value : null;
        const dispose = typeof value === "function"
            ? value
            : typeof object?.disposeAsync === "function"
                ? object.disposeAsync
                : typeof object?.unsubscribe === "function"
                    ? object.unsubscribe
                    : typeof object?.close === "function"
                        ? object.close
                        : null;
        if (!dispose)
            return;
        await Promise.resolve(Reflect.apply(dispose, value, []));
    }
    catch {
        // An unsupported legacy host must not turn a best-effort release failure
        // into a successful SDK registration or hide the compatibility diagnosis.
    }
}
const REGISTRATIONS = new Set([
    "windows.handleMessages", "windows.onEvent",
    "tools.register", "commands.register", "routes.register", "bus.subscribe", "bus.handle",
    "hooks.on", "hooks.onDecision", "shortcuts.register", "messageRenderers.register",
    "tasks.registerHandler", "resources.watch", "resources.subscribe",
    "storage.global.onChanged", "storage.agent.onChanged",
]);
/** Bind only methods already present on the host-provided domain. */
function bindDomain(name, domain) {
    const bound = {};
    for (const [key, value] of Object.entries(domain)) {
        if (typeof value !== "function") {
            bound[key] = value;
            continue;
        }
        const operation = `${name}.${key}`;
        bound[key] = async (...args) => {
            try {
                const result = await Reflect.apply(value, domain, args);
                if (REGISTRATIONS.has(operation))
                    await awaitRegistration(result, operation);
                return result;
            }
            catch (error) {
                throw toAppSdkError(error, operation);
            }
        };
    }
    // This adapter preserves each checked entry method's parameters and awaits
    // its result. The public mapping describes that exact transformation.
    return Object.freeze(bound);
}
function bindOperations(mapping, request) {
    return Object.freeze(Object.fromEntries(Object.entries(mapping).map(([method, verb]) => [
        method, (input, options) => request(verb, input, options),
    ])));
}
function unavailableStorageScope(error) {
    const reject = () => Promise.reject(toAppSdkError(error, "storage.agent"));
    return Object.freeze({
        get: reject,
        getAll: reject,
        set: reject,
        delete: reject,
        keys: reject,
        onChanged: reject,
    });
}
export function createAppSdk(context) {
    if (!context || typeof context.dataDir !== "string" || typeof context.bus?.request !== "function") {
        throw new AppSdkError({ code: "APP_SDK_CONTEXT_REQUIRED", operation: "createAppSdk", kind: "context",
            message: "createAppSdk requires the v2 App entry context supplied to apply(). Use the UI or managed-runtime entry in those environments." });
    }
    const request = async (verb, input, options) => {
        try {
            return await context.bus.request(verb, input, options);
        }
        catch (error) {
            throw toAppSdkError(error, verb);
        }
    };
    const domains = Object.fromEntries(Object.entries(context).map(([name, value]) => [
        name, value && typeof value === "object" ? bindDomain(name, value) : value,
    ]));
    const methods = Object.fromEntries(Object.entries(APP_SDK_BUS_METHODS).map(([name, mapping]) => [name, bindOperations(mapping, request)]));
    const models = bindDomain("models", context.models);
    const sdk = {
        ...domains,
        ...methods,
        tools: bindDomain("tools", context.tools),
        hooks: bindDomain("hooks", context.hooks),
        storage: {
            global: bindDomain("storage.global", context.storage.global),
            agent: (agentId) => {
                try {
                    return bindDomain("storage.agent", context.storage.agent(agentId));
                }
                catch (error) {
                    return unavailableStorageScope(error);
                }
            },
        },
        bus: {
            ...bindDomain("bus", context.bus), request,
            async requestService(name, input, options) {
                if (!/^app:[^/]+\/.+/.test(name))
                    throw new AppSdkError({ code: "APP_SERVICE_NAME_INVALID", kind: "invalid", operation: "bus.requestService", message: "Use a complete app:<appId>/<service> service name." });
                try {
                    return await context.bus.request(name, input, options);
                }
                catch (error) {
                    throw toAppSdkError(error, "bus.requestService");
                }
            },
        },
        models: {
            ...models, ...methods.models,
            async *streamEvents(input, options = {}) {
                if (options.signal?.aborted)
                    throw new AppSdkError({ code: "RPC_ABORTED", kind: "aborted", operation: "models.streamEvents", message: "Model stream was aborted." });
                const cancel = () => { void models.cancel(input.requestId).catch(() => { }); };
                options.signal?.addEventListener("abort", cancel, { once: true });
                try {
                    yield* readAppModelStream(await models.stream(input), options);
                }
                catch (error) {
                    throw toAppSdkError(error, "models.streamEvents");
                }
                finally {
                    options.signal?.removeEventListener("abort", cancel);
                }
            },
        },
        media: { ...bindDomain("media", context.media), ...methods.media },
        providers: {
            ...bindDomain("providers", context.providers),
            ...methods.providers,
            async listSpeechRecognitionProviders(options) {
                return await request("provider:media-providers", { capability: "speech_recognition" }, options);
            },
        },
    };
    // Domain adapters and the finite verb map preserve the entry contract. No
    // transport, caller identity, permission grant or session is manufactured.
    return Object.freeze(sdk);
}
/** Export the resulting object as the App's default entry. */
export function defineApp(setup) {
    return { async apply(context) { await setup(createAppSdk(context)); } };
}
//# sourceMappingURL=server-client.js.map