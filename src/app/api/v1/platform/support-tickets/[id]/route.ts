import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { platformTicketUpdateSchema } from "@/modules/support-tickets/support-ticket.schema";
import { getPlatformTicket, updatePlatformTicket } from "@/modules/support-tickets/support-ticket.service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    return NextResponse.json({ data: await getPlatformTicket(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PLAT-030: status / priority / assignment. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformSession();
    const { id } = await params;
    const input = platformTicketUpdateSchema.parse(await req.json());
    return NextResponse.json({ data: await updatePlatformTicket(id, input) }, { headers: { "x-toast-success": "Ticket updated." } });
  } catch (error) {
    return handleApiError(error);
  }
}
