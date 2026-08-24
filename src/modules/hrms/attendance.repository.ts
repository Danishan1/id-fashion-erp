import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true, shift: { select: { id: true, name: true, startTime: true } } } },
  recordedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AttendanceRecordInclude;

export const AttendanceRepository = {
  upsert: (employeeId: string, attendanceDate: Date, data: Omit<Prisma.AttendanceRecordUncheckedCreateInput, "employeeId" | "attendanceDate" | "companyId">, companyId: string) =>
    prisma.attendanceRecord.upsert({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
      create: { employeeId, attendanceDate, companyId, ...data },
      update: data,
      include: DETAIL_INCLUDE,
    }),

  // Narrow, explicit params rather than a generic `Omit<FindManyArgs, "where">`
  // spread — the latter leaves `include`/`select` structurally present in the
  // args type, which defeats Prisma's payload-type inference and silently
  // widens the return type back to the base (relation-less) model.
  findMany: (where: Prisma.AttendanceRecordWhereInput, args: { orderBy?: Prisma.AttendanceRecordOrderByWithRelationInput; skip?: number; take?: number }) =>
    prisma.attendanceRecord.findMany({ where, include: DETAIL_INCLUDE, ...args }),

  count: (where: Prisma.AttendanceRecordWhereInput) => prisma.attendanceRecord.count({ where }),

  findByDate: (companyId: string, attendanceDate: Date) =>
    prisma.attendanceRecord.findMany({ where: { companyId, attendanceDate }, include: DETAIL_INCLUDE }),
};
