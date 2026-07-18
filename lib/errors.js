export class DocIntakeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "DocIntakeError";
    this.code = options.code || "DOC_INTAKE_ERROR";
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

export function serializeError(error) {
  if (!error) {
    return { name: "Error", message: "Unknown error", code: "UNKNOWN" };
  }

  return {
    name: error.name || "Error",
    message: error.message || String(error),
    code: error.code || "ERROR",
    details: error.details || null,
    cause: error.cause ? serializeError(error.cause) : null,
  };
}
