import { prisma } from "@/core/db/client";
import type { AdConnectionStatus, AdPlatform } from "@prisma/client";

// Every repository function whose result can reach a client-facing API
// response deliberately `select`s this exact allow-list rather than
// `include`s — the encrypted access/refresh tokens can never accidentally
// leak into a response this way, unlike a blanket `include` that a future
// edit could regress. Only `findAnyById` (used solely by the sync/decrypt
// internals, never returned to a route handler as-is) includes the token
// columns.
const SAFE_SELECT = {
  id: true,
  platform: true,
  externalAccountId: true,
  accountName: true,
  status: true,
  lastSyncedAt: true,
  lastSyncError: true,
  createdAt: true,
} as const;

export const AdAccountConnectionRepository = {
  findMany: (companyId: string) =>
    prisma.adAccountConnection.findMany({
      where: { companyId },
      select: {
        ...SAFE_SELECT,
        connectedBy: { select: { fullName: true } },
        campaignLinks: {
          select: { id: true, externalCampaignId: true, externalCampaignName: true, localCampaign: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),

  findAnyById: (companyId: string, id: string) =>
    prisma.adAccountConnection.findFirst({
      where: { id, companyId },
      include: { campaignLinks: true },
    }),

  findByExternalAccount: (companyId: string, platform: AdPlatform, externalAccountId: string) =>
    prisma.adAccountConnection.findUnique({
      where: { companyId_platform_externalAccountId: { companyId, platform, externalAccountId } },
    }),

  upsertByExternalAccount: (data: {
    companyId: string;
    platform: AdPlatform;
    externalAccountId: string;
    accountName: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    tokenExpiresAt: Date | null;
    connectedByUserId: string;
  }) =>
    prisma.adAccountConnection.upsert({
      where: { companyId_platform_externalAccountId: { companyId: data.companyId, platform: data.platform, externalAccountId: data.externalAccountId } },
      create: { ...data, status: "CONNECTED" },
      update: {
        accountName: data.accountName,
        accessTokenEncrypted: data.accessTokenEncrypted,
        refreshTokenEncrypted: data.refreshTokenEncrypted,
        tokenExpiresAt: data.tokenExpiresAt,
        status: "CONNECTED",
        lastSyncError: null,
      },
      select: SAFE_SELECT,
    }),

  updateTokens: (id: string, data: { accessTokenEncrypted: string; refreshTokenEncrypted?: string | null; tokenExpiresAt: Date | null }) =>
    prisma.adAccountConnection.update({ where: { id }, data }),

  updateSyncResult: (id: string, data: { status: AdConnectionStatus; lastSyncedAt: Date | null; lastSyncError: string | null }) =>
    prisma.adAccountConnection.update({ where: { id }, data }),

  updateStatus: (id: string, status: AdConnectionStatus) => prisma.adAccountConnection.update({ where: { id }, data: { status }, select: SAFE_SELECT }),
};

export const AdCampaignLinkRepository = {
  upsertExternalCampaign: (connectionId: string, externalCampaignId: string, externalCampaignName: string) =>
    prisma.adCampaignLink.upsert({
      where: { connectionId_externalCampaignId: { connectionId, externalCampaignId } },
      create: { connectionId, externalCampaignId, externalCampaignName },
      update: { externalCampaignName },
    }),

  findByIdInConnection: (connectionId: string, linkId: string) => prisma.adCampaignLink.findFirst({ where: { id: linkId, connectionId } }),

  setLocalCampaign: (id: string, localCampaignId: string | null) => prisma.adCampaignLink.update({ where: { id }, data: { localCampaignId } }),
};
