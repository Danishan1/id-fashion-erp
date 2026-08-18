import { prisma } from "@/core/db/client";

export const LookupRepository = {
  color: prisma.color,
  size: prisma.size,
  unit: prisma.unitOfMeasure,
};
