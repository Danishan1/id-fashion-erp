import { prisma } from "@/core/db/client";

export const HrConfigRepository = {
  designation: prisma.designation,
  employeeCategory: prisma.employeeCategory,
  shiftMaster: prisma.shiftMaster,
  holidayMaster: prisma.holidayMaster,
};
