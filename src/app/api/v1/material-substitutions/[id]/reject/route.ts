import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { decideMaterialSubstitutionSchema } from "@/modules/inventory/material-substitution.schema";
import { rejectMaterialSubstitution } from "@/modules/inventory/material-substitution.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** A coarse door-check here (module-level, no resourceContext) — the real,
 * self-approval-guarded gate lives inside rejectMaterialSubstitution() itself. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const { id } = await params;
    const input = decideMaterialSubstitutionSchema.parse(await req.json().catch(() => ({})));
    const substitution = await rejectMaterialSubstitution({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: substitution });
  } catch (error) {
    return handleApiError(error);
  }
}
