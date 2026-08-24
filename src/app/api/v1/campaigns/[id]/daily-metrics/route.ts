import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { recordDailyMetricSchema } from "@/modules/marketing/campaign.schema";
import { recordDailyMetric } from "@/modules/marketing/campaign.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const { id } = await params;
    const input = recordDailyMetricSchema.parse(await req.json());
    const metric = await recordDailyMetric(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: metric }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
