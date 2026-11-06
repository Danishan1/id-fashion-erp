import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateApiKey, hashApiKey, parseApiKey } from "@/modules/crm/capture/crm-api-keys.service";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { SM_API_KEY_PURPOSE, SM_API_LIMITS, SM_API_SCOPES, SM_API_SCOPE_KEYS, type SmApiScope } from "./integration-registry";
import { ensureRegistryRow, setRegistryStatus } from "./integration-registry.service";

/**
 * Phase 16 — S&M API keys. Same table, format (crmk_<prefix>_<secret>) and
 * SHA-256 hashing as the CRM lead-capture keys, with purpose
 * SALES_MARKETING_API and explicit scopes. A key acts as the user who created
 * it: a scope can only be granted by someone who holds its permission, and on
 * every call the key needs the scope AND its user's current permission and
 * record visibility. The full key is returned once (create / rotate).
 */

const TABLE = "crm_api_keys";
const SAFE = {
  id: true,
  name: true,
  description: true,
  prefix: true,
  scopes: true,
  rateLimitPerMinute: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  rotatedFromId: true,
  createdAt: true,
  createdByUserId: true,
  createdBy: { select: { id: true, fullName: true, status: true } },
} satisfies Prisma.CrmApiKeySelect;
type SafeKey = Prisma.CrmApiKeyGetPayload<{ select: typeof SAFE }>;

const scopes = z
  .array(z.enum(SM_API_SCOPE_KEYS))
  .min(1, "Choose at least one scope.")
  .transform((v) => [...new Set(v)]);
const expiry = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .optional()
  .or(z.literal(""))
  .nullable();

export const smKeyCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    description: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
    scopes,
    expiresAt: expiry,
    rateLimitPerMinute: z.coerce.number().int().min(1).max(600).optional().nullable(),
  })
  .strict();
export const smKeyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
    scopes: scopes.optional(),
    expiresAt: expiry,
    rateLimitPerMinute: z.coerce.number().int().min(1).max(600).optional().nullable(),
  })
  .strict();
export const smKeyRotateSchema = z.object({ graceHours: z.coerce.number().int().min(0).max(72).default(0) }).strict();

const endOfDayIst = (d: string) => new Date(`${d}T23:59:59+05:30`);

function assertExpiry(d: string | null | undefined) {
  if (!d) return null;
  const at = endOfDayIst(d);
  if (at.getTime() <= Date.now()) throw new BusinessRuleError("VALIDATION_ERROR", "The expiry must be in the future.", { fieldErrors: { expiresAt: "In the past." } });
  if (at.getTime() > Date.now() + 2 * 366 * 86_400_000) throw new BusinessRuleError("VALIDATION_ERROR", "A key can be valid for at most two years.", { fieldErrors: { expiresAt: "Too far ahead." } });
  return at;
}

/** Least privilege: nobody grants a scope whose permission they don't hold themselves. */
async function assertCanGrant(userId: string, list: readonly SmApiScope[]) {
  for (const s of list) {
    const p = SM_API_SCOPES[s].permission;
    if (!(await PermissionService.can(userId, p.module as never, p.action as never)))
      throw new BusinessRuleError("PERMISSION_DENIED", `You can't grant "${SM_API_SCOPES[s].label}" — it needs ${p.module}.${p.action}, which you don't have.`, { fieldErrors: { scopes: `Needs ${p.module}.${p.action}.` } });
  }
}

export function keyState(k: { revokedAt: Date | null; expiresAt: Date | null; createdBy: { status: string } }, now = new Date()) {
  if (k.revokedAt) return "REVOKED" as const;
  if (k.expiresAt && k.expiresAt <= now) return "EXPIRED" as const;
  if (k.createdBy.status !== "ACTIVE") return "OWNER_INACTIVE" as const;
  return "ACTIVE" as const;
}

export function presentKey(k: SafeKey) {
  return {
    id: k.id,
    name: k.name,
    description: k.description,
    // Only the public prefix, never the key.
    keyPreview: `crmk_${k.prefix}_••••••••`,
    scopes: k.scopes,
    rateLimitPerMinute: k.rateLimitPerMinute ?? SM_API_LIMITS.defaultPerKeyPerMinute,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    rotatedFromId: k.rotatedFromId,
    createdAt: k.createdAt,
    actsAs: { id: k.createdBy.id, name: k.createdBy.fullName },
    state: keyState(k),
  };
}
export type SmApiKeyDto = ReturnType<typeof presentKey>;

