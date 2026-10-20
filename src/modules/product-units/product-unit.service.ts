import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateMasterCodeInTx } from "@/core/numbering/DocumentNumberingService";
import { registerBarcode } from "@/core/barcode/barcode.service";
import type { Prisma, ProductUnitStatus } from "@prisma/client";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export interface MintProductUnitsParams {
  productId: string;
  productVariantId: string;
  productionOrderId: string;
  lotId: string;
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  salesOrderLineId?: string | null;
  warehouseId?: string | null;
  quantity: number;
}

/**
 * Mints serialized individual ProductUnit garments (e.g. FG-00000001, FG-00000002).
 * Each physical piece receives a permanent immutable identity tied to its exact
 * Style, Variant, Production Order, and Lot.
 */
export async function mintProductUnitsInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: MintProductUnitsParams
) {
  // Guard for transactions where productUnit is not configured (e.g. targeted unit test mocks)
  if (!tx.productUnit) {
    return [];
  }

  const units = [];

  for (let i = 0; i < params.quantity; i++) {
    const code = await generateMasterCodeInTx(tx, actor.companyId, "PRODUCT_UNIT");

    const unit = await tx.productUnit.create({
      data: {
        companyId: actor.companyId,
        unitCode: code,
        productId: params.productId,
        productVariantId: params.productVariantId,
        productionOrderId: params.productionOrderId,
        lotId: params.lotId,
        salesOrderId: params.salesOrderId ?? null,
        salesOrderItemId: params.salesOrderItemId ?? null,
        salesOrderLineId: params.salesOrderLineId ?? null,
        currentWarehouseId: params.warehouseId ?? null,
        status: "PACKED",
        events: {
          create: {
            eventType: "MINTED",
            fromStatus: null,
            toStatus: "PACKED",
            locationId: params.warehouseId ?? null,
            referenceType: "LOT",
            referenceId: params.lotId,
            remarks: `Initial garment serialization at packing/completion for Lot`,
            actorUserId: actor.userId,
          },
        },
      },
    });

    // Register into the global barcode registry as PRODUCT_UNIT if barcode table is present
    if (tx.barcode) {
      await registerBarcode(tx, actor, {
        entityType: "PRODUCT_UNIT",
        entityId: unit.id,
        code,
      });
    }

    units.push(unit);
  }

  return units;
}

/**
 * Resolves a scanned barcode or manual ProductUnit code and fetches its complete provenance history:
 * Style, Variant, Lot, Production Order, Sales Order, Cartons, Dispatches, and Return history.
 */
export async function resolveProductUnitTraceability(actor: ActorContext, codeOrId: string) {
  const unit = await prisma.productUnit.findFirst({
    where: {
      companyId: actor.companyId,
      OR: [{ unitCode: codeOrId }, { id: codeOrId }],
    },
    include: {
      product: {
        select: { id: true, styleCode: true, styleName: true, designNumber: true },
      },
      productVariant: {
        include: { color: true, size: true },
      },
      productionOrder: {
        select: { id: true, orderNumber: true, status: true, plannedQuantity: true, createdAt: true },
      },
      lot: {
        select: { id: true, lotNumber: true, status: true, createdAt: true },
      },
      salesOrder: {
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          customer: { select: { id: true, name: true, code: true } },
        },
      },
      carton: {
        select: { id: true, cartonNumber: true, totalQuantity: true },
      },
      dispatch: {
        select: {
          id: true,
          dispatchNumber: true,
          dispatchDate: true,
          status: true,
          trackingNumber: true,
          vehicleNumber: true,
          transporterName: true,
          forwarder: { select: { id: true, name: true } },
        },
      },
      warehouse: {
        select: { id: true, name: true, code: true },
      },
      events: {
        orderBy: { createdAt: "desc" },
      },
      returns: {
        include: {
          customerReturn: {
            select: { id: true, returnNumber: true, status: true, receivedAt: true },
          },
        },
      },
    },
  });

  if (!unit) {
    throw new BusinessRuleError("NOT_FOUND", `Product unit with code "${codeOrId}" not found.`, { codeOrId });
  }

  return unit;
}

/**
 * Packs an individual garment piece into a carton during dispatch packing.
 */
export async function packUnitIntoCarton(
  actor: ActorContext,
  cartonId: string,
  unitCode: string
) {
  const carton = await prisma.carton.findUnique({
    where: { id: cartonId },
    include: {
      dispatch: {
        include: {
          items: true,
        },
      },
    },
  });

  if (!carton) {
    throw new BusinessRuleError("NOT_FOUND", "Carton not found.", { cartonId });
  }

  if (carton.dispatch.companyId !== actor.companyId) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Carton belongs to a different company.");
  }

  if (carton.dispatch.status !== "DRAFT" && carton.dispatch.status !== "PACKED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot pack into a dispatch with status "${carton.dispatch.status}".`);
  }

  const unit = await prisma.productUnit.findUnique({
    where: {
      companyId_unitCode: { companyId: actor.companyId, unitCode },
    },
    include: {
      productVariant: { include: { color: true, size: true } },
      product: true,
    },
  });

  if (!unit) {
    throw new BusinessRuleError("NOT_FOUND", `Garment with barcode "${unitCode}" was not found.`, { unitCode });
  }

  if (unit.status === "DISPATCHED") {
    throw new BusinessRuleError("VALIDATION_ERROR", `Garment "${unitCode}" has already been dispatched.`, { unitCode });
  }

  if (unit.cartonId && unit.cartonId !== cartonId) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Garment "${unitCode}" is already packed in Carton #${unit.cartonId}.`, { unitCode });
  }

  // Ensure unit matches one of the dispatch items
  const matchingDispatchItem = carton.dispatch.items.find((di) => di.productId === unit.productId);
  if (!matchingDispatchItem) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Garment "${unitCode}" (${unit.product.styleName}) does not belong to this dispatch.`, {
      unitCode,
      styleName: unit.product.styleName,
    });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.productUnit.update({
      where: { id: unit.id },
      data: {
        cartonId,
        dispatchId: carton.dispatchId,
        dispatchItemId: matchingDispatchItem.id,
        salesOrderId: carton.dispatch.salesOrderId,
        status: "PACKED",
        events: {
          create: {
            eventType: "PACKED_INTO_CARTON",
            fromStatus: unit.status,
            toStatus: "PACKED",
            referenceType: "CARTON",
            referenceId: carton.id,
            remarks: `Scanned into Carton #${carton.cartonNumber} of Dispatch ${carton.dispatch.dispatchNumber}`,
            actorUserId: actor.userId,
          },
        },
      },
      include: {
        productVariant: { include: { color: true, size: true } },
        product: true,
      },
    });

    // Check if CartonItem row exists for this variant, increment or create
    const existingCartonItem = await tx.cartonItem.findFirst({
      where: {
        cartonId,
        dispatchItemId: matchingDispatchItem.id,
        productVariantId: unit.productVariantId,
      },
    });

    if (existingCartonItem) {
      await tx.cartonItem.update({
        where: { id: existingCartonItem.id },
        data: { quantity: { increment: 1 } },
      });
    } else {
      await tx.cartonItem.create({
        data: {
          cartonId,
          dispatchItemId: matchingDispatchItem.id,
          productVariantId: unit.productVariantId,
          quantity: 1,
        },
      });
    }

    await tx.carton.update({
      where: { id: cartonId },
      data: { totalQuantity: { increment: 1 } },
    });

    return updated;
  });
}
