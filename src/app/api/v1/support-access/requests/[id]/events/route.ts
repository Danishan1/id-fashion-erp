import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { requireTenantSupportActor } from "@/modules/support-access/support-access.route-helpers";
import { getSupportRequestEvents } from "@/modules/support-access/support-access.service";

/** PLAT-015: the support event log for one request, with its hash-chain check. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireTenantSupportActor();
    const { id } = await params;
    return NextResponse.json({ data: await getSupportRequestEvents(actor, id) });
  } catch (error) {
    return handleApiError(error);
  }
}
