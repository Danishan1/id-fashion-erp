import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { costMasterSchema } from "@/modules/cost-master/cost-master.schema";
import { listCostMasters, createCostMaster } from "@/modules/cost-master/cost-master.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "view");
    return NextResponse.json({ data: await listCostMasters(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "create");

    const input = costMasterSchema.parse(await req.json());
    const costMaster = await createCostMaster({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: costMaster }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
