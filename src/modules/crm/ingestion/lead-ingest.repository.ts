import { prisma } from "@/core/db/client";

export const LeadIngestRepository = {
  activeUsers(companyId: string) {
    return prisma.user.findMany({ where: { companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true, fullName: true, email: true } });
  },
  async externalLead(companyId: string, provider: string, externalId: string) {
    const ref = await prisma.crmLeadExternalRef.findUnique({
      where: { companyId_provider_externalId: { companyId, provider, externalId } },
      select: { lead: { select: { id: true, leadNumber: true } } },
    });
    return ref ? { leadId: ref.lead.id, leadNumber: ref.lead.leadNumber } : null;
  },
  leadForReview(companyId: string, id: string) {
    return prisma.crmLead.findFirst({ where: { id, companyId }, select: { id: true, leadNumber: true, ownerUserId: true, createdByUserId: true } });
  },
};
