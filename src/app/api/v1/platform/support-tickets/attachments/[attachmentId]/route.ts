import { NextRequest } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { getPlatformAttachment } from "@/modules/support-tickets/support-ticket.service";
import { fileResponse } from "@/modules/support-tickets/support-ticket.http";

export async function GET(req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    await requirePlatformSession();
    const { attachmentId } = await params;
    const { attachment, buffer } = await getPlatformAttachment(attachmentId);
    return fileResponse(attachment, buffer, req.nextUrl.searchParams.get("disposition") === "inline");
  } catch (error) {
    return handleApiError(error);
  }
}
