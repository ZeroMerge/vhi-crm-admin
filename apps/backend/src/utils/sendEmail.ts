import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(
  to: string,
  subject: string,
  html: string
) {
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
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}
