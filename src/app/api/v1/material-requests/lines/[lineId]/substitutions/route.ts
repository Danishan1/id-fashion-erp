import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { proposeMaterialSubstitutionSchema } from "@/modules/inventory/material-substitution.schema";
import { listMaterialSubstitutionsForLine, proposeMaterialSubstitution } from "@/modules/inventory/material-substitution.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "view");

    const { lineId } = await params;
    const substitutions = await listMaterialSubstitutionsForLine({ companyId: session.user.companyId, userId: session.user.id }, lineId);

    return NextResponse.json({ data: substitutions });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "material_request", "edit");

    const { lineId } = await params;
    const input = proposeMaterialSubstitutionSchema.parse(await req.json());
    const substitution = await proposeMaterialSubstitution({ companyId: session.user.companyId, userId: session.user.id }, lineId, input);

    return NextResponse.json({ data: substitution }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
