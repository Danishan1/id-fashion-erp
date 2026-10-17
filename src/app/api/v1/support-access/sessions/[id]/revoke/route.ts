import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { revokeSupportSession } from "@/modules/support-access/support-access.service";

/** PLAT-014: instant revocation. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    await revokeSupportSession(actor, id);
    return NextResponse.json({ data: { ok: true } }, { headers: { "x-toast-success": "Support access revoked." } });
  } catch (error) {
    return handleApiError(error);
  }
}
