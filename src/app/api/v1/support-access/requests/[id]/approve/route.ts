import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { verificationCodeSchema } from "@/modules/support-access/support-access.schema";
import { approveSupportRequest } from "@/modules/support-access/support-access.service";

/** PLAT-010: the customer's Super Admin approves with the 6-digit code. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    const { code } = verificationCodeSchema.parse(await req.json());
    const session = await approveSupportRequest(actor, id, code);
    return NextResponse.json({ data: session }, { headers: { "x-toast-success": "Support access approved (read-only)." } });
  } catch (error) {
    return handleApiError(error);
  }
}
