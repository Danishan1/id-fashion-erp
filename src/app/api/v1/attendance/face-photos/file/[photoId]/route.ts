import { NextRequest, NextResponse } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { deleteFacePhoto, readFacePhoto } from "@/modules/hrms/face-enrolment.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  return hrmsRoute("hrms_attendance", "view", async (actor) => {
    const file = await readFacePhoto(actor, photoId);
    return new NextResponse(new Uint8Array(file.buffer), { headers: { "Content-Type": file.mimeType, "Cache-Control": "private, max-age=300" } });
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ photoId: string }> }) {
  const { photoId } = await params;
  return hrmsRoute("hrms_attendance", "edit", (actor) => deleteFacePhoto(actor, photoId));
}
