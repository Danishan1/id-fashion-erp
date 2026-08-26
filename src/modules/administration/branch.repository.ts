import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const BRANCH_SELECT = {
  id: true,
  code: true,
  name: true,
  type: true,
  addressJson: true,
  isActive: true,
  createdAt: true,
} as const;

export const BranchRepository = {
  findMany: (companyId: string) =>
    prisma.branch.findMany({ where: { companyId }, select: BRANCH_SELECT, orderBy: { name: "asc" } }),

  findById: (companyId: string, id: string) => prisma.branch.findFirst({ where: { id, companyId }, select: BRANCH_SELECT }),

  findByCode: (companyId: string, code: string) => prisma.branch.findFirst({ where: { companyId, code }, select: { id: true } }),

  create: (data: Prisma.BranchUncheckedCreateInput) => prisma.branch.create({ data, select: BRANCH_SELECT }),

  update: (id: string, data: Prisma.BranchUpdateInput) => prisma.branch.update({ where: { id }, data, select: BRANCH_SELECT }),
};
