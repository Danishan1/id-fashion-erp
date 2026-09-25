import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { FabricConfigRepository } from "@/modules/fabric-config/fabric-config.repository";
import { MaterialRequestItemRepository } from "@/modules/inventory/material-request.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import type { PurchaseOrderInput, PurchaseOrderItemInput, UpdatePurchaseOrderInput } from "./purchase-order.schema";
import { CompanyRepository, PurchaseOrderRepository } from "./purchase-order.repository";
import { PurchaseOrderStatus, type Prisma } from "@prisma/client";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Rejects at PO-creation time if a line's chosen `uomId` has no fixed
 * conversion path to its material's own base UOM — catching the mistake
 * immediately instead of silently corrupting the stock ledger weeks later
 * at receipt time (see goods-receipt.service.ts, which converts before
 * every ledger write and treats a missing path as a defensive backstop
 * error, not the primary validation point).
 */
async function assertItemsHaveConvertibleUom(companyId: string, items: PurchaseOrderItemInput[]) {
  for (const item of items) {
    const material = await ProductRepository.findMaterialById(companyId, item.productId);
    if (!material) throw new BusinessRuleError("NOT_FOUND", "Raw material not found.", { id: item.productId });

    if (!material.baseUom) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${material.styleName}" has no base unit configured — set one in Masters → Materials before ordering it.`,
        { productId: item.productId }
      );
    }

    if (item.uomId === material.baseUom.id) continue;

    const chosenUom = await LookupRepository.unit.findUnique({ where: { id: item.uomId } });
    if (!chosenUom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: item.uomId });

    const converted = convertUomQuantity(1, chosenUom, material.baseUom);
    if (converted === null) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${chosenUom.name}" has no fixed conversion to "${material.styleName}"'s base unit ("${material.baseUom.name}") — pick a convertible unit.`,
        { productId: item.productId, uomId: item.uomId }
      );
    }
  }
}

/**
 * Today's sole caller (generatePurchaseOrdersForShortfall in
 * material-request.service.ts) already only ever submits its own
 * company-scoped lines, but this function has no other defense of its own
 * against a forged cross-tenant id — the now-removed `@unique` constraint
 * on materialRequestItemId was never a tenant check anyway. Fires only when
 * the field is present, so direct PO creation (no Material Request
 * involved) is completely unaffected.
 */
async function assertMaterialRequestItemsAreValid(companyId: string, items: PurchaseOrderItemInput[]) {
  for (const item of items) {
    if (!item.materialRequestItemId) continue;
    const line = await MaterialRequestItemRepository.findWithRequestOwner(item.materialRequestItemId);
    if (!line || line.materialRequest.companyId !== companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Material request line not found.", { id: item.materialRequestItemId });
    }
  }
}

/**
 * Cheap tenant-scope check on a line's chosen Color/Shade (FabricDye) before
 * it's ever written — the same discipline every other cross-reference in
 * this codebase already gets (see CLAUDE.md's 2026-08-19 cross-tenant
 * sweep). Both are a direct user pick on the create/edit form, unlike
 * materialRequestItemId (system-set only), so an unchecked id here is a
 * real, reachable gap otherwise.
 */
async function assertItemsHaveValidColorAndDye(companyId: string, items: PurchaseOrderItemInput[]) {
  for (const item of items) {
    if (item.colorId) {
      const color = await LookupRepository.color.findFirst({ where: { id: item.colorId, companyId } });
      if (!color) throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id: item.colorId });
    }
    if (item.dyeId) {
      const dye = await FabricConfigRepository.dye.findFirst({ where: { id: item.dyeId, companyId } });
      if (!dye) throw new BusinessRuleError("NOT_FOUND", "Shade/Pantone not found.", { id: item.dyeId });
    }
  }
}

/**
 * PARTIALLY_RECEIVED/FULLY_RECEIVED are deliberately absent from every
 * source status's target list — they're only reachable as an automatic side
 * effect of createGoodsReceipt() in goods-receipt.service.ts, same
 * discipline as Sales Orders reserving IN_PRODUCTION for a real business
 * action rather than a caller-chosen generic status change.
 *
 * CANCELLED is listed from every non-terminal status including ON_HOLD, but
 * the real enforcement is the active-receipt guard inside
 * transitionPurchaseOrderStatus() below, checked unconditionally whenever
 * CANCELLED is the target — never inferred from the status label alone. That
 * label-only shortcut is exactly the bug class already found once in
 * Sampling's Hold/Resume flow: a PO held while PARTIALLY_RECEIVED must still
 * be blocked from cancelling once resumed-or-not, because goods have
 * actually arrived — not because its status happens to say "on hold."
 */
