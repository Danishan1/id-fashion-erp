import { prisma } from "@/core/db/client";

export const FabricConfigRepository = {
  gsm: prisma.fabricGsm,
  dye: prisma.fabricDye,
  weaveType: prisma.fabricWeaveType,
  width: prisma.fabricWidth,
  composition: prisma.fabricComposition,
};
