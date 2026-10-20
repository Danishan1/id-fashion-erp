import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const EmployeeRepository = {
  findMany: (where: Prisma.EmployeeWhereInput, args: Omit<Prisma.EmployeeFindManyArgs, "where">) =>
    prisma.employee.findMany({ where, include: { department: true, designation: true, employeeCategory: true, workSkills: { select: { productionStageId: true, productionStage: { select: { id: true, name: true, sequence: true } } } } }, ...args }),

  count: (where: Prisma.EmployeeWhereInput) => prisma.employee.count({ where }),

  findById: (companyId: string, id: string) =>
    prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        department: true,
        designation: true,
        employeeCategory: true,
        workSkills: { select: { productionStageId: true, productionStage: { select: { id: true, name: true, sequence: true } } } },
        reportsTo: { select: { id: true, fullName: true, employeeCode: true } },
        reports: { where: { deletedAt: null }, select: { id: true, fullName: true, employeeCode: true }, orderBy: { fullName: "asc" } },
      },
    }),

  findByCode: (companyId: string, employeeCode: string, excludeId?: string) =>
    prisma.employee.findFirst({
      where: { companyId, employeeCode, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.EmployeeUncheckedCreateInput) => prisma.employee.create({ data }),

  createInTx: (tx: Prisma.TransactionClient, data: Prisma.EmployeeUncheckedCreateInput) => tx.employee.create({ data }),

  /** The login linked to this employee (User.employeeId is unique), if any. */
  findLinkedUserId: async (employeeId: string) =>
    (await prisma.user.findUnique({ where: { employeeId }, select: { id: true } }))?.id ?? null,

  /** Full replace of an employee's Work Skills — an empty array clears them all. */
  replaceWorkSkills: (employeeId: string, productionStageIds: string[]) =>
    prisma.$transaction([
      prisma.employeeWorkSkill.deleteMany({ where: { employeeId } }),
      prisma.employeeWorkSkill.createMany({
        data: productionStageIds.map((productionStageId) => ({ employeeId, productionStageId })),
        skipDuplicates: true,
      }),
    ]),

  /** How many of these stage ids are real stages of this company. */
  countCompanyStages: (companyId: string, stageIds: string[]) =>
    prisma.productionStage.count({ where: { companyId, id: { in: stageIds } } }),

  update: (id: string, data: Prisma.EmployeeUncheckedUpdateInput) => prisma.employee.update({ where: { id }, data }),
};
