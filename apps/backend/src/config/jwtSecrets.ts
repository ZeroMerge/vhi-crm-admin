// Single source of truth for JWT signing secrets.
// No fallbacks: a missing or weak secret must stop the server, never silently
// sign tokens with a value that exists in git history.

const MIN_SECRET_LENGTH = 32;

type JwtSecretName = 'ADMIN_JWT_SECRET' | 'CLIENT_JWT_SECRET';

function readSecret(name: JwtSecretName): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be set (min ${MIN_SECRET_LENGTH} characters). Refusing to sign or verify tokens without it.`
    );
  }
  return value;
}

export const getAdminJwtSecret = (): string => readSecret('ADMIN_JWT_SECRET');
export const getClientJwtSecret = (): string => readSecret('CLIENT_JWT_SECRET');

/** Call once at startup so a missing secret stops boot instead of failing on first login. */
export function assertJwtSecrets(): void {
  getAdminJwtSecret();
  getClientJwtSecret();
}