const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ["ON_HOLD", "CANCELLED"],
  APPROVED: ["ON_HOLD", "CANCELLED"],
  SENT_TO_SUPPLIER: ["ON_HOLD", "CANCELLED"],
  PARTIALLY_RECEIVED: ["ON_HOLD", "CANCELLED"],
  FULLY_RECEIVED: ["ON_HOLD"],
  CLOSED: [],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
};

function computeTotalAmount(items: PurchaseOrderItemInput[]) {
  return items.reduce((sum, item) => sum + item.unitPrice * item.orderedQuantity, 0);
}

const VALID_PURCHASE_ORDER_STATUSES = new Set<string>(Object.values(PurchaseOrderStatus));

export async function listPurchaseOrders(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.PurchaseOrderWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_PURCHASE_ORDER_STATUSES.has(query.status)
      ? { status: query.status as PurchaseOrderStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    PurchaseOrderRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    PurchaseOrderRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for an order outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getPurchaseOrderById(actor: { companyId: string; userId: string }, id: string) {
  const order = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!order.branchId || !allowedBranchIds.has(order.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });
  }

  return order;
}

export async function createPurchaseOrder(actor: ActorContext, input: PurchaseOrderInput) {
  const supplier = await SupplierRepository.findById(actor.companyId, input.supplierId);
  if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });

  await assertItemsHaveConvertibleUom(actor.companyId, input.items);
  await assertMaterialRequestItemsAreValid(actor.companyId, input.items);
  await assertItemsHaveValidColorAndDye(actor.companyId, input.items);

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  // Always the company's own base currency, never supplier.defaultCurrencyCode
  // — applying the Sales Order currency-defaulting lesson (CLAUDE.md,
  // 2026-08-20) proactively instead of repeating the same mistake here.
  const currencyCode = company.baseCurrencyCode;

  const orderNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "PURCHASE_ORDER",
  });

  const totalAmount = computeTotalAmount(input.items);

  const order = await PurchaseOrderRepository.createWithItems({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    orderNumber,
    supplierId: input.supplierId,
    orderDate: new Date(input.orderDate),
    expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
    status: "DRAFT",
    currencyCode,
    exchangeRate: 1,
    baseCurrencyCode: company.baseCurrencyCode,
    totalAmount,
    baseTotalAmount: totalAmount,
    requestedByUserId: actor.userId,
    items: {
      create: input.items.map((item) => ({
        productId: item.productId,
        uomId: item.uomId,
        orderedQuantity: item.orderedQuantity,
        unitPrice: item.unitPrice,
        notes: item.notes || null,
        colorId: item.colorId || null,
        dyeId: item.dyeId || null,
        materialRequestItemId: item.materialRequestItemId || null,
      })),
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: order.id,
    action: "CREATE",
    newValues: { orderNumber: order.orderNumber, totalAmount: order.totalAmount },
  });

  return order;
}

/**
 * Editable while DRAFT (freely) or APPROVED (allowed, but reverts status to
 * DRAFT — forcing re-approval, mirroring the segregation-of-duties spirit
 * already applied to the Approve action elsewhere). Blocked from
 * SENT_TO_SUPPLIER onward — the supplier's already been notified by then, so
 * a correction needs a new PO instead, matching Sales Orders' own
 * deferred-amendment stance.
 */
