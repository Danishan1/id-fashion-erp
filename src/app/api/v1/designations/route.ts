import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { designationSchema } from "@/modules/hr-config/hr-config.schema";
import { listDesignations, createDesignation } from "@/modules/hr-config/hr-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listDesignations(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = designationSchema.parse(await req.json());
    const designation = await createDesignation({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: designation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
