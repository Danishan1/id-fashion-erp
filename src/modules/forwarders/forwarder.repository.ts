import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ForwarderRepository = {
  findMany: (where: Prisma.ForwarderWhereInput, args: Omit<Prisma.ForwarderFindManyArgs, "where">) =>
    prisma.forwarder.findMany({ where, ...args }),

  count: (where: Prisma.ForwarderWhereInput) => prisma.forwarder.count({ where }),

  findById: (companyId: string, id: string) => prisma.forwarder.findFirst({ where: { id, companyId, deletedAt: null } }),

  findByCode: (companyId: string, code: string, excludeId?: string) =>
    prisma.forwarder.findFirst({
      where: { companyId, code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.ForwarderUncheckedCreateInput) => prisma.forwarder.create({ data }),

  update: (id: string, data: Prisma.ForwarderUncheckedUpdateInput) => prisma.forwarder.update({ where: { id }, data }),
};
