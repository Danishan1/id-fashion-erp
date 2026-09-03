import { prisma } from "@/core/db/client";
import type { SubmoduleKey } from "@/config/submodule-registry";

/**
 * Per-submodule "does this company have any real data here" check --
 * existence only (findFirst + select id), not count(), since the registry
 * is designed to grow (Garment Attributes/HR Config later) and only ">0"
 * is ever needed, never an exact number. This is the one place a future
 * submodule needs its own one-line addition when it's onboarded.
 */
export const SUBMODULE_HAS_DATA_CHECKS: Record<SubmoduleKey, (companyId: string) => Promise<boolean>> = {
  FABRIC_GSM: async (companyId) =>
    (await prisma.fabricGsm.findFirst({ where: { companyId }, select: { id: true } })) !== null,
  FABRIC_DYE: async (companyId) =>
    (await prisma.fabricDye.findFirst({ where: { companyId }, select: { id: true } })) !== null,
  FABRIC_DYE_TYPE: async (companyId) =>
    (await prisma.fabricDyeType.findFirst({ where: { companyId }, select: { id: true } })) !== null,
  FABRIC_WEAVE_TYPE: async (companyId) =>
    (await prisma.fabricWeaveType.findFirst({ where: { companyId }, select: { id: true } })) !== null,
  FABRIC_WIDTH: async (companyId) =>
    (await prisma.fabricWidth.findFirst({ where: { companyId }, select: { id: true } })) !== null,
  FABRIC_COMPOSITION: async (companyId) =>
    (await prisma.fabricComposition.findFirst({ where: { companyId }, select: { id: true } })) !== null,
};