async function load(actor: SalesActor, id: string) {
  const k = await prisma.crmApiKey.findFirst({ where: { id, companyId: actor.companyId, purpose: SM_API_KEY_PURPOSE }, select: SAFE });
  if (!k) throw new BusinessRuleError("NOT_FOUND", "API key not found.", { id });
  return k;
}

export async function listSmApiKeys(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  const rows = await prisma.crmApiKey.findMany({ where: { companyId: actor.companyId, purpose: SM_API_KEY_PURPOSE }, select: SAFE, orderBy: { createdAt: "desc" } });
  return rows.map(presentKey);
}

export async function getSmApiKey(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  return presentKey(await load(actor, id));
}

/** Creates a key; the response is the only place the full key is ever returned. */
export async function createSmApiKey(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "edit");
  const input = smKeyCreateSchema.parse(raw);
  await assertCanGrant(actor.userId, input.scopes);
  const expiresAt = assertExpiry(input.expiresAt);
  const active = await prisma.crmApiKey.count({ where: { companyId: actor.companyId, purpose: SM_API_KEY_PURPOSE, revokedAt: null } });
  if (active >= SM_API_LIMITS.maxKeysPerCompany) throw new BusinessRuleError("VALIDATION_ERROR", `A company can have at most ${SM_API_LIMITS.maxKeysPerCompany} active S&M API keys. Revoke one first.`);
  const { prefix, key } = generateApiKey();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.crmApiKey.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        description: input.description || null,
        prefix,
        keyHash: hashApiKey(key),
        scopes: input.scopes,
        purpose: SM_API_KEY_PURPOSE,
        rateLimitPerMinute: input.rateLimitPerMinute ?? null,
        expiresAt,
        createdByUserId: actor.userId,
      },
      select: SAFE,
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: created.id, action: "CREATE", newValues: { purpose: SM_API_KEY_PURPOSE, name: created.name, prefix, scopes: created.scopes, expiresAt, key: "generated" } }, tx);
    return created;
  });
  await ensureRegistryRow(actor.companyId, "API_CLIENT", row.id);
  return { ...presentKey(row), keyOnce: key };
}

export async function updateSmApiKey(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "edit");
  const input = smKeyUpdateSchema.parse(raw);
  const before = await load(actor, id);
  if (before.revokedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This key has been revoked.");
  // Adding a scope is granting it: the editor needs its permission. Removing never needs anything.
  if (input.scopes) await assertCanGrant(actor.userId, input.scopes.filter((s) => !before.scopes.includes(s)));
  const data: Prisma.CrmApiKeyUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.scopes !== undefined) data.scopes = input.scopes;
  if (input.expiresAt !== undefined) data.expiresAt = assertExpiry(input.expiresAt);
  if (input.rateLimitPerMinute !== undefined) data.rateLimitPerMinute = input.rateLimitPerMinute;
  const after = await prisma.crmApiKey.update({ where: { id: before.id }, data, select: SAFE });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: TABLE,
    recordId: id,
    action: "UPDATE",
    oldValues: { name: before.name, scopes: before.scopes, expiresAt: before.expiresAt, rateLimitPerMinute: before.rateLimitPerMinute },
    newValues: { name: after.name, scopes: after.scopes, expiresAt: after.expiresAt, rateLimitPerMinute: after.rateLimitPerMinute },
  });
  return presentKey(after);
}

/**
 * Issues a replacement key with the same scopes and limits. The old key stops
 * now (graceHours 0) or at the end of the grace period, so the client can
 * switch without downtime. The new key is returned once.
 */
