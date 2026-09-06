import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createDesignOptionSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { addDesignOption } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = createDesignOptionSchema.parse(await req.json());
    const option = await addDesignOption(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: option }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
