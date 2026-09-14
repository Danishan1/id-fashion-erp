import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getDnaAnalysis, runDnaAnalysis } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const { id } = await params;
    const analysis = await getDnaAnalysis(session.user.companyId, id);

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const analysis = await runDnaAnalysis({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: analysis }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
