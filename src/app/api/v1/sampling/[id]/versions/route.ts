import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { sampleVersionSchema } from "@/modules/sampling/sample.schema";
import { addSampleVersion } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const input = sampleVersionSchema.parse(await req.json());
    const result = await addSampleVersion({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
