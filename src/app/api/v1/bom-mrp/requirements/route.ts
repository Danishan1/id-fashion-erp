import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getMaterialRequirements } from "@/modules/bom-mrp/mrp.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "bom_mrp", "view");

    const salesOrderId = req.nextUrl.searchParams.get("salesOrderId");
    if (!salesOrderId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "salesOrderId is required.");
    }

    const data = await getMaterialRequirements(session.user.companyId, salesOrderId);

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