export async function updatePurchaseOrder(actor: ActorContext, id: string, input: UpdatePurchaseOrderInput) {
  const existing = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a purchase order in "${existing.status}" status — create a new purchase order instead.`,
      { currentStatus: existing.status }
    );
  }

  // Re-validated on update too, not just create — a supplierId from another
  // company would otherwise sit unvalidated on the record from here on.
  const supplier = await SupplierRepository.findById(actor.companyId, input.supplierId);
  if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });

  await assertItemsHaveConvertibleUom(actor.companyId, input.items);
  await assertItemsHaveValidColorAndDye(actor.companyId, input.items);

  const totalAmount = computeTotalAmount(input.items);
  const revertsToDraft = existing.status === "APPROVED";

  const updated = await PurchaseOrderRepository.replaceItems(
    id,
    {
      supplierId: input.supplierId,
      orderDate: new Date(input.orderDate),
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      totalAmount,
      baseTotalAmount: totalAmount,
      ...(revertsToDraft ? { status: "DRAFT" as const } : {}),
    },
    input.items.map((item) => ({
      productId: item.productId,
      uomId: item.uomId,
      orderedQuantity: item.orderedQuantity,
      unitPrice: item.unitPrice,
      notes: item.notes || null,
      colorId: item.colorId || null,
      dyeId: item.dyeId || null,
    }))
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { totalAmount: existing.totalAmount, status: existing.status },
    newValues: { totalAmount: updated.totalAmount, status: updated.status },
  });

  return updated;
}

/**
 * DRAFT -> APPROVED, gated behind the self-approval guard — the PO's own
 * creator can't approve it, same rule already enforced project-wide for
 * every other Approve action.
 */
export async function approvePurchaseOrder(actor: ActorContext, id: string) {
  const order = await PurchaseOrderRepository.findAnyByIdWithItemPrices(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  if (order.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve a purchase order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }

  // Defense-in-depth backstop: direct PO creation already requires a
  // positive unitPrice per line at creation time, so this is a no-op there.
  // It exists to catch any other caller of createPurchaseOrder() reaching
  // this code path with a zero/unset price — the exact bug class BUG-04
  // found in generatePurchaseOrdersForShortfall()'s old hardcoded unitPrice: 0.
  if (order.items.some((item) => Number(item.unitPrice) <= 0)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Cannot approve a purchase order with a zero or missing unit price on one or more lines — set a real price first.",
      { orderId: id }
    );
  }

  await PermissionService.assert(actor.userId, "purchase_order", "approve", { createdBy: order.requestedByUserId });

  const updated = await PurchaseOrderRepository.update(id, { status: "APPROVED" });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: order.status },
    newValues: { status: "APPROVED" },
  });

  return updated;
}

export async function markPurchaseOrderSentToSupplier(actor: ActorContext, id: string) {
  const order = await PurchaseOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  if (order.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot mark a purchase order as sent to supplier from "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  const updated = await PurchaseOrderRepository.update(id, { status: "SENT_TO_SUPPLIER" });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: order.status },
    newValues: { status: "SENT_TO_SUPPLIER" },
  });

  return updated;
}

export async function closePurchaseOrder(actor: ActorContext, id: string) {
  const order = await PurchaseOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  if (order.status !== "FULLY_RECEIVED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot close a purchase order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }

  const updated = await PurchaseOrderRepository.update(id, { status: "CLOSED" });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: order.status },
    newValues: { status: "CLOSED" },
  });

  return updated;
}

export async function transitionPurchaseOrderStatus(actor: ActorContext, id: string, targetStatus: PurchaseOrderStatus) {
  const before = await PurchaseOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a purchase order from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  if (targetStatus === "CANCELLED") {
    const activeReceipts = await PurchaseOrderRepository.countActiveReceipts(id);
    if (activeReceipts > 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot cancel — ${activeReceipts} goods receipt(s) already exist against this purchase order. Close it instead once fully received.`,
        { activeReceipts }
      );
    }

    // Same "never inferred from the status label alone" discipline as the
    // active-receipts guard above — a Purchase Invoice with a live Journal
    // entry (Phase 7C) must block cancellation regardless of what the PO's
    // status happens to say, including after an ON_HOLD round-trip.
    const invoicedItems = await PurchaseOrderRepository.countInvoicedItems(id);
    if (invoicedItems > 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot cancel — ${invoicedItems} line(s) on this purchase order have already been invoiced.`,
        { invoicedItems }
      );
    }
  }

  const data: Prisma.PurchaseOrderUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") {
    data.statusBeforeHold = before.status;
  }

  const updated = await PurchaseOrderRepository.update(id, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: targetStatus === "CANCELLED" ? "CANCEL" : "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the order was held from — no caller-chosen
 * target, same reasoning as Sampling's/Sales Orders' resume functions. */
export async function resumePurchaseOrderFromHold(actor: ActorContext, id: string) {
  const before = await PurchaseOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This purchase order isn't on hold.", {
      currentStatus: before.status,
    });
  }

  const updated = await PurchaseOrderRepository.update(id, {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}
