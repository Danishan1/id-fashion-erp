import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { issueMaterialRequestLineSchema } from "@/modules/inventory/material-request.schema";
import { issueMaterialRequestLine } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");

    const { lineId } = await params;
    const { issueQuantity } = issueMaterialRequestLineSchema.parse(await req.json());
    const line = await issueMaterialRequestLine(
      { companyId: session.user.companyId, userId: session.user.id },
      lineId,
      issueQuantity
    );

    return NextResponse.json({ data: line });
  } catch (error) {
    return handleApiError(error);
  }
}
