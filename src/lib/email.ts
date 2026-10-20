/**
 * Login emails are stored and compared lower-case (P2, 2026-10-21), so
 * "Ravi@X.com" and "ravi@x.com" are always the same login.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
