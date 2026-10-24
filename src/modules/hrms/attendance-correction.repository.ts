import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  attendanceRecord: { select: { id: true, attendanceDate: true } },
} satisfies Prisma.AttendanceCorrectionRequestInclude;

export const AttendanceCorrectionRepository = {
  create: (data: Prisma.AttendanceCorrectionRequestUncheckedCreateInput) =>
    prisma.attendanceCorrectionRequest.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.AttendanceCorrectionRequestUncheckedUpdateInput) =>
    prisma.attendanceCorrectionRequest.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.attendanceCorrectionRequest.findFirst({ where: { id, companyId } }),

  findById: (id: string) => prisma.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE }),

  findMany: (where: Prisma.AttendanceCorrectionRequestWhereInput, args: Omit<Prisma.AttendanceCorrectionRequestFindManyArgs, "where">) =>
    prisma.attendanceCorrectionRequest.findMany({ where, include: DETAIL_INCLUDE, ...args }),

  count: (where: Prisma.AttendanceCorrectionRequestWhereInput) => prisma.attendanceCorrectionRequest.count({ where }),
};
