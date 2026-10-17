import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { replySchema } from "@/modules/support-tickets/support-ticket.schema";
import { replyAsCustomer } from "@/modules/support-tickets/support-ticket.service";
import { filesFromForm, requireTicketUser } from "@/modules/support-tickets/support-ticket.http";

/** Multipart: body, files[]. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireTicketUser();
    const { id } = await params;
    const form = await req.formData();
    const { body } = replySchema.parse({ body: form.get("body") });
    const message = await replyAsCustomer(actor, id, body, await filesFromForm(form));
    return NextResponse.json({ data: message }, { status: 201, headers: { "x-toast-success": "Reply sent." } });
  } catch (error) {
    return handleApiError(error);
  }
}
