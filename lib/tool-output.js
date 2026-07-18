import { serializeError } from "./errors.js";

export function toToolResult(payload, text) {
  return {
    content: [{
      type: "text",
      text: text || JSON.stringify(payload, null, 2),
    }],
    details: {
      data: payload,
    },
  };
}

export function toToolError(error, extra = {}) {
  const payload = {
    ok: false,
    error: serializeError(error),
    ...extra,
  };
  return toToolResult(payload);
}
