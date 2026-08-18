import { prisma } from "@/core/db/client";

export const ProductionConfigRepository = {
  stage: prisma.productionStage,
  line: prisma.productionLine,
  machine: prisma.machine,
  salesAgent: prisma.salesAgent,
};
