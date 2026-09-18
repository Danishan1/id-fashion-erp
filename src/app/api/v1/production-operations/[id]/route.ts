import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionOperationSchema } from "@/modules/production/production.schema";
import { updateProductionOperation, setProductionOperationActiveStatus } from "@/modules/production/production-operation.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "edit");

    const { id } = await params;
    const body = await req.json();

    if (typeof body.isActive === "boolean" && Object.keys(body).length === 1) {
      const updated = await setProductionOperationActiveStatus(
        { companyId: session.user.companyId, userId: session.user.id },
        id,
        body.isActive
      );
      return NextResponse.json({ data: updated });
    }

    const input = productionOperationSchema.parse(body);
    const updated = await updateProductionOperation({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
