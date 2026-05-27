"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOrderId = generateOrderId;
function generateOrderId() {
    const digits = Math.floor(1000 + Math.random() * 9000);
    const suffix = Math.floor(10 + Math.random() * 90);
    const letters = String.fromCharCode(97 + Math.floor(Math.random() * 26)) + String.fromCharCode(97 + Math.floor(Math.random() * 26));
    return `#${digits}-${suffix}-${letters}`;
}
//# sourceMappingURL=generateOrderId.js.map