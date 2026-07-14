"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
async function sendEmail(to, subject, html) {
    try {
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to,
            subject,
            html,
        });
        return true;
    }
    catch (error) {
        console.error('Email send failed:', error);
        return false;
    }
}
//# sourceMappingURL=sendEmail.js.map