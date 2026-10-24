import { NextRequest, NextResponse } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { readCorrectionDocument } from "@/modules/hrms/attendance-correction.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params;
  return hrmsRoute("hrms_attendance", "view", async (actor) => {
    const { attachment, buffer } = await readCorrectionDocument(actor, id, attachmentId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": attachment.mimeType, "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"` },
    });
  });
}
