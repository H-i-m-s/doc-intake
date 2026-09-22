const MAX_TEXT_LENGTH = 512;
const MAX_FIELD_COUNT = 32;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeText(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH
        ? value
        : undefined;
}
function readField(value) {
    if (!isRecord(value))
        return null;
    const code = safeText(value.code);
    const message = safeText(value.message);
    const field = safeText(value.field);
    const key = safeText(value.key);
    if (!code || !message || (!field && !key))
        return null;
    return Object.freeze({
        ...(field ? { field } : {}),
        ...(key ? { key } : {}),
        code,
        message,
    });
}
/** Read only declared App error metadata, never an arbitrary Error object. */
export function readAppRpcErrorMetadata(value) {
    if (!isRecord(value))
        return {};
    const capability = safeText(value.capability);
    const operation = safeText(value.operation);
    const fields = Array.isArray(value.fields)
        ? value.fields.slice(0, MAX_FIELD_COUNT).map(readField).filter((field) => field !== null)
        : [];
    return Object.freeze({
        ...(capability ? { capability } : {}),
        ...(operation ? { operation } : {}),
        ...(fields.length > 0 ? { fields: Object.freeze(fields) } : {}),
    });
}
/** Restore the approved metadata onto the local Error for SDK adapters. */
export function restoreAppRpcErrorMetadata(error, value) {
    const metadata = readAppRpcErrorMetadata(value);
    if (metadata.capability)
        error.capability = metadata.capability;
    if (metadata.operation)
        error.operation = metadata.operation;
    if (metadata.fields)
        error.fields = metadata.fields;
}
export function isAppRpcBulkCleanupDetails(value) {
    if (!isRecord(value) || typeof value.failedTaskId !== "string" || !Array.isArray(value.removedTaskIds))
        return false;
    return value.failedTaskId.length > 0 && value.removedTaskIds.every((id) => typeof id === "string" && id.length > 0);
}
//# sourceMappingURL=rpc-error.js.map