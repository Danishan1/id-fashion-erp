import { randomBytes } from "node:crypto";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { encryptSecret } from "@/core/security/encryption";
import type { CrmActor } from "../core/crm-actor";
import { CUSTOM_FIELD_PREFIX, LEAD_TARGET_FIELD_KEYS } from "../ingestion/lead-field-catalog";
import { assertCaptureDefaults } from "./crm-api-keys.service";
import { CrmCaptureRepository } from "./crm-capture.repository";
import { createWebhookSchema, updateWebhookSchema } from "./crm-capture.schema";
import { getLeadProviderAdapter } from "./providers/registry";

/**
 * Incoming webhook endpoints. Each endpoint has its own URL
 * (/api/v1/crm/webhooks/leads/<provider>/<id>) and signing secret. The
 * secret is shown once (create / rotate) and stored encrypted with the
 * app's existing AES-GCM helper — it has to be recoverable to verify HMAC
 * signatures, unlike API keys which are only hashed.
 */
export const webhookPath = (provider: string, id: string) => `/api/v1/crm/webhooks/leads/${provider}/${id}`;
const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

function assertMapping(mapping: Record<string, string> | undefined) {
  for (const target of Object.keys(mapping ?? {})) {
    if (!LEAD_TARGET_FIELD_KEYS.has(target) && !target.startsWith(CUSTOM_FIELD_PREFIX)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${target}" is not a lead field.`, { fieldErrors: { fieldMapping: `Unknown field ${target}.` } });
    }
  }
}

export async function listWebhooks(actor: CrmActor) {
  return (await CrmCaptureRepository.listWebhooks(actor.companyId)).map((w) => ({ ...w, path: webhookPath(w.provider, w.id) }));
}

export async function createWebhook(actor: CrmActor, raw: unknown) {
  const input = createWebhookSchema.parse(raw);
  if (!getLeadProviderAdapter(input.provider)) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown provider "${input.provider}".`);
  assertMapping(input.fieldMapping);
  await assertCaptureDefaults(actor.companyId, input);
  const secret = newSecret();
  const record = await CrmCaptureRepository.createWebhook({
    companyId: actor.companyId,
    name: input.name,
    provider: input.provider,
    secretEncrypted: encryptSecret(secret),
    fieldMapping: input.fieldMapping ?? {},
    defaultSourceId: input.defaultSourceId ?? null,
    defaultOwnerUserId: input.defaultOwnerUserId ?? null,
    duplicatePolicy: input.duplicatePolicy ?? "UPDATE",
    createdByUserId: actor.userId,
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_endpoints", recordId: record.id, action: "CREATE", newValues: { name: record.name, provider: record.provider } });
  return { ...record, path: webhookPath(record.provider, record.id), secret };
}

export async function updateWebhook(actor: CrmActor, id: string, raw: unknown) {
  const input = updateWebhookSchema.parse(raw);
  const before = await CrmCaptureRepository.findWebhook(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.", { id });
  assertMapping(input.fieldMapping);
  await assertCaptureDefaults(actor.companyId, input);
  const after = await CrmCaptureRepository.updateWebhook(id, input);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_endpoints", recordId: id, action: "UPDATE", oldValues: before, newValues: after });
  return { ...after, path: webhookPath(after.provider, after.id) };
}

export async function rotateWebhookSecret(actor: CrmActor, id: string) {
  const before = await CrmCaptureRepository.findWebhook(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.", { id });
  const secret = newSecret();
  const after = await CrmCaptureRepository.updateWebhook(id, { secretEncrypted: encryptSecret(secret) });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_endpoints", recordId: id, action: "UPDATE", newValues: { secretRotated: true } });
  return { ...after, path: webhookPath(after.provider, after.id), secret };
}
