import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const EmployeeRepository = {
  findMany: (where: Prisma.EmployeeWhereInput, args: Omit<Prisma.EmployeeFindManyArgs, "where">) =>
    prisma.employee.findMany({ where, include: { department: true, designation: true }, ...args }),

  count: (where: Prisma.EmployeeWhereInput) => prisma.employee.count({ where }),

  findById: (companyId: string, id: string) =>
    prisma.employee.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        department: true,
        designation: true,
        reportsTo: { select: { id: true, fullName: true, employeeCode: true } },
        reports: { where: { deletedAt: null }, select: { id: true, fullName: true, employeeCode: true }, orderBy: { fullName: "asc" } },
      },
    }),

  findByCode: (companyId: string, employeeCode: string, excludeId?: string) =>
    prisma.employee.findFirst({
      where: { companyId, employeeCode, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.EmployeeUncheckedCreateInput) => prisma.employee.create({ data }),

  update: (id: string, data: Prisma.EmployeeUncheckedUpdateInput) => prisma.employee.update({ where: { id }, data }),
};
