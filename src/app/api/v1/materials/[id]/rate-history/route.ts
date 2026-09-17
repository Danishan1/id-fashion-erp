import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getMaterialRateHistory } from "@/modules/purchasing/goods-receipt.service";

/**
 * Two real callers, two permission contexts — the original Sample Material
 * Rate modal (sampling.edit) and the "Generate Purchase Order(s)" review
 * modal's own "Purchase History" link (inventory.view, matching the exact
 * gate that modal's own review-data route already uses), per this project's
 * established "accept either" pattern (see sales-orders/[id]/confirm).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const [canEditSampling, canViewInventory] = await Promise.all([
      PermissionService.can(session.user.id, "sampling", "edit"),
      PermissionService.can(session.user.id, "inventory", "view"),
    ]);
    if (!canEditSampling && !canViewInventory) {
      throw new BusinessRuleError("PERMISSION_DENIED", "You do not have permission to view in inventory.", {
        module: "inventory",
        action: "view",
      });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const colorId = searchParams.get("colorId") || null;
    const dyeId = searchParams.get("dyeId") || null;
    // Whole positive integers only — e.g. "365" for the last year. Absent
    // (or invalid) means no lower bound, preserving the Sample Material Rate
    // modal's own existing "every real rate ever paid" behavior exactly.
    const sinceDaysParam = searchParams.get("sinceDays");
    const sinceDays = sinceDaysParam && /^\d+$/.test(sinceDaysParam) ? Number(sinceDaysParam) : null;
    const sinceDate = sinceDays ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000) : undefined;

    const result = await getMaterialRateHistory(session.user.companyId, id, colorId, dyeId, sinceDate);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
