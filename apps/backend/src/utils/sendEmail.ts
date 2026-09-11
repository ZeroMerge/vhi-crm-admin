import nodemailer from 'nodemailer';

const REQUIRED_SMTP_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;

function getMissingSmtpVars(): string[] {
  return REQUIRED_SMTP_VARS.filter((name) => !process.env[name]);
}

// SMTP_FROM must resolve to a real address. If it's a bare display name
// (no "@"), pair it with the authenticated mailbox — otherwise Nodemailer
// sends with an empty envelope sender and hosts like Hostinger accept the
// session (logs "sent") but silently drop the message.
function resolveFrom(): string | undefined {
  const configured = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  if (!configured) return user;
  if (configured.includes('@')) return configured;
  return user ? `${configured} <${user}>` : undefined;
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string
) {
  try {
    const missing = getMissingSmtpVars();
    if (missing.length > 0) {
      throw new Error(`Missing required SMTP environment variables: ${missing.join(', ')}`);
    }

    const info = await transporter.sendMail({
      from: resolveFrom(),
      to,
      subject,
      html,
    });

    if (!info.messageId || info.messageId.endsWith('@localhost>')) {
      console.warn(
        'Email accepted but envelope sender looks unset — check that SMTP_FROM is a full address (e.g. "VHI <support@yourdomain>").'
      );
    }

    console.log('Email sent successfully:', info.messageId);

    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}
