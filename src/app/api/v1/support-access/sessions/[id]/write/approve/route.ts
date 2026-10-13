import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { verificationCodeSchema } from "@/modules/support-access/support-access.schema";
import { approveWriteAccess } from "@/modules/support-access/support-access.service";

/** PLAT-013: the second, separate approval for write access. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    const { code } = verificationCodeSchema.parse(await req.json());
    await approveWriteAccess(actor, id, code);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Write access approved." } });
  } catch (error) {
    return handleApiError(error);
  }
}
