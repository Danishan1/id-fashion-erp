import { NextRequest } from "next/server";
import { handleApiError } from "@/lib/api-route";
import { getTenantAttachment } from "@/modules/support-tickets/support-ticket.service";
import { fileResponse, requireTicketUser } from "@/modules/support-tickets/support-ticket.http";

export async function GET(req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const { actor } = await requireTicketUser();
    const { attachmentId } = await params;
    const { attachment, buffer } = await getTenantAttachment(actor, attachmentId);
    return fileResponse(attachment, buffer, req.nextUrl.searchParams.get("disposition") === "inline");
  } catch (error) {
    return handleApiError(error);
  }
}
