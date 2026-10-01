import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

/** The global client or an interactive-transaction `tx` — every CRM repository write accepts either. */
export type CrmDb = Prisma.TransactionClient | typeof prisma;

export const defaultCrmDb: CrmDb = prisma;
