import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { selectDesignForDevelopmentSchema } from "@/modules/ai-garment-flow/commercial-evaluation.schema";
import { selectDesignForDevelopment } from "@/modules/ai-garment-flow/commercial-evaluation.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = selectDesignForDevelopmentSchema.parse(await req.json());
    const project = await selectDesignForDevelopment({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}
