import { Prisma, type MarketingChannelConnection } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { auditDelivery, CONNECTIONS_TABLE, decryptSecrets, encryptSecrets, hintsFor, loadConnection, newWebhookToken, pickConfig, pickSecrets, runtimeOf, webhookPath } from "./delivery-common";
import { connectionCreateSchema, connectionUpdateSchema, MARKETING_PROVIDERS, type MarketingProviderKeyT } from "./delivery-registry";
import { defaultProviderDeps, getProviderAdapter, type ProviderDeps } from "./providers";

/**
 * Provider connections (Phase 10). Managed by Sales & Marketing settings
 * editors only (`sales_marketing_settings.edit`); campaign users pick
 * connections but never see credentials. Secrets are encrypted at rest,
 * write-only through the API and shown only as masked hints.
 */

/** What any API returns for a connection — no secrets, ever. */
export function presentConnection(c: MarketingChannelConnection, opts: { includeWebhook?: boolean } = {}) {
  const def = MARKETING_PROVIDERS[c.providerKey];
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    channelType: c.channelType,
    providerKey: c.providerKey,
    providerLabel: def.label,
    status: c.status,
    config: c.config as Record<string, string | number>,
    secretHints: c.secretHints as Record<string, string>,
    consentPolicy: c.consentPolicy,
    ratePerMinute: c.ratePerMinute,
    batchSize: c.batchSize,
    capabilities: def.capabilities,
    liveVerified: def.liveVerified,
    lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: c.lastTestStatus,
    lastTestMessage: c.lastTestMessage,
    circuitOpenUntil: c.circuitOpenUntil?.toISOString() ?? null,
    consecutiveFailures: c.consecutiveFailures,
    lastSendAt: c.lastSendAt?.toISOString() ?? null,
    webhookPath: opts.includeWebhook && def.capabilities.webhooks ? webhookPath(c.id, c.webhookToken) : null,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
export type ConnectionDto = ReturnType<typeof presentConnection>;

function assertValid(providerKey: MarketingProviderKeyT, config: Record<string, string | number>, secrets: Record<string, string>) {
  const def = MARKETING_PROVIDERS[providerKey];
  const errors = getProviderAdapter(providerKey).validateConfig(config, secrets);
  for (const f of def.fields) if (f.required && (config[f.key] == null || config[f.key] === "") && !errors[f.key]) errors[f.key] = `Enter ${f.label.toLowerCase()}.`;
  for (const f of def.secretFields) if (f.required && !secrets[f.key] && !errors[f.key]) errors[f.key] = `Enter ${f.label.toLowerCase()}.`;
  if (Object.keys(errors).length) throw new BusinessRuleError("VALIDATION_ERROR", "Fix the highlighted settings.", { fieldErrors: errors });
}

export async function listConnections(actor: SalesActor, filter: { channelType?: string; activeOnly?: boolean } = {}) {
  await PermissionService.assertAny(actor.userId, [
    ["sales_marketing_settings", "view"],
    ["marketing_delivery", "view"],
  ]);
  const canManage = await PermissionService.can(actor.userId, "sales_marketing_settings", "view");
  const rows = await prisma.marketingChannelConnection.findMany({
    where: { companyId: actor.companyId, ...(filter.channelType ? { channelType: filter.channelType as never } : {}), ...(filter.activeOnly ? { status: "ACTIVE" } : {}) },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return rows.map((r) => {
    const p = presentConnection(r, { includeWebhook: canManage });
    // Campaign users see what a connection can do, not how it's configured.
    return canManage ? p : { ...p, config: {}, secretHints: {} };
  });
}

export async function getConnection(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "view");
  return presentConnection(await loadConnection(actor.companyId, id), { includeWebhook: true });
}

export async function createConnection(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = connectionCreateSchema.parse(raw);
  const config = pickConfig(input.providerKey, input.config);
  const secrets = pickSecrets(input.providerKey, input.secrets);
  assertValid(input.providerKey, config, secrets);
  const code = input.code.toUpperCase();
  if (await prisma.marketingChannelConnection.findFirst({ where: { companyId: actor.companyId, code }, select: { id: true } })) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A connection with code ${code} already exists.`, { fieldErrors: { code: "Already used." } });
  }
  const def = MARKETING_PROVIDERS[input.providerKey];
  try {
    return await prisma.$transaction(async (tx) => {
      const c = await tx.marketingChannelConnection.create({
        data: {
          companyId: actor.companyId,
          code,
          name: input.name,
          description: input.description || null,
          channelType: def.channel,
          providerKey: input.providerKey,
          config: config as Prisma.InputJsonValue,
          secretsEncrypted: encryptSecrets(secrets),
          secretHints: hintsFor(secrets) as Prisma.InputJsonValue,
          webhookToken: newWebhookToken(),
          consentPolicy: input.consentPolicy,
          ratePerMinute: input.ratePerMinute,
          batchSize: input.batchSize,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      // Audit: settings and which secret fields are set — never their values.
      await auditDelivery(tx, actor, CONNECTIONS_TABLE, c.id, "CREATE", null, { code, name: c.name, providerKey: c.providerKey, channelType: c.channelType, config, secretsSet: Object.keys(hintsFor(secrets)), consentPolicy: c.consentPolicy, ratePerMinute: c.ratePerMinute, batchSize: c.batchSize });
      return presentConnection(c, { includeWebhook: true });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", `A connection with code ${code} already exists.`, { fieldErrors: { code: "Already used." } });
    throw e;
  }
}

export async function updateConnection(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = connectionUpdateSchema.parse(raw);
  const c = await loadConnection(actor.companyId, id);
  if (c.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This connection was changed by someone else. Reload and try again.");
  const config = pickConfig(c.providerKey, input.config);
  const replaced = pickSecrets(c.providerKey, input.secrets);
  const secrets = { ...decryptSecrets(c.secretsEncrypted), ...replaced };
  for (const [k, v] of Object.entries(replaced)) if (v === "") delete secrets[k];
  assertValid(c.providerKey, config, secrets);
  const rotated = Object.keys(replaced);
  return prisma.$transaction(async (tx) => {
    const res = await tx.marketingChannelConnection.updateMany({
      where: { id: c.id, version: c.version },
      data: {
        name: input.name,
        description: input.description || null,
        config: config as Prisma.InputJsonValue,
        ...(rotated.length ? { secretsEncrypted: encryptSecrets(secrets), secretHints: hintsFor(secrets) as Prisma.InputJsonValue } : {}),
        consentPolicy: input.consentPolicy,
        ratePerMinute: input.ratePerMinute,
        batchSize: input.batchSize,
        // A changed connection must be tested again; the breaker resets.
        ...(rotated.length || JSON.stringify(config) !== JSON.stringify(c.config) ? { lastTestStatus: null, lastTestMessage: null, lastTestedAt: null, consecutiveFailures: 0, circuitOpenUntil: null } : {}),
        updatedByUserId: actor.userId,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This connection was changed by someone else. Reload and try again.");
    await auditDelivery(tx, actor, CONNECTIONS_TABLE, c.id, "UPDATE", { name: c.name, config: c.config, consentPolicy: c.consentPolicy, ratePerMinute: c.ratePerMinute, batchSize: c.batchSize }, { name: input.name, config, consentPolicy: input.consentPolicy, ratePerMinute: input.ratePerMinute, batchSize: input.batchSize, credentialsRotated: rotated });
    return presentConnection(await tx.marketingChannelConnection.findUniqueOrThrow({ where: { id: c.id } }), { includeWebhook: true });
  });
}

export async function setConnectionStatus(actor: SalesActor, id: string, status: "ACTIVE" | "DISABLED") {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const c = await loadConnection(actor.companyId, id);
  if (c.status === status) return presentConnection(c, { includeWebhook: true });
  if (status === "DISABLED") {
    const open = await prisma.marketingDeliveryRun.count({ where: { connectionId: c.id, status: { in: ["SCHEDULED", "QUEUED", "RUNNING", "PREPARING"] } } });
    if (open) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", `${open} delivery run(s) on this connection are scheduled or sending. Cancel them first.`);
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.marketingChannelConnection.update({ where: { id: c.id }, data: { status, updatedByUserId: actor.userId, version: { increment: 1 }, ...(status === "ACTIVE" ? { consecutiveFailures: 0, circuitOpenUntil: null } : {}) } });
    await auditDelivery(tx, actor, CONNECTIONS_TABLE, c.id, "UPDATE", { status: c.status }, { status });
    return presentConnection(updated, { includeWebhook: true });
  });
}

/** Calls the provider (no message is sent). Stores only ok / failed and a safe message. */
export async function testConnection(actor: SalesActor, id: string, deps: ProviderDeps = defaultProviderDeps) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const c = await loadConnection(actor.companyId, id);
  const adapter = getProviderAdapter(c.providerKey);
  let result: { ok: boolean; message: string };
  try {
    result = await adapter.testConnection(runtimeOf(c), deps);
  } catch {
    result = { ok: false, message: "The connection test failed unexpectedly." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.marketingChannelConnection.update({ where: { id: c.id }, data: { lastTestedAt: new Date(), lastTestStatus: result.ok ? "OK" : "FAILED", lastTestMessage: result.message.slice(0, 300), ...(result.ok ? { consecutiveFailures: 0, circuitOpenUntil: null } : {}) } });
    await auditDelivery(tx, actor, CONNECTIONS_TABLE, c.id, "UPDATE", null, { connectionTest: result.ok ? "OK" : "FAILED", message: result.message.slice(0, 300) });
  });
  return result;
}

/** A new webhook URL token (the old URL stops working at once). */
export async function rotateWebhookToken(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const c = await loadConnection(actor.companyId, id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.marketingChannelConnection.update({ where: { id: c.id }, data: { webhookToken: newWebhookToken(), version: { increment: 1 } } });
    await auditDelivery(tx, actor, CONNECTIONS_TABLE, c.id, "UPDATE", null, { webhookUrlRotated: true });
    return presentConnection(updated, { includeWebhook: true });
  });
}