export async function rotateSmApiKey(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "edit");
  const { graceHours } = smKeyRotateSchema.parse(raw ?? {});
  const old = await load(actor, id);
  if (keyState(old) === "REVOKED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This key has been revoked.");
  // The new key acts as the person rotating it, so they must hold every scope.
  await assertCanGrant(actor.userId, old.scopes as SmApiScope[]);
  const { prefix, key } = generateApiKey();
  const now = new Date();
  const oldUntil = graceHours ? new Date(now.getTime() + graceHours * 3_600_000) : now;
  const created = await prisma.$transaction(async (tx) => {
    const k = await tx.crmApiKey.create({
      data: {
        companyId: actor.companyId,
        name: old.name,
        description: old.description,
        prefix,
        keyHash: hashApiKey(key),
        scopes: old.scopes,
        purpose: SM_API_KEY_PURPOSE,
        rateLimitPerMinute: old.rateLimitPerMinute,
        expiresAt: old.expiresAt && old.expiresAt > now ? old.expiresAt : null,
        rotatedFromId: old.id,
        createdByUserId: actor.userId,
      },
      select: SAFE,
    });
    await tx.crmApiKey.update({ where: { id: old.id }, data: graceHours ? { expiresAt: old.expiresAt && old.expiresAt < oldUntil ? old.expiresAt : oldUntil } : { revokedAt: now } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: old.id, action: "UPDATE", newValues: { rotatedTo: k.id, graceHours, oldKeyStopsAt: oldUntil, key: "rotated" } }, tx);
    return k;
  });
  await ensureRegistryRow(actor.companyId, "API_CLIENT", created.id, { credentialRotatedAt: now });
  if (!graceHours) await setRegistryStatus(actor.companyId, "API_CLIENT", old.id, "REVOKED", "Replaced by a rotated key.");
  return { ...presentKey(created), keyOnce: key, previousKeyStopsAt: oldUntil };
}

/** Revokes a key at once (sales_integrations.approve). Final. */
export async function revokeSmApiKey(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "approve");
  const { reason } = z.object({ reason: z.string().trim().min(3, "Say why.").max(300) }).strict().parse(raw ?? {});
  const k = await load(actor, id);
  if (k.revokedAt) return presentKey(k);
  const after = await prisma.crmApiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() }, select: SAFE });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { revokedAt: null }, newValues: { revokedAt: after.revokedAt, reason } });
  await setRegistryStatus(actor.companyId, "API_CLIENT", id, "REVOKED", reason);
  return presentKey(after);
}

export interface ApiKeyIdentity {
  keyId: string;
  companyId: string;
  userId: string;
  name: string;
  scopes: SmApiScope[];
  rateLimitPerMinute: number;
}

/**
 * Resolves a presented S&M key, or null (unknown, wrong secret, wrong purpose,
 * revoked, expired, owner inactive, or the integration is disabled). Constant-
 * time hash comparison. Never says which of these it was.
 */
export async function authenticateSmApiKey(presented: string | null | undefined, now = new Date()): Promise<ApiKeyIdentity | null> {
  const m = parseApiKey(presented);
  if (!m) return null;
  const record = await prisma.crmApiKey.findUnique({
    where: { prefix: m[1] },
    select: { id: true, companyId: true, name: true, keyHash: true, purpose: true, scopes: true, rateLimitPerMinute: true, revokedAt: true, expiresAt: true, lastUsedAt: true, createdByUserId: true, createdBy: { select: { status: true } } },
  });
  if (!record) return null;
  const a = Buffer.from(record.keyHash, "hex");
  const b = Buffer.from(hashApiKey(presented!.trim()), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (record.purpose !== SM_API_KEY_PURPOSE || keyState(record, now) !== "ACTIVE") return null;
  const reg = await prisma.integration.findUnique({ where: { companyId_resourceType_resourceId: { companyId: record.companyId, resourceType: "crm_api_keys", resourceId: record.id } }, select: { status: true } });
  if (reg && (reg.status === "DISABLED" || reg.status === "REVOKED")) return null;
  if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > 60_000) {
    await prisma.crmApiKey.update({ where: { id: record.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
  return {
    keyId: record.id,
    companyId: record.companyId,
    userId: record.createdByUserId,
    name: record.name,
    scopes: record.scopes.filter((s): s is SmApiScope => s in SM_API_SCOPES),
    rateLimitPerMinute: record.rateLimitPerMinute ?? SM_API_LIMITS.defaultPerKeyPerMinute,
  };
}
