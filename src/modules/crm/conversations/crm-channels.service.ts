import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { ProviderConfigError, receiveOnlyCapabilities, type ChannelCapabilities, type ChannelProvider, type ChannelType, type ProviderChannel } from "@/core/communication/CommunicationProvider";
import { channelProvidersFor, getChannelProvider } from "@/core/communication/provider-registry";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { decryptSecret, encryptSecret } from "@/core/security/encryption";
import type { CrmActor } from "../core/crm-actor";
import { assertAssignable } from "../activities/crm-activities.service";
import { CHANNEL_TYPE_LABELS, type ChannelStatus } from "./conversation-registry";
import { createChannelSchema, updateChannelSchema } from "./conversation.schema";
import { CrmConversationRepository, type ChannelRow } from "./crm-conversation.repository";

/**
 * Channels (CRM Settings → Channels, crm_settings permission). A channel is
 * one configured connection: its type, the provider adapter that serves it,
 * a private webhook URL + signing secret (shown once, stored encrypted —
 * the same AES-GCM helper as lead webhooks) and non-secret settings.
 */

export const conversationWebhookPath = (provider: string, id: string) => `/api/v1/crm/webhooks/conversations/${provider}/${id}`;
const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;
const config = (row: { config: Prisma.JsonValue }) => (row.config && typeof row.config === "object" && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : {});

export function providerOf(row: { provider: string }): ChannelProvider {
  const provider = getChannelProvider(row.provider);
  if (!provider) throw new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", "This channel's provider is not available in this version of the app.", { provider: row.provider });
  return provider;
}

/** What the channel can do right now (a paused channel can't send). */
export function channelCapabilities(row: { provider: string; channelType: string; status: string; config: Prisma.JsonValue }): ChannelCapabilities {
  const provider = getChannelProvider(row.provider);
  const base = provider ? provider.capabilities({ channelType: row.channelType as ChannelType, config: config(row) }) : { ...receiveOnlyCapabilities("This channel's provider is not available."), canReceive: false };
  if (row.status !== "ACTIVE") return { ...base, canSend: false, sendUnavailableReason: "This channel is paused. An admin can resume it in CRM Settings → Channels." };
  return base;
}

/** Server-only view of a channel for its provider (decrypted secret). Never returned to a client. */
export function providerChannel(row: { id: string; companyId: string; channelType: string; provider: string; address: string | null; config: Prisma.JsonValue }, secretEncrypted: string): ProviderChannel {
  return { id: row.id, companyId: row.companyId, channelType: row.channelType as ChannelType, provider: row.provider, address: row.address, config: config(row), secret: decryptSecret(secretEncrypted) };
}

export function presentChannel(row: ChannelRow) {
  const provider = getChannelProvider(row.provider);
  return {
    id: row.id,
    channelType: row.channelType,
    typeLabel: CHANNEL_TYPE_LABELS[row.channelType as ChannelType] ?? row.channelType,
    name: row.name,
    provider: row.provider,
    providerLabel: provider?.label ?? row.provider,
    status: row.status as ChannelStatus,
    address: row.address,
    config: config(row),
    defaultAssignee: row.defaultAssignee,
    lastInboundAt: row.lastInboundAt,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt,
    path: conversationWebhookPath(row.provider, row.id),
    capabilities: channelCapabilities(row),
  };
}
export type ChannelDto = ReturnType<typeof presentChannel>;

function validatedConfig(provider: ChannelProvider, channelType: ChannelType, raw: unknown) {
  try {
    return provider.validateConfig(channelType, raw ?? {});
  } catch (e) {
    if (e instanceof ProviderConfigError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { [e.field ?? "config"]: e.message } });
    throw e;
  }
}

async function assertUniqueName(companyId: string, name: string, exceptId?: string) {
  if (await CrmConversationRepository.channelNameTaken(companyId, name, exceptId)) throw new BusinessRuleError("VALIDATION_ERROR", `A channel named "${name}" already exists.`, { fieldErrors: { name: "Choose another name." } });
}

export async function listChannels(actor: CrmActor) {
  return (await CrmConversationRepository.listChannels(actor.companyId)).map(presentChannel);
}

