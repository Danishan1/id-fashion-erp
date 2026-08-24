import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  lead: { select: { id: true, leadNumber: true, name: true } },
  customer: { select: { id: true, name: true, code: true } },
  assignedTo: { select: { id: true, fullName: true } },
  salesAgent: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  resultingSalesOrders: { select: { id: true, orderNumber: true, status: true } },
} satisfies Prisma.DealInclude;

export const DealRepository = {
  create: (data: Prisma.DealUncheckedCreateInput) => prisma.deal.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.DealUncheckedUpdateInput) => prisma.deal.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.deal.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) => prisma.deal.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  findMany: (where: Prisma.DealWhereInput, args: Omit<Prisma.DealFindManyArgs, "where">) =>
    prisma.deal.findMany({
      where,
      include: {
        lead: { select: { id: true, leadNumber: true, name: true } },
        customer: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.DealWhereInput) => prisma.deal.count({ where }),

  /** Salesperson leaderboard — leads owned + deal pipeline/won value per
   * user, exactly mirroring the source's eq_crm_sales_dashboard() query. */
  salesLeaderboard: (companyId: string) =>
    prisma.user.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true,
        fullName: true,
        leadsAssigned: { where: { companyId }, select: { id: true } },
        dealsAssigned: {
          where: { companyId },
          select: { value: true, stage: true },
        },
      },
    }),
};
