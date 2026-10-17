import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { createTicketSchema } from "@/modules/support-tickets/support-ticket.schema";
import { createTicket, listTenantTickets } from "@/modules/support-tickets/support-ticket.service";
import { filesFromForm, requireTicketUser } from "@/modules/support-tickets/support-ticket.http";

/** PLAT-028: my tickets (the company's Super Admin sees all of the company's). `?open=1` = not resolved/closed. */
export async function GET(req: NextRequest) {
  try {
    const { actor } = await requireTicketUser();
    const open = req.nextUrl.searchParams.get("open") === "1";
    return NextResponse.json({ data: await listTenantTickets(actor, { status: open ? "OPEN_ONLY" : "ALL" }) });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Multipart: subject, category, priority, body, files[]. */
export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireTicketUser();
    const form = await req.formData();
    const input = createTicketSchema.parse({
      subject: form.get("subject"),
      category: form.get("category") || undefined,
      priority: form.get("priority") || undefined,
      body: form.get("body"),
    });
    const ticket = await createTicket(actor, input, await filesFromForm(form));
    return NextResponse.json(
      { data: ticket },
      { status: 201, headers: { "x-toast-success": `Ticket ${ticket.ticketNumber} raised.` } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
