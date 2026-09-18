import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { productionOperationSchema } from "@/modules/production/production.schema";
import { listProductionOperations, createProductionOperation } from "@/modules/production/production-operation.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "view");
    const data = await listProductionOperations(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "create");
    const input = productionOperationSchema.parse(await req.json());
    const operation = await createProductionOperation(
      { companyId: session.user.companyId, userId: session.user.id },
      input
    );
    return NextResponse.json({ data: operation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
