export class ChalkboardLayoutError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ChalkboardLayoutError';
        this.code = code;
    }
}
//# sourceMappingURL=layout-errors.js.map