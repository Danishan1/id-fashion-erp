import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export const API_KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  defaultSourceId: true,
  defaultOwnerUserId: true,
  duplicatePolicy: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true } },
  defaultSource: { select: { id: true, name: true } },
  defaultOwner: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmApiKeySelect;

export const WEBHOOK_SELECT = {
  id: true,
  name: true,
  provider: true,
  fieldMapping: true,
  defaultSourceId: true,
  defaultOwnerUserId: true,
  duplicatePolicy: true,
  isActive: true,
  lastReceivedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true } },
  defaultSource: { select: { id: true, name: true } },
  defaultOwner: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmWebhookEndpointSelect;

export const EVENT_SELECT = {
  id: true,
  channel: true,
  provider: true,
  idempotencyKey: true,
  externalEventId: true,
  externalLeadId: true,
  status: true,
  outcome: true,
  outcomeReason: true,
  duplicateMatches: true,
  attempts: true,
  lastError: true,
  nextRetryAt: true,
  processedAt: true,
  receivedAt: true,
  apiKey: { select: { id: true, name: true, prefix: true } },
  webhookEndpoint: { select: { id: true, name: true } },
  lead: { select: { id: true, leadNumber: true, fullName: true } },
} satisfies Prisma.CrmIngestEventSelect;

export const CrmCaptureRepository = {
  listApiKeys: (companyId: string) => prisma.crmApiKey.findMany({ where: { companyId }, select: API_KEY_SELECT, orderBy: { createdAt: "desc" } }),
  createApiKey: (data: Prisma.CrmApiKeyUncheckedCreateInput) => prisma.crmApiKey.create({ data, select: API_KEY_SELECT }),
  findApiKey: (companyId: string, id: string) => prisma.crmApiKey.findFirst({ where: { companyId, id }, select: API_KEY_SELECT }),
  findApiKeyByPrefix: (prefix: string) => prisma.crmApiKey.findUnique({ where: { prefix }, select: { ...API_KEY_SELECT, companyId: true, keyHash: true, createdByUserId: true, createdBy: { select: { id: true, fullName: true, status: true } } } }),
  updateApiKey: (id: string, data: Prisma.CrmApiKeyUncheckedUpdateInput) => prisma.crmApiKey.update({ where: { id }, data, select: API_KEY_SELECT }),

  listWebhooks: (companyId: string) => prisma.crmWebhookEndpoint.findMany({ where: { companyId }, select: WEBHOOK_SELECT, orderBy: { createdAt: "desc" } }),
  createWebhook: (data: Prisma.CrmWebhookEndpointUncheckedCreateInput) => prisma.crmWebhookEndpoint.create({ data, select: WEBHOOK_SELECT }),
  findWebhook: (companyId: string, id: string) => prisma.crmWebhookEndpoint.findFirst({ where: { companyId, id }, select: WEBHOOK_SELECT }),
  /** Public receiver lookup: by id only (the id is the unguessable part of the URL; the signature is the authentication). */
  findWebhookForDelivery: (id: string) =>
    prisma.crmWebhookEndpoint.findUnique({ where: { id }, select: { ...WEBHOOK_SELECT, companyId: true, secretEncrypted: true, createdByUserId: true, createdBy: { select: { id: true, fullName: true, status: true } } } }),
  updateWebhook: (id: string, data: Prisma.CrmWebhookEndpointUncheckedUpdateInput) => prisma.crmWebhookEndpoint.update({ where: { id }, data, select: WEBHOOK_SELECT }),

  createEvent: (data: Prisma.CrmIngestEventUncheckedCreateInput) => prisma.crmIngestEvent.create({ data, select: { id: true } }),
  findEventByKey: (companyId: string, provider: string, idempotencyKey: string) =>
    prisma.crmIngestEvent.findUnique({ where: { companyId_provider_idempotencyKey: { companyId, provider, idempotencyKey } }, select: EVENT_SELECT }),
  findEvent: (where: Prisma.CrmIngestEventWhereInput) =>
    prisma.crmIngestEvent.findFirst({ where, select: { ...EVENT_SELECT, companyId: true, payload: true, apiKeyId: true, webhookEndpointId: true } }),
  updateEvent: (id: string, data: Prisma.CrmIngestEventUncheckedUpdateInput) => prisma.crmIngestEvent.update({ where: { id }, data, select: EVENT_SELECT }),
  listEvents: (where: Prisma.CrmIngestEventWhereInput, skip: number, take: number) =>
    Promise.all([prisma.crmIngestEvent.findMany({ where, select: EVENT_SELECT, orderBy: { receivedAt: "desc" }, skip, take }), prisma.crmIngestEvent.count({ where })]),
  activeUser: (companyId: string, id: string) => prisma.user.findFirst({ where: { id, companyId, status: "ACTIVE" }, select: { id: true } }),
  dueRetries: (now: Date) => prisma.crmIngestEvent.findMany({ where: { status: "FAILED", nextRetryAt: { lte: now } }, select: { id: true }, take: 100 }),
};
