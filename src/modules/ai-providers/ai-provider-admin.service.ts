import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import { encryptSecret, decryptSecret } from "@/core/security/encryption";
import { AIProviderRepository, AIProviderUsageRepository, AIFailoverLogRepository, utcStartOfDay, utcStartOfMonth } from "@/core/ai/provider-manager/ai-provider.repository";
import { testProviderConnection } from "@/core/ai/provider-manager/connection-test";
import type { AIProvider as AIProviderRow } from "@prisma/client";
import type { CreateAIProviderInput, UpdateAIProviderInput } from "./ai-provider.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

/** Masks a real secret down to a display-safe hint — the plaintext key is decrypted only long enough to build this string, never returned itself. */
function maskKey(plain: string): string {
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`;
}

/**
 * The only shape ever sent to the frontend — `apiKeyEncrypted` (the
 * ciphertext itself) is stripped entirely, replaced with `hasApiKey`/
 * `apiKeyMasked`. This is the enforcement point for "frontend को कभी
 * complete API key return मत करो" / "Masked value UI में दिखाओ" — every
 * route in this module returns through this function, never the raw
 * repository row.
 */
function toPublicShape(row: AIProviderRow) {
  const { apiKeyEncrypted, ...rest } = row;
  return {
    ...rest,
    hasApiKey: !!apiKeyEncrypted,
    apiKeyMasked: apiKeyEncrypted ? maskKey(decryptSecret(apiKeyEncrypted)) : null,
  };
}

async function getOwnedProvider(companyId: string, id: string) {
  const row = await AIProviderRepository.findAnyById(companyId, id);
  if (!row) throw new BusinessRuleError("NOT_FOUND", "AI provider not found.", { id });
  return row;
}

export async function listProviders(companyId: string) {
  const rows = await AIProviderRepository.findMany(companyId);
  return rows.map(toPublicShape);
}

export async function getProviderById(companyId: string, id: string) {
  return toPublicShape(await getOwnedProvider(companyId, id));
}

export async function createProvider(actor: ActorContext, input: CreateAIProviderInput) {
  try {
    const row = await AIProviderRepository.create({
      companyId: actor.companyId,
      name: input.name,
      providerType: input.providerType,
      apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null,
      model: input.model,
      baseUrl: input.baseUrl || null,
      isActive: input.isActive,
      priority: input.priority,
      autoFailoverEnabled: input.autoFailoverEnabled,
      dailyGenerationLimit: input.dailyGenerationLimit ?? null,
      monthlyGenerationLimit: input.monthlyGenerationLimit ?? null,
      requestTimeoutMs: input.requestTimeoutMs,
      maxRetryCount: input.maxRetryCount,
      capabilities: input.capabilities,
      createdByUserId: actor.userId,
    });

    // Deliberately never includes apiKey/apiKeyEncrypted — "logs में API
    // keys कभी print मत करो" applies to the audit trail too, not just
    // console/server logs.
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_providers",
      recordId: row.id,
      action: "CREATE",
      newValues: { name: row.name, providerType: row.providerType, model: row.model, capabilities: row.capabilities, hasApiKey: !!row.apiKeyEncrypted },
    });

    return toPublicShape(row);
  } catch (err) {
    if (isUniqueConstraintViolationOnColumn(err, "name")) {
      throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `A provider named "${input.name}" already exists.`, { name: input.name });
    }
    throw err;
  }
}

export async function updateProvider(actor: ActorContext, id: string, input: UpdateAIProviderInput) {
  const existing = await getOwnedProvider(actor.companyId, id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.providerType !== undefined) data.providerType = input.providerType;
  // Three-state: omitted (key absent from this partial payload) leaves the
  // stored key untouched; "" explicitly clears it; anything else replaces
  // it — see the schema's own comment on why this can't be expressed by
  // Zod's optional() alone.
  if (input.apiKey !== undefined) data.apiKeyEncrypted = input.apiKey ? encryptSecret(input.apiKey) : null;
  if (input.model !== undefined) data.model = input.model;
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.autoFailoverEnabled !== undefined) data.autoFailoverEnabled = input.autoFailoverEnabled;
  if (input.dailyGenerationLimit !== undefined) data.dailyGenerationLimit = input.dailyGenerationLimit ?? null;
  if (input.monthlyGenerationLimit !== undefined) data.monthlyGenerationLimit = input.monthlyGenerationLimit ?? null;
  if (input.requestTimeoutMs !== undefined) data.requestTimeoutMs = input.requestTimeoutMs;
  if (input.maxRetryCount !== undefined) data.maxRetryCount = input.maxRetryCount;
  if (input.capabilities !== undefined) data.capabilities = input.capabilities;

  try {
    const updated = await AIProviderRepository.update(id, data);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_providers",
      recordId: id,
      action: "UPDATE",
      oldValues: { name: existing.name, isActive: existing.isActive, priority: existing.priority, capabilities: existing.capabilities },
      newValues: { ...data, apiKeyEncrypted: data.apiKeyEncrypted !== undefined ? "[changed]" : undefined },
    });

    return toPublicShape(updated);
  } catch (err) {
    if (isUniqueConstraintViolationOnColumn(err, "name")) {
      throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `A provider named "${input.name}" already exists.`, { name: input.name });
    }
    throw err;
  }
}

export async function deleteProvider(actor: ActorContext, id: string) {
  const existing = await getOwnedProvider(actor.companyId, id);
  await AIProviderRepository.delete(id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_providers",
    recordId: id,
    action: "DELETE",
    oldValues: { name: existing.name, providerType: existing.providerType },
  });
}

export async function testConnection(actor: ActorContext, id: string) {
  const existing = await getOwnedProvider(actor.companyId, id);
  return testProviderConnection(existing);
}

/** Manual override for an admin who has fixed a credential/outage — clears AUTH_ERROR/QUOTA_EXHAUSTED/etc. back to HEALTHY without waiting for a timed cooldown or another real request to happen to succeed. */
export async function resetProviderHealth(actor: ActorContext, id: string) {
  await getOwnedProvider(actor.companyId, id);
  const updated = await AIProviderRepository.resetHealth(id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_providers",
    recordId: id,
    action: "UPDATE",
    newValues: { healthStatus: "HEALTHY", reset: true },
  });

  return toPublicShape(updated);
}

/**
 * The real usage dashboard — every count here is genuinely tracked locally
 * from `AIProviderUsage` rows this app itself wrote. `providerBalance` is
 * always null: none of OpenAI/Gemini/Cloudflare/a self-hosted Qwen server
 * expose a "remaining credit balance" API this integration calls anywhere
 * — fabricating a number here would violate the explicit "जहां provider
 * API वास्तविक credit information नहीं देता, वहां fabricated credit
 * balance मत दिखाना" requirement. The UI renders this as "Provider
 * balance: Not available" rather than hiding the field.
 */
export async function getUsageDashboard(companyId: string) {
  const providers = await AIProviderRepository.findMany(companyId);
  const startOfDay = utcStartOfDay();
  const startOfMonth = utcStartOfMonth();

  return Promise.all(
    providers.map(async (p) => ({
      id: p.id,
      name: p.name,
      providerType: p.providerType,
      isActive: p.isActive,
      healthStatus: p.healthStatus,
      cooldownUntil: p.cooldownUntil,
      capabilities: p.capabilities,
      usedToday: await AIProviderUsageRepository.countSince(p.id, startOfDay),
      usedThisMonth: await AIProviderUsageRepository.countSince(p.id, startOfMonth),
      dailyGenerationLimit: p.dailyGenerationLimit,
      monthlyGenerationLimit: p.monthlyGenerationLimit,
      providerBalance: null as null,
    }))
  );
}

export async function getFailoverLogs(companyId: string, limit = 50) {
  return AIFailoverLogRepository.findRecent(companyId, limit);
}

export async function getRecentUsage(companyId: string, limit = 50) {
  return AIProviderUsageRepository.findRecent(companyId, limit);
}
