import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { selectDesignOption } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ optionId: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { optionId } = await params;
    const option = await selectDesignOption({ companyId: session.user.companyId, userId: session.user.id }, optionId);

    return NextResponse.json({ data: option });
  } catch (error) {
    return handleApiError(error);
  }
}
