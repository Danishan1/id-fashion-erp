import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { getTenantTicket } from "@/modules/support-tickets/support-ticket.service";
import { requireTicketUser } from "@/modules/support-tickets/support-ticket.http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireTicketUser();
    const { id } = await params;
    return NextResponse.json({ data: await getTenantTicket(actor, id) });
  } catch (error) {
    return handleApiError(error);
  }
}
