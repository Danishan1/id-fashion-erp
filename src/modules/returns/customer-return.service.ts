import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import type { ReturnCondition, ReturnDisposition } from "@prisma/client";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export interface ReturnItemInput {
  productUnitCode: string;
  returnReason: string;
  condition: ReturnCondition;
  disposition: ReturnDisposition;
  restockWarehouseId?: string | null;
  remarks?: string | null;
}

export interface CreateCustomerReturnInput {
  salesOrderId?: string | null;
  customerId: string;
  remarks?: string | null;
  items: ReturnItemInput[];
}

/**
 * Creates a Customer Return receiving one or more individual serialized garments.
 * Verifies that each garment belongs to the customer and was actually dispatched.
 * Applies disposition rules (RESTOCK posts inventory transactions; REWORK/QUARANTINE/SCRAP update unit status).
 */
export async function createCustomerReturn(
  actor: ActorContext,
  input: CreateCustomerReturnInput
) {
  if (!input.items || input.items.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "At least one garment must be returned.");
  }

  // Pre-load all product units by code
  const unitCodes = input.items.map((i) => i.productUnitCode.trim());
  const units = await prisma.productUnit.findMany({
    where: {
      companyId: actor.companyId,
      unitCode: { in: unitCodes },
    },
    include: {
      product: true,
      productVariant: { include: { color: true, size: true } },
    },
  });

  const unitByCode = new Map(units.map((u) => [u.unitCode, u]));

  for (const item of input.items) {
    const code = item.productUnitCode.trim();
    const unit = unitByCode.get(code);
    if (!unit) {
      throw new BusinessRuleError("NOT_FOUND", `Garment with barcode "${code}" does not exist.`, { code });
    }

    if (unit.status !== "DISPATCHED") {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Garment "${code}" cannot be returned because its current status is "${unit.status}" (must be DISPATCHED).`,
        { code, status: unit.status }
      );
    }

    if (item.disposition === "RESTOCK" && !item.restockWarehouseId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `A restock warehouse is required for garment "${code}" when disposition is RESTOCK.`,
        { code }
      );
    }
  }

  // Drawn before the transaction opens, matching this project's own
  // established document-numbering convention (see e.g. createSalesOrder) —
  // a genuine transactional document number (RET-2026-00001), not a
  // never-resetting master code, so it goes through generateDocumentNumber()
  // rather than the master-code mechanism.
  const returnNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "CUSTOMER_RETURN",
  });

  return prisma.$transaction(async (tx) => {
    const customerReturn = await tx.customerReturn.create({
      data: {
        companyId: actor.companyId,
        returnNumber,
        customerId: input.customerId,
        salesOrderId: input.salesOrderId ?? null,
        status: "COMPLETED",
        receivedById: actor.userId,
        remarks: input.remarks ?? null,
      },
    });

    for (const item of input.items) {
      const code = item.productUnitCode.trim();
      const unit = unitByCode.get(code)!;

      let nextUnitStatus: "RETURNED" | "IN_STOCK" | "QUARANTINED" | "REWORK" | "SCRAPPED" = "RETURNED";
      if (item.disposition === "RESTOCK") nextUnitStatus = "IN_STOCK";
      else if (item.disposition === "QUARANTINE") nextUnitStatus = "QUARANTINED";
      else if (item.disposition === "REWORK") nextUnitStatus = "REWORK";
      else if (item.disposition === "SCRAP") nextUnitStatus = "SCRAPPED";

      await tx.customerReturnItem.create({
        data: {
          customerReturnId: customerReturn.id,
          productUnitId: unit.id,
          returnReason: item.returnReason,
          condition: item.condition,
          disposition: item.disposition,
          restockWarehouseId: item.restockWarehouseId ?? null,
          inspectedAt: new Date(),
          inspectedById: actor.userId,
          remarks: item.remarks ?? null,
        },
      });

      // Update unit status and location
      await tx.productUnit.update({
        where: { id: unit.id },
        data: {
          status: nextUnitStatus,
          currentWarehouseId: item.restockWarehouseId ?? unit.currentWarehouseId,
        },
      });

      // Add lifecycle event
      await tx.productUnitEvent.create({
        data: {
          productUnitId: unit.id,
          eventType: `RETURN_${item.disposition}`,
          fromStatus: "DISPATCHED",
          toStatus: nextUnitStatus,
          locationId: item.restockWarehouseId ?? null,
          referenceType: "CUSTOMER_RETURN",
          referenceId: customerReturn.id,
          remarks: `Return received (${item.condition}) - Reason: ${item.returnReason}. Disposition: ${item.disposition}`,
          actorUserId: actor.userId,
        },
      });

      // If disposition is RESTOCK, post inventory transaction back into warehouse stock
      if (item.disposition === "RESTOCK" && item.restockWarehouseId) {
        await recordInventoryTransaction(tx, actor, {
          productId: unit.productId,
          productVariantId: unit.productVariantId,
          warehouseId: item.restockWarehouseId,
          transactionType: "CUSTOMER_RETURN",
          quantity: 1,
          referenceModule: "CUSTOMER_RETURN",
          referenceRecordId: customerReturn.id,
          stockStatus: "SALEABLE",
        });
      }
    }

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "customer_returns",
      recordId: customerReturn.id,
      action: "CREATE",
      newValues: {
        returnNumber,
        customerId: input.customerId,
        itemCount: input.items.length,
      },
    });

    return customerReturn;
  });
}

/**
 * List returns for company.
 */
export async function listCustomerReturns(actor: ActorContext) {
  return prisma.customerReturn.findMany({
    where: { companyId: actor.companyId },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      salesOrder: { select: { id: true, orderNumber: true } },
      items: {
        include: {
          productUnit: {
            include: {
              product: { select: { styleName: true, styleCode: true } },
              productVariant: { include: { color: true, size: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
