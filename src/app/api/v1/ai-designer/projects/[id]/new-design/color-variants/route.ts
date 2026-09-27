import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { colorVariantsSchema } from "@/modules/ai-designer/new-design.schema";
import { generateColorVariants, listColorVariants } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");
    const { id } = await params;
    const data = await listColorVariants({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;
    const input = colorVariantsSchema.parse(await req.json());
    const data = await generateColorVariants({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
