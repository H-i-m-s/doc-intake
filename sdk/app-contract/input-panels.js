/** Byte budget for one custom input panel's question data or structured answer. */
export const APP_INPUT_PANEL_DATA_MAX_BYTES = 64 * 1024;
export const APP_INPUT_PANEL_DEFAULT_PRESENTATION = Object.freeze({
    height: null,
    collapsedHeight: 32,
    expanded: true,
});
/** Read each caller-provided field exactly once and reject reflective shapes. */
function presentationDataProperties(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("app input panel presentation must be an object");
    }
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length) {
        throw new Error("app input panel presentation must be a plain JSON object");
    }
    const properties = Object.create(null);
    for (const key of Object.getOwnPropertyNames(value)) {
        if (key !== "height" && key !== "collapsedHeight" && key !== "expanded") {
            throw new Error("app input panel presentation contains an unknown field");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new Error("app input panel presentation fields must be enumerable data properties");
        }
        properties[key] = descriptor.value;
    }
    return properties;
}
/** Copy a validated patch without rereading untrusted caller properties. */
export function copyAppInputPanelPresentationPatch(value) {
    const properties = presentationDataProperties(value);
    // Validate complete semantics as well as the patch shape, then retain only
    // fields the caller actually supplied so show/update keep omitted fields.
    normalizeAppInputPanelPresentation(properties);
    return Object.freeze({
        ...(Object.prototype.hasOwnProperty.call(properties, "height") ? { height: properties.height } : {}),
        ...(Object.prototype.hasOwnProperty.call(properties, "collapsedHeight") ? { collapsedHeight: properties.collapsedHeight } : {}),
        ...(Object.prototype.hasOwnProperty.call(properties, "expanded") ? { expanded: properties.expanded } : {}),
    });
}
/** Reject malformed writes; omitted fields retain the supplied base/default value. */
export function normalizeAppInputPanelPresentation(value, base = APP_INPUT_PANEL_DEFAULT_PRESENTATION) {
    if (value === undefined)
        return { ...base };
    const patch = presentationDataProperties(value);
    const hasHeight = Object.prototype.hasOwnProperty.call(patch, "height");
    const requestedHeight = hasHeight ? patch.height : base.height;
    let height = null;
    if (requestedHeight !== null) {
        if (typeof requestedHeight !== "number" || !Number.isFinite(requestedHeight) || requestedHeight < 24 || requestedHeight > 4096) {
            throw new Error("app input panel presentation height must be null or a finite number from 24 to 4096");
        }
        height = requestedHeight;
    }
    const hasCollapsedHeight = Object.prototype.hasOwnProperty.call(patch, "collapsedHeight");
    const collapsedHeight = hasCollapsedHeight ? patch.collapsedHeight : base.collapsedHeight;
    if (hasCollapsedHeight && collapsedHeight === undefined)
        throw new Error("app input panel presentation collapsedHeight must not be undefined");
    if (typeof collapsedHeight !== "number" || !Number.isFinite(collapsedHeight) || collapsedHeight < 24 || collapsedHeight > 4096) {
        throw new Error("app input panel presentation collapsedHeight must be a finite number from 24 to 4096");
    }
    const hasExpanded = Object.prototype.hasOwnProperty.call(patch, "expanded");
    const expanded = hasExpanded ? patch.expanded : base.expanded;
    if (hasExpanded && expanded === undefined)
        throw new Error("app input panel presentation expanded must not be undefined");
    if (typeof expanded !== "boolean")
        throw new Error("app input panel presentation expanded must be boolean");
    return { height, collapsedHeight, expanded };
}
//# sourceMappingURL=input-panels.js.map