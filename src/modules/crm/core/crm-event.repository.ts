import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

/** Either the global client or an interactive-transaction `tx`. */
export type CrmEventDb = Pick<Prisma.TransactionClient, "crmEvent">;

const LIST_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  eventType: true,
  summary: true,
  payload: true,
  correlationId: true,
  occurredAt: true,
  actor: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmEventSelect;

export const CrmEventRepository = {
  /** Pass a transaction's `tx` to commit the event with the change it describes. */
  create(data: Prisma.CrmEventUncheckedCreateInput, db: CrmEventDb = prisma) {
    return db.crmEvent.create({ data, select: LIST_SELECT });
  },
  findMany(where: Prisma.CrmEventWhereInput, skip: number, take: number, sortOrder: "asc" | "desc") {
    return prisma.crmEvent.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ occurredAt: sortOrder }, { id: sortOrder }],
      skip,
      take,
    });
  },
  count(where: Prisma.CrmEventWhereInput) {
    return prisma.crmEvent.count({ where });
  },
  findById(companyId: string, id: string) {
    return prisma.crmEvent.findFirst({ where: { id, companyId }, select: LIST_SELECT });
  },
};

export type CrmEventRow = Prisma.CrmEventGetPayload<{ select: typeof LIST_SELECT }>;
