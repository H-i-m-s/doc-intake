/**
 * app-contract/providers.ts — generated from shared/app-contract/providers.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * Public, Pi-independent provider contract for v2 Apps. The host adapts this
 * structural surface to Pi's runtime Provider object; no credentials or
 * executable callbacks appear in the descriptor that crosses an App boundary.
 */
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const FORBIDDEN_DESCRIPTOR_KEYS = new Set(["headers", "apikey", "access", "refresh", "env"]);
export const APP_PROVIDER_DESCRIPTOR_MAX_MODELS = 10_000;
export const APP_PROVIDER_DESCRIPTOR_MAX_BYTES = 8 * 1024 * 1024;
function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function assertSafeJson(value, path, seen = new Set(), depth = 0) {
    if (depth > 64 || seen.has(value))
        throw new Error(path + " must be acyclic JSON within 64 levels");
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number") {
        if (Number.isFinite(value))
            return;
        throw new Error(`${path} must contain finite JSON numbers`);
    }
    if (Array.isArray(value)) {
        seen.add(value);
        for (let index = 0; index < value.length; index += 1)
            assertSafeJson(value[index], `${path}[${index}]`, seen, depth + 1);
        seen.delete(value);
        return;
    }
    if (!isPlainObject(value))
        throw new Error(`${path} must be JSON data`);
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
        if (FORBIDDEN_DESCRIPTOR_KEYS.has(key.toLowerCase())) {
            throw new Error(`${path}.${key} may not contain credentials or request headers`);
        }
        assertSafeJson(entry, `${path}.${key}`, seen, depth + 1);
    }
    seen.delete(value);
}
function requiredString(value, name) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name} is required`);
    return value;
}
function validateModel(model, canonicalProviderId) {
    if (!isPlainObject(model) || typeof model.id !== "string" || !model.id.trim())
        throw new Error("Every App provider model requires an id");
    if (model.provider !== undefined && model.provider !== canonicalProviderId)
        throw new Error(`App provider model "${model.id}" belongs to a different provider`);
    for (const field of ["name", "api", "baseUrl"])
        if (typeof model[field] !== "string")
            throw new Error(`App provider model "${model.id}" requires ${field}`);
    if (typeof model.reasoning !== "boolean" || !Array.isArray(model.input) || model.input.length === 0 || model.input.some((item) => item !== "text" && item !== "image"))
        throw new Error(`App provider model "${model.id}" has invalid execution capabilities`);
    if (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0 || !Number.isInteger(model.maxTokens) || model.maxTokens <= 0)
        throw new Error(`App provider model "${model.id}" requires positive token limits`);
    if (!isPlainObject(model.cost))
        throw new Error(`App provider model "${model.id}" has invalid cost`);
    const cost = model.cost;
    if (["input", "output", "cacheRead", "cacheWrite"].some((key) => typeof cost[key] !== "number" || !Number.isFinite(cost[key]) || cost[key] < 0))
        throw new Error(`App provider model "${model.id}" has invalid cost`);
    if (cost.tiers !== undefined && (!Array.isArray(cost.tiers) || cost.tiers.some((tier) => !isPlainObject(tier)
        || ["input", "output", "cacheRead", "cacheWrite", "inputTokensAbove"].some((key) => typeof tier[key] !== "number" || !Number.isFinite(tier[key]) || tier[key] < 0))))
        throw new Error("App provider model has invalid pricing tiers");
    if (!model.name.trim() || !model.api.trim())
        throw new Error("App provider model name and api must be non-empty");
    if (model.baseUrl) {
        let url;
        try {
            url = new URL(model.baseUrl);
        }
        catch {
            throw new Error(`App provider model "${model.id}" has an invalid baseUrl`);
        }
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
            throw new Error(`App provider model "${model.id}" baseUrl must be safe http or https`);
    }
}
/** Validate and clone descriptor data, assigning the host's canonical provider id to every model. */
export function validateAppProviderDescriptorV2(value, canonicalProviderId) {
    if (!isPlainObject(value))
        throw new Error("App provider descriptor must be an object");
    const fields = new Set(["id", "name", "models", "auth", "refreshModels", "filterModels", "fetchDeferred", "cancelDeferred"]);
    for (const key of Object.keys(value))
        if (!fields.has(key))
            throw new Error("Unknown App provider descriptor field: " + key);
    for (const key of ["refreshModels", "filterModels", "fetchDeferred", "cancelDeferred"])
        if (value[key] !== undefined && typeof value[key] !== "boolean")
            throw new Error("App provider descriptor " + key + " must be boolean");
    const id = requiredString(value.id, "App provider descriptor id");
    if (!ID.test(id))
        throw new Error("App provider descriptor id must contain 1-128 letters, numbers, dots, dashes, or underscores");
    const name = requiredString(value.name, "App provider descriptor name");
    if (!Array.isArray(value.models) || value.models.length > APP_PROVIDER_DESCRIPTOR_MAX_MODELS) {
        throw new Error(`App provider descriptor models must contain at most ${APP_PROVIDER_DESCRIPTOR_MAX_MODELS} entries`);
    }
    if (!isPlainObject(value.auth) || (!isPlainObject(value.auth.apiKey) && !isPlainObject(value.auth.oauth))) {
        throw new Error("App provider descriptor requires apiKey or oauth auth metadata");
    }
    assertSafeJson(value.models, "App provider descriptor.models");
    for (const [kind, auth] of Object.entries(value.auth)) {
        if ((kind !== "apiKey" && kind !== "oauth") || !isPlainObject(auth))
            throw new Error("App provider descriptor auth is invalid");
        const allowed = kind === "apiKey" ? new Set(["name", "login", "check", "optional"]) : new Set(["name", "isSubscription", "loginLabel"]);
        for (const key of Object.keys(auth))
            if (!allowed.has(key))
                throw new Error(`App provider descriptor auth.${kind}.${key} is not allowed`);
        requiredString(auth.name, `App provider descriptor auth.${kind}.name`);
        for (const key of ["login", "check", "optional", "isSubscription"])
            if (auth[key] !== undefined && typeof auth[key] !== "boolean")
                throw new Error("App provider auth flag must be boolean");
        if (auth.loginLabel !== undefined && typeof auth.loginLabel !== "string")
            throw new Error("App provider OAuth loginLabel must be a string");
    }
    const descriptor = JSON.parse(JSON.stringify(value));
    if (new TextEncoder().encode(JSON.stringify(descriptor)).byteLength > APP_PROVIDER_DESCRIPTOR_MAX_BYTES) {
        throw new Error(`App provider descriptor exceeds ${APP_PROVIDER_DESCRIPTOR_MAX_BYTES} bytes`);
    }
    const modelIds = new Set();
    for (const model of descriptor.models) {
        if (modelIds.has(model.id))
            throw new Error("App provider declares a duplicate model id");
        modelIds.add(model.id);
        validateModel(model, canonicalProviderId);
        model.provider = canonicalProviderId;
    }
    return descriptor;
}
/** Verify that callback-bearing implementation matches its JSON declaration. */
export function validateAppNativeProviderImplementationV2(descriptor, implementation) {
    if (!isPlainObject(implementation) || implementation.name !== descriptor.name || !Array.isArray(implementation.models) || !isPlainObject(implementation.auth)) {
        throw new Error("App native provider implementation does not match its descriptor");
    }
    const declaredIds = descriptor.models.map((model) => model.id).sort();
    const implementationIds = implementation.models.map((model) => model?.id).sort();
    if (JSON.stringify(declaredIds) !== JSON.stringify(implementationIds))
        throw new Error("App native provider implementation models do not match its descriptor");
    const apiKey = implementation.auth.apiKey;
    const oauth = implementation.auth.oauth;
    if (descriptor.auth.apiKey && (!apiKey || typeof apiKey.resolve !== "function" || (descriptor.auth.apiKey.login && typeof apiKey.login !== "function") || (descriptor.auth.apiKey.check && typeof apiKey.check !== "function"))) {
        throw new Error("App native provider apiKey callbacks do not match its descriptor");
    }
    if (descriptor.auth.oauth && (!oauth || typeof oauth.login !== "function" || typeof oauth.refresh !== "function" || typeof oauth.toAuth !== "function")) {
        throw new Error("App native provider oauth callbacks do not match its descriptor");
    }
    if (typeof implementation.stream !== "function" || typeof implementation.streamSimple !== "function")
        throw new Error("App native provider requires stream and streamSimple callbacks");
    if (descriptor.refreshModels && typeof implementation.refreshModels !== "function")
        throw new Error("App native provider refreshModels callback is required");
    if (descriptor.filterModels && typeof implementation.filterModels !== "function")
        throw new Error("App native provider filterModels callback is required");
    if (descriptor.fetchDeferred && typeof implementation.fetchDeferred !== "function")
        throw new Error("App native provider fetchDeferred callback is required");
    if (descriptor.cancelDeferred && typeof implementation.cancelDeferred !== "function")
        throw new Error("App native provider cancelDeferred callback is required");
    return implementation;
}
//# sourceMappingURL=providers.js.map