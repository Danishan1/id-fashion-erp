import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signs/verifies the OAuth `state` param for the ad-integrations connect
 * flow (CSRF protection + a way to carry companyId/userId/platform through
 * the redirect round-trip without a server-side session table). HMAC-SHA256
 * over `AUTH_SECRET` (NextAuth v5's own env var; `NEXTAUTH_SECRET` is
 * accepted too) — no new dependency, no new env var, and no DB row
 * to expire/clean up.
 */
interface OAuthStatePayload {
  companyId: string;
  userId: string;
  platform: "META" | "GOOGLE";
  issuedAt: number;
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function getSecret(): string {
  // AUTH_SECRET is NextAuth v5's own env var name (what this app actually
  // sets); NEXTAUTH_SECRET is accepted too, for anyone who set the older name.
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to sign OAuth state.");
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function signOAuthState(payload: Omit<OAuthStatePayload, "issuedAt">): string {
  const body = JSON.stringify({ ...payload, issuedAt: Date.now() });
  const encodedBody = Buffer.from(body, "utf8").toString("base64url");
  return `${encodedBody}.${sign(encodedBody)}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [encodedBody, signature] = state.split(".");
  if (!encodedBody || !signature) return null;

  const expectedSignature = sign(encodedBody);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8")) as OAuthStatePayload;
    if (Date.now() - payload.issuedAt > STATE_MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}
