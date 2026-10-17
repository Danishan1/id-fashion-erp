import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { closeTicketAsCustomer } from "@/modules/support-tickets/support-ticket.service";
import { requireTicketUser } from "@/modules/support-tickets/support-ticket.http";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireTicketUser();
    const { id } = await params;
    const ticket = await closeTicketAsCustomer(actor, id);
    return NextResponse.json({ data: ticket }, { headers: { "x-toast-success": "Ticket closed." } });
  } catch (error) {
    return handleApiError(error);
  }
}
