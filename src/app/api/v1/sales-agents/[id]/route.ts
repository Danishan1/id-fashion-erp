import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesAgentSchema } from "@/modules/production-config/production-config.schema";
import { updateSalesAgent } from "@/modules/production-config/production-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "edit");

    const { id } = await params;
    const input = salesAgentSchema.parse(await req.json());
    const agent = await updateSalesAgent({ companyId: session.user.companyId }, id, input);
    return NextResponse.json({ data: agent });
  } catch (error) {
    return handleApiError(error);
  }
}
