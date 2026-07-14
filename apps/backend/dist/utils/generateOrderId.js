"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateOrderId = generateOrderId;
function generateOrderId(source, serviceType) {
    const digits = Math.floor(1000 + Math.random() * 9000);
    const suffix = Math.floor(10 + Math.random() * 90);
    const letters = String.fromCharCode(97 + Math.floor(Math.random() * 26))
        + String.fromCharCode(97 + Math.floor(Math.random() * 26));
    let prefix = source === 'client' ? 'CL' : '#';
    if (serviceType === 'consolidation')
        prefix = 'CON';
    else if (serviceType === 'groupage')
        prefix = 'GRP';
    else if (serviceType === 'china_groupage')
        prefix = 'CGR';
    else if (serviceType === 'export')
        prefix = 'EXP';
    return `${prefix}${digits}-${suffix}-${letters}`;
}
//# sourceMappingURL=generateOrderId.js.map