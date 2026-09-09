import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getMaterialRequirementForOrderLine } from "@/modules/bom-mrp/mrp.service";

/**
 * Given a style and a flat quantity, what materials are needed and what
 * would they cost — the live preview behind the Production Order create/edit
 * form (quantity = the form's own current, freely editable value, not
 * necessarily what a linked Sales Order actually ordered). Gated on
 * bom_mrp.view, matching the sibling /requirements route exactly.
 *
 * An optional salesOrderItemId resolves the same way
 * generateMaterialRequestForOrder's real execution will: the linked Sample's
 * own material list if that Sales Order line has one, otherwise the Style's
 * own real BOM — so this preview can never disagree with what "Generate
 * Material Request" actually raises later.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "view");

    const productId = req.nextUrl.searchParams.get("productId");
    const quantityRaw = req.nextUrl.searchParams.get("quantity");
    const salesOrderItemId = req.nextUrl.searchParams.get("salesOrderItemId");
    if (!productId) throw new BusinessRuleError("VALIDATION_ERROR", "productId is required.");
    const quantity = Number(quantityRaw);
    if (!quantityRaw || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BusinessRuleError("VALIDATION_ERROR", "quantity must be a positive number.");
    }

    const data = await getMaterialRequirementForOrderLine(session.user.companyId, {
      salesOrderItemId: salesOrderItemId || undefined,
      productId,
      quantity,
    });

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
