import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { employeeCategorySchema } from "@/modules/hr-config/hr-config.schema";
import { listEmployeeCategories, createEmployeeCategory } from "@/modules/hr-config/hr-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listEmployeeCategories(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = employeeCategorySchema.parse(await req.json());
    const category = await createEmployeeCategory({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: category }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
