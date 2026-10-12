import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setForwarderActiveStatus } from "@/modules/forwarders/forwarder.service";

const statusSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const { isActive } = statusSchema.parse(await req.json());
    const forwarder = await setForwarderActiveStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      isActive
    );
    return NextResponse.json({ data: forwarder });
  } catch (error) {
    return handleApiError(error);
  }
}
