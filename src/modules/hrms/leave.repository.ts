import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const LeaveTypeRepository = {
  findMany: (companyId: string) => prisma.leaveType.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  findAnyById: (companyId: string, id: string) => prisma.leaveType.findFirst({ where: { id, companyId } }),
  create: (data: Prisma.LeaveTypeUncheckedCreateInput) => prisma.leaveType.create({ data }),
  update: (id: string, data: Prisma.LeaveTypeUncheckedUpdateInput) => prisma.leaveType.update({ where: { id }, data }),
};

const DETAIL_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  leaveType: { select: { id: true, name: true, annualDays: true } },
  approvedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.LeaveRequestInclude;

export const LeaveRequestRepository = {
  create: (data: Prisma.LeaveRequestUncheckedCreateInput) => prisma.leaveRequest.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.LeaveRequestUncheckedUpdateInput) => prisma.leaveRequest.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.leaveRequest.findFirst({ where: { id, companyId } }),

  findMany: (where: Prisma.LeaveRequestWhereInput, args: Omit<Prisma.LeaveRequestFindManyArgs, "where">) =>
    prisma.leaveRequest.findMany({ where, include: DETAIL_INCLUDE, ...args }),

  count: (where: Prisma.LeaveRequestWhereInput) => prisma.leaveRequest.count({ where }),

  /** Every APPROVED request for one employee+leaveType overlapping a given
   * year — used to compute the running balance the source never tracked. */
  findApprovedInYear: (employeeId: string, leaveTypeId: string, year: number) =>
    prisma.leaveRequest.findMany({
      where: {
        employeeId,
        leaveTypeId,
        status: "APPROVED",
        startDate: { lte: new Date(`${year}-12-31`) },
        endDate: { gte: new Date(`${year}-01-01`) },
      },
      select: { startDate: true, endDate: true },
    }),
};
