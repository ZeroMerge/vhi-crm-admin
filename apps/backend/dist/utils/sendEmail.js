"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
async function sendEmail(to, subject, html) {
    try {
        if (!process.env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY is not configured');
        }
        const { data, error } = await resend.emails.send({
            from: 'support@niesvlibrary.cloud',
            to,
            subject,
            html,
        });
        if (error) {
            console.error('Resend error:', error);
            return false;
        }
        console.log('Email sent successfully:', data);
        return true;
    }
    catch (error) {
        console.error('Email send failed:', error);
        return false;
    }
}
//# sourceMappingURL=sendEmail.js.map