import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  assignedTo: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  // Lines → sample requests give the lead's Samples tab real, already-
  // linked data (Lead → Buyer Enquiry → line → Sample Request).
  buyerEnquiry: {
    select: {
      id: true,
      enquiryNumber: true,
      lines: {
        select: {
          id: true,
          styleNameFreeText: true,
          sampleRequest: { select: { id: true, requestNumber: true, styleName: true, status: true } },
        },
      },
    },
  },
  contacts: { orderBy: { createdAt: "asc" } },
  campaign: { select: { id: true, campaignNumber: true, name: true } },
  deals: { select: { id: true, dealNumber: true, title: true, stage: true, value: true } },
  stage: { select: { id: true, code: true, name: true, kind: true } },
  source: { select: { id: true, code: true, name: true } },
  lostReason: { select: { id: true, code: true, name: true } },
  productCategory: { select: { id: true, name: true } },
  season: { select: { id: true, name: true } },
  productInterests: { select: { productType: { select: { id: true, name: true } } } },
} satisfies Prisma.LeadInclude;

const LIST_INCLUDE = {
  assignedTo: { select: { id: true, fullName: true } },
  stage: { select: { id: true, code: true, name: true, kind: true } },
  source: { select: { id: true, name: true } },
} satisfies Prisma.LeadInclude;

export const LeadRepository = {
  create: (data: Prisma.LeadUncheckedCreateInput) => prisma.lead.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.LeadUncheckedUpdateInput) => prisma.lead.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.lead.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) => prisma.lead.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  findMany: (where: Prisma.LeadWhereInput, args: Omit<Prisma.LeadFindManyArgs, "where">) =>
    prisma.lead.findMany({
      where,
      include: LIST_INCLUDE,
      ...args,
    }),

  count: (where: Prisma.LeadWhereInput) => prisma.lead.count({ where }),

  /** Same email-or-phone duplicate check the source performs, scoped by
   * company (the source has no tenancy at all to scope by). */
  findDuplicates: (
    companyId: string,
    keys: { email: string | null; phones: string[]; companyName: string | null; country: string | null },
    excludeId?: string
  ) => {
    const or: Prisma.LeadWhereInput[] = [];
    if (keys.email) or.push({ email: { equals: keys.email, mode: "insensitive" } });
    // A number entered as a lead's mobile may be stored as another lead's
    // WhatsApp (and vice versa) — match every phone-like field against both.
    for (const phone of keys.phones) {
      or.push({ phone }, { whatsappNumber: phone });
    }
    // Company name alone is too loose (two unrelated "ABC Fashion"s in
    // different countries are common) — only paired with country.
    if (keys.companyName && keys.country) {
      or.push({
        companyName: { equals: keys.companyName, mode: "insensitive" },
        country: { equals: keys.country, mode: "insensitive" },
      });
    }
    if (or.length === 0) return Promise.resolve([]);
    return prisma.lead.findMany({
      where: { companyId, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, leadNumber: true, name: true, companyName: true, email: true, phone: true, country: true },
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
