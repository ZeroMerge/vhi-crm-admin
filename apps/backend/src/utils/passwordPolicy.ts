// One password rule for every place a password is chosen (D3): admin invite acceptance, admin change-password and customer
// registration. 8–72: bcrypt only uses the first 72 BYTES, so a longer password is refused rather than silently cut.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** The reason a password is not allowed, or null when it is. Messages are shown to the user as they are. */
export function passwordProblem(password: unknown, email?: string | null): string | null {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required';
  if (Array.from(password).length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be at most ${PASSWORD_MAX_BYTES} characters (fewer if it uses accented letters or emoji)`;
  }
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) return 'Password must not be your email address';
  return null;
}
