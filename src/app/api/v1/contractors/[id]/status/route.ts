import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setContractorActiveStatus } from "@/modules/contractors/contractor.service";

const statusSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const { isActive } = statusSchema.parse(await req.json());
    const contractor = await setContractorActiveStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      isActive
    );
    return NextResponse.json({ data: contractor });
  } catch (error) {
    return handleApiError(error);
  }
}
