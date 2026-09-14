import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addMaterialLineSchema } from "@/modules/ai-designer/replicate-design.schema";
import { addMaterialLine, listMaterialLines } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const lines = await listMaterialLines(session.user.companyId, id);

    return NextResponse.json({ data: lines });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const input = addMaterialLineSchema.parse(await req.json());
    const lines = await addMaterialLine({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: lines }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
