import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setDnaObservationLockSchema } from "@/modules/ai-designer/replicate-design.schema";
import { setDnaObservationLock } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string; observationId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { observationId } = await params;
    const input = setDnaObservationLockSchema.parse(await req.json());
    const observation = await setDnaObservationLock({ companyId: session.user.companyId, userId: session.user.id }, observationId, input);

    return NextResponse.json({ data: observation });
  } catch (error) {
    return handleApiError(error);
  }
}
