import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * AES-256-GCM at-rest encryption for secrets that must never sit in plaintext
 * in Postgres (AI provider keys, CRM channel and webhook secrets) — a
 * materially different risk than this app's own internal data. No new env
 * var: the key is derived by hashing the existing `NEXTAUTH_SECRET` down to
 * 32 bytes, so there's nothing extra to configure or accidentally leave unset
 * in a deployment — the same secret this app already trusts to sign sessions.
 *
 * Output format is `iv:authTag:ciphertext`, each base64 — self-contained, so
 * a future key rotation just needs the old key kept around for decrypt-only.
 */
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  // AUTH_SECRET is NextAuth v5's own env var name (what this app actually
  // sets); NEXTAUTH_SECRET is accepted too, for anyone who set the older name.
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET must be set to encrypt or decrypt stored secrets.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(cipherText: string): string {
  const [ivB64, authTagB64, dataB64] = cipherText.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed encrypted value.");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
