"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
async function sendEmail(to, subject, body) {
    try {
        await transporter.sendMail({
            from: process.env.SMTP_USER || 'vhilimited@gmail.com',
            to,
            subject,
            html: body,
        });
        return true;
    }
    catch (error) {
        console.error('Email send failed:', error);
        return false;
    }
}
//# sourceMappingURL=sendEmail.js.map