import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { proposeMaterialSubstitutionSchema } from "@/modules/inventory/material-substitution.schema";
import { proposeApproveAndIssueMaterialSubstitution } from "@/modules/inventory/material-substitution.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

/**
 * The authorized Production Manager/Supervisor fast path — "Substitute +
 * Approve + Issue in one controlled action" (decision #3). Requires BOTH
 * `inventory`/`edit` (the same gate propose/issue already need) and
 * `production`/`approve` (re-asserted inside the service itself) — checked
 * here up front too so an unauthorized caller gets a clean 403 before any
 * write happens, rather than a partial propose followed by a failed issue.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "edit");
    await PermissionService.assert(session.user.id, "production", "approve");

    const { lineId } = await params;
    const { autoApprove: _autoApprove, ...input } = proposeMaterialSubstitutionSchema.parse(await req.json());
    void _autoApprove; // forced to true unconditionally inside the service — see its own doc comment
    const substitution = await proposeApproveAndIssueMaterialSubstitution(
      { companyId: session.user.companyId, userId: session.user.id },
      lineId,
      input
    );

    return NextResponse.json({ data: substitution }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
