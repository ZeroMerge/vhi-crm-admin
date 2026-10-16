// The company name shown in document headers: COMPANY_NAME, default "VHI" (the client will supply the official name).
// Used by the report exports. The email templates do not read it: they hard-code "VHI" in the wordmark, the logo alt text and the
// footer copy (modules/email/templates/layout.ts) and have no company-name setting of their own.

export const DEFAULT_COMPANY_NAME = 'VHI';
const MAX_LENGTH = 100;

export function companyName(env: NodeJS.ProcessEnv = process.env): string {
  // Control characters (including line breaks) are dropped: the name ends up in file headers.
  const raw = (env.COMPANY_NAME ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return raw ? raw.slice(0, MAX_LENGTH) : DEFAULT_COMPANY_NAME;
}
