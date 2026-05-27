import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(to: string, subject: string, body: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER || 'vhilimited@gmail.com',
      to,
      subject,
      html: body,
    });
    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}
