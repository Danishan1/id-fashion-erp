import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { WarehouseInput, WarehouseLocationInput } from "./warehouse.schema";

interface ActorContext {
  companyId: string;
  branchId: string | null;
  userId: string;
}

export async function listWarehouses(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { code: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.warehouse.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    prisma.warehouse.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getWarehouseById(companyId: string, id: string) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, companyId },
    include: { locations: { orderBy: { code: "asc" } } },
  });
  if (!warehouse) throw new BusinessRuleError("NOT_FOUND", "Warehouse not found.", { id });
  return warehouse;
}

export async function createWarehouse(actor: ActorContext, input: WarehouseInput) {
  if (!actor.branchId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Your account has no default branch assigned.");
  }

  const existing = await prisma.warehouse.findFirst({ where: { branchId: actor.branchId, code: input.code } });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Warehouse code "${input.code}" is already in use.`);
  }

  const warehouse = await prisma.warehouse.create({
    data: {
      companyId: actor.companyId,
      branchId: actor.branchId,
      code: input.code,
      name: input.name,
      type: input.type,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouses",
    recordId: warehouse.id,
    action: "CREATE",
    newValues: warehouse,
  });

  return warehouse;
}

export async function updateWarehouse(actor: ActorContext, id: string, input: WarehouseInput) {
  const before = await getWarehouseById(actor.companyId, id);

  const updated = await prisma.warehouse.update({
    where: { id },
    data: { code: input.code, name: input.name, type: input.type, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouses",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function createWarehouseLocation(
  actor: ActorContext,
  warehouseId: string,
  input: WarehouseLocationInput
) {
  await getWarehouseById(actor.companyId, warehouseId);

  const existing = await prisma.warehouseLocation.findFirst({ where: { warehouseId, code: input.code } });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Location code "${input.code}" already exists in this warehouse.`);
  }

  const location = await prisma.warehouseLocation.create({
    data: {
      warehouseId,
      code: input.code,
      zone: input.zone || null,
      rack: input.rack || null,
      bin: input.bin || null,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouse_locations",
    recordId: location.id,
    action: "CREATE",
    newValues: location,
  });

  return location;
}
