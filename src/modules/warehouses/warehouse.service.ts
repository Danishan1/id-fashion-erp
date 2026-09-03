import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { WarehouseInput, WarehouseUpdateInput, WarehouseLocationInput, WarehouseLocationUpdateInput } from "./warehouse.schema";
import { WarehouseLocationRepository, WarehouseRepository } from "./warehouse.repository";

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
    WarehouseRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    WarehouseRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getWarehouseById(companyId: string, id: string) {
  const warehouse = await WarehouseRepository.findByIdWithLocations(companyId, id);
  if (!warehouse) throw new BusinessRuleError("NOT_FOUND", "Warehouse not found.", { id });
  return warehouse;
}

export async function createWarehouse(actor: ActorContext, input: WarehouseInput) {
  if (!actor.branchId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Your account has no default branch assigned.");
  }

  const existing = await WarehouseRepository.findByCodeInBranch(actor.branchId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Warehouse code "${input.code}" is already in use.`);
  }

  const stagedLocations = input.locations ?? [];
  if (stagedLocations.length > 0) {
    const codes = stagedLocations.map((l) => l.code.trim().toLowerCase());
    if (new Set(codes).size !== codes.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Duplicate location codes in the submitted list.");
    }
  }

  // Locations staged before the warehouse has an id (Create's own "add
  // Storage Locations right here" UI) are created via one nested write —
  // atomic with the warehouse row itself, not a separate follow-up call.
  const warehouse = await WarehouseRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId,
    code: input.code,
    name: input.name,
    type: input.type,
    isActive: input.isActive,
    ...(stagedLocations.length > 0
      ? {
          locations: {
            createMany: {
              data: stagedLocations.map((loc) => ({
                code: loc.code,
                zone: loc.zone || null,
                rack: loc.rack || null,
                bin: loc.bin || null,
                materialCategory: loc.materialCategory || null,
              })),
            },
          },
        }
      : {}),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouses",
    recordId: warehouse.id,
    action: "CREATE",
    newValues: warehouse,
  });

  if (stagedLocations.length > 0) {
    const createdLocations = await WarehouseLocationRepository.findMany(warehouse.id);
    for (const location of createdLocations) {
      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "warehouse_locations",
        recordId: location.id,
        action: "CREATE",
        newValues: location,
      });
    }
  }

  return warehouse;
}

export async function setWarehouseActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getWarehouseById(actor.companyId, id);
  const updated = await WarehouseRepository.update(id, { isActive });

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

export async function updateWarehouse(actor: ActorContext, id: string, input: WarehouseUpdateInput) {
  const before = await getWarehouseById(actor.companyId, id);

  const data: Prisma.WarehouseUncheckedUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = { set: input.type };
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await WarehouseRepository.update(id, data);

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

export async function listWarehouseLocations(companyId: string, warehouseId: string) {
  await getWarehouseById(companyId, warehouseId);
  return WarehouseLocationRepository.findMany(warehouseId);
}

/** No companyId column on WarehouseLocation itself — every lookup must go
 * through the warehouse's own companyId, and the location must actually
 * belong to the specific warehouse in the URL (not just the same company),
 * matching this project's own repeated tenant/parent-scoping discipline. */
async function assertLocationBelongsToWarehouse(companyId: string, warehouseId: string, locationId: string) {
  const location = await WarehouseLocationRepository.findByIdWithWarehouse(locationId);
  if (!location || location.warehouseId !== warehouseId || location.warehouse.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Location not found.", { id: locationId });
  }
  return location;
}

export async function createWarehouseLocation(
  actor: ActorContext,
  warehouseId: string,
  input: WarehouseLocationInput
) {
  await getWarehouseById(actor.companyId, warehouseId);

  const existing = await WarehouseLocationRepository.findByCode(warehouseId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Location code "${input.code}" already exists in this warehouse.`);
  }

  const location = await WarehouseLocationRepository.create({
    warehouseId,
    code: input.code,
    zone: input.zone || null,
    rack: input.rack || null,
    bin: input.bin || null,
    materialCategory: input.materialCategory || null,
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

export async function updateWarehouseLocation(
  actor: ActorContext,
  warehouseId: string,
  locationId: string,
  input: WarehouseLocationUpdateInput
) {
  const before = await assertLocationBelongsToWarehouse(actor.companyId, warehouseId, locationId);

  if (input.code !== undefined && input.code !== before.code) {
    const existing = await WarehouseLocationRepository.findByCode(warehouseId, input.code, locationId);
    if (existing) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Location code "${input.code}" already exists in this warehouse.`);
    }
  }

  const data: Prisma.WarehouseLocationUncheckedUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.zone !== undefined) data.zone = input.zone || null;
  if (input.rack !== undefined) data.rack = input.rack || null;
  if (input.bin !== undefined) data.bin = input.bin || null;
  if (input.materialCategory !== undefined) data.materialCategory = input.materialCategory || null;

  const updated = await WarehouseLocationRepository.update(locationId, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouse_locations",
    recordId: locationId,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

/** Soft-deactivate only — no hard DELETE route. WarehouseLocation rows are
 * already referenced by real Goods Receipt lines, Fabric Rolls, and ledger
 * entries; matches every other master's soft-delete convention rather than
 * risking orphaning that history. */
export async function setWarehouseLocationActiveStatus(
  actor: ActorContext,
  warehouseId: string,
  locationId: string,
  isActive: boolean
) {
  const before = await assertLocationBelongsToWarehouse(actor.companyId, warehouseId, locationId);
  const updated = await WarehouseLocationRepository.update(locationId, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "warehouse_locations",
    recordId: locationId,
    action: "UPDATE",
    oldValues: { isActive: before.isActive },
    newValues: { isActive },
  });

  return updated;
}
