import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ColorInput, SizeInput, UnitInput } from "./lookup.schema";

interface ActorContext {
  companyId: string;
}

// ── Colors ──────────────────────────────────────────────────────────────

export async function listColors(companyId: string) {
  return prisma.color.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createColor(actor: ActorContext, input: ColorInput) {
  const existing = await prisma.color.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Color code "${input.code}" is already in use.`);

  return prisma.color.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      hexValue: input.hexValue || null,
      isActive: input.isActive,
    },
  });
}

export async function updateColor(actor: ActorContext, id: string, input: ColorInput) {
  return prisma.color.update({
    where: { id },
    data: { code: input.code, name: input.name, hexValue: input.hexValue || null, isActive: input.isActive },
  });
}

// ── Sizes ───────────────────────────────────────────────────────────────

export async function listSizes(companyId: string) {
  return prisma.size.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" } });
}

export async function createSize(actor: ActorContext, input: SizeInput) {
  const existing = await prisma.size.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Size code "${input.code}" is already in use.`);

  return prisma.size.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
  });
}

export async function updateSize(actor: ActorContext, id: string, input: SizeInput) {
  return prisma.size.update({
    where: { id },
    data: { code: input.code, name: input.name, sortOrder: input.sortOrder, isActive: input.isActive },
  });
}

// ── Units of Measure (global, not company-scoped) ────────────────────────

export async function listUnits() {
  return prisma.unitOfMeasure.findMany({ orderBy: { code: "asc" } });
}

export async function createUnit(input: UnitInput) {
  const existing = await prisma.unitOfMeasure.findUnique({ where: { code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Unit code "${input.code}" is already in use.`);

  return prisma.unitOfMeasure.create({
    data: { code: input.code, name: input.name, conversionFactor: input.conversionFactor },
  });
}

export async function updateUnit(id: string, input: UnitInput) {
  return prisma.unitOfMeasure.update({
    where: { id },
    data: { code: input.code, name: input.name, conversionFactor: input.conversionFactor },
  });
}