/** For the inbox: channel filters and composer capabilities (no secrets, no config). */
export async function listInboxChannels(actor: CrmActor) {
  return (await CrmConversationRepository.listChannels(actor.companyId)).map((c) => {
    const p = presentChannel(c);
    return { id: p.id, name: p.name, channelType: p.channelType, typeLabel: p.typeLabel, status: p.status, capabilities: p.capabilities };
  });
}

export function channelSettingsMeta() {
  return { channelTypes: Object.entries(CHANNEL_TYPE_LABELS).map(([key, label]) => ({ key, label })), providers: channelProvidersFor() };
}

export async function createChannel(actor: CrmActor, raw: unknown) {
  const input = createChannelSchema.parse(raw);
  const provider = getChannelProvider(input.provider);
  if (!provider || !provider.channelTypes.includes(input.channelType)) throw new BusinessRuleError("VALIDATION_ERROR", `"${input.provider}" can't serve ${CHANNEL_TYPE_LABELS[input.channelType]} channels.`, { fieldErrors: { provider: "Choose another provider." } });
  await assertUniqueName(actor.companyId, input.name);
  const cfg = validatedConfig(provider, input.channelType, input.config);
  if (input.defaultAssigneeUserId) await assertAssignable(actor.companyId, input.defaultAssigneeUserId);
  const secret = newSecret();
  const row = await CrmConversationRepository.createChannel({
    companyId: actor.companyId,
    channelType: input.channelType,
    name: input.name,
    provider: provider.key,
    address: input.address?.trim() || null,
    config: cfg as Prisma.InputJsonValue,
    secretEncrypted: encryptSecret(secret),
    defaultAssigneeUserId: input.defaultAssigneeUserId ?? null,
    createdByUserId: actor.userId,
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_channels", recordId: row.id, action: "CREATE", newValues: { name: row.name, channelType: row.channelType, provider: row.provider, address: row.address, config: cfg } });
  // The secret is returned once, here; afterwards only its rotation can reveal a new one.
  return { ...presentChannel(row), secret };
}

export async function updateChannel(actor: CrmActor, id: string, raw: unknown) {
  const input = updateChannelSchema.parse(raw);
  const before = await CrmConversationRepository.findChannel(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Channel not found.", { id });
  const provider = providerOf(before);
  if (input.name !== undefined) await assertUniqueName(actor.companyId, input.name, id);
  const data: Prisma.CrmChannelUncheckedUpdateManyInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.address !== undefined) data.address = input.address?.trim() || null;
  if (input.status !== undefined) data.status = input.status;
  if (input.config !== undefined) data.config = validatedConfig(provider, before.channelType as ChannelType, input.config) as Prisma.InputJsonValue;
  if (input.defaultAssigneeUserId !== undefined) {
    if (input.defaultAssigneeUserId) await assertAssignable(actor.companyId, input.defaultAssigneeUserId);
    data.defaultAssigneeUserId = input.defaultAssigneeUserId;
  }
  const { count } = await CrmConversationRepository.updateChannelVersioned(id, input.version, data);
  if (!count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This channel was changed by someone else. Reload and try again.", { id });
  const after = (await CrmConversationRepository.findChannel(actor.companyId, id))!;
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_channels", recordId: id, action: "UPDATE", oldValues: { name: before.name, status: before.status, address: before.address, config: before.config, defaultAssigneeUserId: before.defaultAssigneeUserId }, newValues: data as Record<string, unknown> });
  return presentChannel(after);
}

export async function rotateChannelSecret(actor: CrmActor, id: string) {
  const before = await CrmConversationRepository.findChannel(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Channel not found.", { id });
  const secret = newSecret();
  const { count } = await CrmConversationRepository.updateChannelVersioned(id, before.version, { secretEncrypted: encryptSecret(secret) });
  if (!count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This channel was changed by someone else. Reload and try again.", { id });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_channels", recordId: id, action: "UPDATE", newValues: { secretRotated: true } });
  return { ...presentChannel((await CrmConversationRepository.findChannel(actor.companyId, id))!), secret };
}
