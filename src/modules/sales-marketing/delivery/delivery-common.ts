import { createHmac, randomBytes } from "crypto";
import type { MarketingChannelConnection, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { decryptSecret, encryptSecret } from "@/core/security/encryption";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { MARKETING_PROVIDERS, type MarketingProviderKeyT } from "./delivery-registry";
import type { ConnectionRuntime } from "./providers/provider-contract";

/**
 * Shared delivery helpers (Phase 10): secrets (encrypted at rest, never
 * returned), connection loading, audit, history events, public URLs and the
 * unsubscribe token.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const CONNECTIONS_TABLE = "marketing_channel_connections";
export const RUNS_TABLE = "marketing_delivery_runs";

// ── Secrets ────────────────────────────────────────────────────────

export function encryptSecrets(secrets: Record<string, string>): string | null {
  const clean = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ""));
  return Object.keys(clean).length ? encryptSecret(JSON.stringify(clean)) : null;
}

export function decryptSecrets(cipher: string | null): Record<string, string> {
  if (!cipher) return {};
  try {
    const v = JSON.parse(decryptSecret(cipher)) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "The stored credentials can't be read (the server's secret key changed?). Enter them again.");
  }
}

/** "••••1234" for display — never more than the last 4 characters, nothing for short values. */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : "••••";
}

export function hintsFor(secrets: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(secrets).filter(([, v]) => v).map(([k, v]) => [k, maskSecret(v)]));
}

/** Only keys an adapter declares, so no unexpected value is ever stored. */
export function pickSecrets(providerKey: MarketingProviderKeyT, raw: Record<string, string>): Record<string, string> {
  const allowed = new Set<string>(MARKETING_PROVIDERS[providerKey].secretFields.map((f) => f.key));
  const extra = Object.keys(raw).filter((k) => !allowed.has(k));
  if (extra.length) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown credential field ${extra.join(", ")}.`);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.trim()]));
}

export function pickConfig(providerKey: MarketingProviderKeyT, raw: Record<string, string | number>): Record<string, string | number> {
  const allowed = new Set<string>(MARKETING_PROVIDERS[providerKey].fields.map((f) => f.key));
  const extra = Object.keys(raw).filter((k) => !allowed.has(k));
  if (extra.length) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown setting ${extra.join(", ")}.`);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== ""));
}

export function runtimeOf(c: Pick<MarketingChannelConnection, "id" | "companyId" | "config" | "secretsEncrypted">): ConnectionRuntime {
  return { id: c.id, companyId: c.companyId, config: (c.config ?? {}) as Record<string, string | number>, secrets: decryptSecrets(c.secretsEncrypted) };
}

export function newWebhookToken() {
  return randomBytes(24).toString("hex");
}

// ── Loading ────────────────────────────────────────────────────────

export async function loadConnection(companyId: string, id: string, db: Db = prisma): Promise<MarketingChannelConnection> {
  const c = await db.marketingChannelConnection.findFirst({ where: { id, companyId } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Channel connection not found.", { id });
  return c;
}

// ── Audit and history ─────────────────────────────────────────────

export function auditDelivery(tx: Db, actor: { companyId: string; userId: string | null }, tableName: string, recordId: string, action: "CREATE" | "UPDATE" | "DELETE", oldValues: unknown, newValues: unknown) {
  return writeAuditLog(
    { companyId: actor.companyId, userId: actor.userId ?? undefined, tableName, recordId, action, oldValues: (oldValues ?? null) as Record<string, unknown> | null, newValues: (newValues ?? null) as Record<string, unknown> | null },
    tx as Prisma.TransactionClient
  );
}

/** Campaign history row (sales_performance_events, entity CAMPAIGN), as Phase 08 does. */
export function recordDeliveryCampaignEvent(tx: Db, actor: { companyId: string; userId: string }, campaignId: string, type: string, comment: string | null, metadata: Record<string, unknown>) {
  return tx.salesPerformanceEvent.create({
    data: { companyId: actor.companyId, entityType: "CAMPAIGN", entityId: campaignId, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

// ── Public URLs ────────────────────────────────────────────────────

/** Absolute base URL for links in messages (unsubscribe). APP_BASE_URL, else the auth URL. */
export function publicBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export const webhookPath = (connectionId: string, token: string) => `/api/v1/sales-marketing/delivery/webhooks/${connectionId}/${token}`;
export const unsubscribePath = (token: string) => `/api/v1/public/marketing/unsubscribe/${token}`;

// ── Unsubscribe token ─────────────────────────────────────────────

function tokenKey(): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to sign unsubscribe links.");
  return createHmac("sha256", secret).update("marketing-unsubscribe-v1").digest();
}

/** `<delivery id hex>.<hmac>` — can't be guessed or altered, carries no personal data. */
export function signUnsubscribeToken(deliveryId: string): string {
  const id = deliveryId.replace(/-/g, "");
  const mac = createHmac("sha256", tokenKey()).update(id).digest("base64url").slice(0, 32);
  return `${id}.${mac}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!m) return null;
  const expected = createHmac("sha256", tokenKey()).update(m[1]).digest("base64url").slice(0, 32);
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  if (diff !== 0) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type DeliveryActor = SalesActor;
