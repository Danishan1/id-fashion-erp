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
  days: { orderBy: { leaveDate: "asc" as const }, select: { id: true, leaveDate: true, durationType: true, fraction: true, isSandwich: true, paymentType: true, taken: true } },
  approvedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.LeaveRequestInclude;

export const LeaveRequestRepository = {
  create: (data: Prisma.LeaveRequestUncheckedCreateInput) => prisma.leaveRequest.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.LeaveRequestUncheckedUpdateInput) => prisma.leaveRequest.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.leaveRequest.findFirst({ where: { id, companyId } }),

  findById: (id: string) => prisma.leaveRequest.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE }),

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

export const LeaveBalanceCarryForwardRepository = {
  create: (data: Prisma.LeaveBalanceCarryForwardUncheckedCreateInput) => prisma.leaveBalanceCarryForward.create({ data }),

  /** The set of employee+leaveType pairs already carried forward into a
   * given target year — the batch run's own idempotency check, read once
   * up front rather than one query per employee. */
  findExistingForYear: (companyId: string, toYear: number) =>
    prisma.leaveBalanceCarryForward.findMany({ where: { companyId, toYear }, select: { employeeId: true, leaveTypeId: true } }),

  /** Total carried-in days for one employee+leaveType landing in a given
   * year — added on top of that leave type's own annualDays. */
  sumForYear: async (companyId: string, employeeId: string, leaveTypeId: string, toYear: number) => {
    const rows = await prisma.leaveBalanceCarryForward.findMany({
      where: { companyId, employeeId, leaveTypeId, toYear },
      select: { carriedDays: true },
    });
    return rows.reduce((sum, r) => sum + Number(r.carriedDays), 0);
  },

  findMany: (companyId: string, toYear?: number) =>
    prisma.leaveBalanceCarryForward.findMany({
      where: { companyId, ...(toYear ? { toYear } : {}) },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true } },
        leaveType: { select: { id: true, name: true } },
      },
      orderBy: [{ toYear: "desc" }, { employee: { fullName: "asc" } }],
    }),
};
