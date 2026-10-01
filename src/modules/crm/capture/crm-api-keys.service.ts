import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { getLeadSourceForCompany } from "../settings/crm-settings.service";
import { CrmCaptureRepository } from "./crm-capture.repository";
import { createApiKeySchema, updateApiKeySchema } from "./crm-capture.schema";

/**
 * API keys for POST /api/v1/crm/leads/ingest. Format: crmk_<12 hex prefix>_<32 char secret>.
 * Only the SHA-256 hash is stored; the full key is returned once, at
 * creation. Keys are scoped to lead ingestion and can be revoked at any time.
 */
const KEY_RE = /^crmk_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/;
export const API_KEY_SCOPE = "leads:ingest";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey() {
  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  return { prefix, key: `crmk_${prefix}_${secret}` };
}

export async function assertCaptureDefaults(companyId: string, input: { defaultSourceId?: string | null; defaultOwnerUserId?: string | null }) {
  if (input.defaultSourceId) {
    const s = await getLeadSourceForCompany(companyId, input.defaultSourceId);
    if (!s.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `"${s.name}" is no longer in use.`, { fieldErrors: { defaultSourceId: "Choose an active source." } });
  }
  if (input.defaultOwnerUserId && !(await CrmCaptureRepository.activeUser(companyId, input.defaultOwnerUserId))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The default owner must be an active user.", { fieldErrors: { defaultOwnerUserId: "Choose an active user." } });
  }
}

export function listApiKeys(actor: CrmActor) {
  return CrmCaptureRepository.listApiKeys(actor.companyId);
}

export async function createApiKey(actor: CrmActor, raw: unknown) {
  const input = createApiKeySchema.parse(raw);
  await assertCaptureDefaults(actor.companyId, input);
  const { prefix, key } = generateApiKey();
  const record = await CrmCaptureRepository.createApiKey({
    companyId: actor.companyId,
    name: input.name,
    prefix,
    keyHash: hashKey(key),
    scopes: [API_KEY_SCOPE],
    defaultSourceId: input.defaultSourceId ?? null,
    defaultOwnerUserId: input.defaultOwnerUserId ?? null,
    duplicatePolicy: input.duplicatePolicy ?? "UPDATE",
    expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59+05:30`) : null,
    createdByUserId: actor.userId,
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_api_keys", recordId: record.id, action: "CREATE", newValues: { name: record.name, prefix, scopes: record.scopes } });
  return { ...record, key };
}

export async function updateApiKey(actor: CrmActor, id: string, raw: unknown) {
  const input = updateApiKeySchema.parse(raw);
  const before = await CrmCaptureRepository.findApiKey(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "API key not found.", { id });
  if (before.revokedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This key has been revoked.");
  await assertCaptureDefaults(actor.companyId, input);
  const after = await CrmCaptureRepository.updateApiKey(id, input);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_api_keys", recordId: id, action: "UPDATE", oldValues: before, newValues: after });
  return after;
}

export async function revokeApiKey(actor: CrmActor, id: string) {
  const before = await CrmCaptureRepository.findApiKey(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "API key not found.", { id });
  if (before.revokedAt) return before;
  const after = await CrmCaptureRepository.updateApiKey(id, { revokedAt: new Date() });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_api_keys", recordId: id, action: "UPDATE", oldValues: { revokedAt: null }, newValues: { revokedAt: after.revokedAt } });
  return after;
}

/** Resolves a presented key to its record, or null (unknown, wrong secret, revoked, expired). Constant-time hash compare. */
export async function authenticateApiKey(presented: string | null | undefined) {
  const m = presented?.trim().match(KEY_RE);
  if (!m) return null;
  const record = await CrmCaptureRepository.findApiKeyByPrefix(m[1]);
  if (!record) return null;
  const a = Buffer.from(record.keyHash, "hex");
  const b = Buffer.from(hashKey(presented!.trim()), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) return null;
  // A key stops working when the person who created it is deactivated.
  if (record.createdBy.status !== "ACTIVE") return null;
  if (!record.scopes.includes(API_KEY_SCOPE)) return null;
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
    await CrmCaptureRepository.updateApiKey(record.id, { lastUsedAt: new Date() }).catch(() => undefined);
  }
  return record;
}
