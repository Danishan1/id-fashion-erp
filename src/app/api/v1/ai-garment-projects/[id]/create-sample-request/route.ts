import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createSampleRequestFromProjectSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { createSampleRequestFromProject } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");
    // Creating a Sample Request is a real sampling.create action too —
    // matches this app's "assert the permission the action actually needs,
    // not only the one the route happens to sit under" discipline.
    await PermissionService.assert(session.user.id, "sampling", "create");

    const { id } = await params;
    const input = createSampleRequestFromProjectSchema.parse(await req.json());
    const result = await createSampleRequestFromProject(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
