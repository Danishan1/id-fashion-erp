import { prisma } from "@/core/db/client";

export const CrmSettingsRepository = {
  findByCompany: (companyId: string) => prisma.crmSettings.findUnique({ where: { companyId } }),

  upsert: (companyId: string, data: { hotThreshold: number; warmThreshold: number; updatedByUserId: string }) =>
    prisma.crmSettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    }),
};
