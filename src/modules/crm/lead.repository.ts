import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  assignedTo: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  buyerEnquiry: { select: { id: true, enquiryNumber: true } },
  deals: { select: { id: true, dealNumber: true, title: true, stage: true, value: true } },
} satisfies Prisma.LeadInclude;

export const LeadRepository = {
  create: (data: Prisma.LeadUncheckedCreateInput) => prisma.lead.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.LeadUncheckedUpdateInput) => prisma.lead.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.lead.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) => prisma.lead.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  findMany: (where: Prisma.LeadWhereInput, args: Omit<Prisma.LeadFindManyArgs, "where">) =>
    prisma.lead.findMany({
      where,
      include: { assignedTo: { select: { id: true, fullName: true } } },
      ...args,
    }),

  count: (where: Prisma.LeadWhereInput) => prisma.lead.count({ where }),

  /** Same email-or-phone duplicate check the source performs, scoped by
   * company (the source has no tenancy at all to scope by). */
  findDuplicates: (companyId: string, email: string | null, phone: string | null, excludeId?: string) => {
    const or: Prisma.LeadWhereInput[] = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    if (or.length === 0) return Promise.resolve([]);
    return prisma.lead.findMany({
      where: { companyId, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, leadNumber: true, name: true },
      take: 5,
    });
  },
};

/** Backs a real stored rotation pointer for round-robin assignment — fixes
 * the source's fragile "re-derive who's next from the last lead's own
 * assignee" approach (see migration report §3.1/§7). */
export const CrmRoundRobinRepository = {
  findOrCreate: async (companyId: string) => {
    const existing = await prisma.crmRoundRobinState.findUnique({ where: { companyId } });
    if (existing) return existing;
    return prisma.crmRoundRobinState.create({ data: { companyId } });
  },

  updateLastAssigned: (companyId: string, userId: string) =>
    prisma.crmRoundRobinState.update({ where: { companyId }, data: { lastAssignedUserId: userId } }),
};
