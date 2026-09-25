import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createBranch, listBranches } from "@/modules/administration/branch.service";
import { branchSchema } from "@/modules/administration/branch.schema";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "view");

    const branches = await listBranches(session.user.companyId);
    return NextResponse.json({ data: branches });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const input = branchSchema.parse(await req.json());
    const branch = await createBranch({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: branch }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
