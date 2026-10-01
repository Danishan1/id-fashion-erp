import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

const OPPORTUNITY_SELECT = {
  id: true,
  opportunityNumber: true,
  name: true,
  status: true,
  amount: true,
  currencyCode: true,
  expectedCloseDate: true,
  leadId: true,
  crmContactId: true,
  crmCompanyId: true,
  ownerUserId: true,
  createdByUserId: true,
  createdAt: true,
} satisfies Prisma.CrmOpportunitySelect;

export const CrmOpportunityRepository = {
  create(data: Prisma.CrmOpportunityUncheckedCreateInput, db: CrmDb) {
    return db.crmOpportunity.create({ data, select: OPPORTUNITY_SELECT });
  },
  findById(where: Prisma.CrmOpportunityWhereInput) {
    return prisma.crmOpportunity.findFirst({ where, select: OPPORTUNITY_SELECT });
  },
};
export type CrmOpportunitySummary = Prisma.CrmOpportunityGetPayload<{ select: typeof OPPORTUNITY_SELECT }>;
