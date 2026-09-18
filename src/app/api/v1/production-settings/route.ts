import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductionSettings, setProductionSettings } from "@/core/production-settings/ProductionSettingsService";

const updateProductionSettingsSchema = z.object({
  supervisorApprovalRequired: z.boolean().optional(),
  externalEntryBy: z.enum(["EXTERNAL_UNIT_USER", "INTERNAL_SUPERVISOR", "BOTH"]).optional(),
  pieceRateTrackingEnabled: z.boolean().optional(),
  pieceRatePaymentQuantityRule: z.enum(["GOOD_COMPLETED_QTY", "QC_ACCEPTED_QTY"]).optional(),
  workersCanViewOwnRate: z.boolean().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const data = await getProductionSettings(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const input = updateProductionSettingsSchema.parse(await req.json());
    const data = await setProductionSettings(session.user.companyId, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
