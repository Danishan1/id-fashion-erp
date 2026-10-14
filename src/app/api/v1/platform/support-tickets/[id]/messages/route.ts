import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { platformReplySchema } from "@/modules/support-tickets/support-ticket.schema";
import { replyAsPlatform } from "@/modules/support-tickets/support-ticket.service";
import { filesFromForm } from "@/modules/support-tickets/support-ticket.http";

/** Multipart: body, isInternal ("true"), status (optional), files[]. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { platformUser } = await requirePlatformSession();
    const { id } = await params;
    const form = await req.formData();
    const input = platformReplySchema.parse({
      body: form.get("body"),
      isInternal: form.get("isInternal") === "true",
      status: form.get("status") || undefined,
    });
    const message = await replyAsPlatform(
      { platformUserId: platformUser.id, role: platformUser.role },
      id,
      input,
      await filesFromForm(form)
    );
    return NextResponse.json(
      { data: message },
      { status: 201, headers: { "x-toast-success": input.isInternal ? "Internal note added." : "Reply sent." } }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
