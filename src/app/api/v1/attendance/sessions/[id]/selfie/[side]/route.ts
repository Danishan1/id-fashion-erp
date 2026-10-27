import { NextRequest, NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { readSessionSelfie } from "@/modules/hrms/face-enrolment.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; side: string }> }) {
  const { id, side } = await params;
  return hrmsRoute(["hrms_attendance", "hrms_attendance_team", "hrms_attendance_photos", "hrms_attendance_outdoor"], "view", async (actor) => {
    if (side !== "in" && side !== "out") throw new BusinessRuleError("NOT_FOUND", "Selfie not found.");
    const file = await readSessionSelfie(actor, id, side);
    return new NextResponse(new Uint8Array(file.buffer), { headers: { "Content-Type": file.mimeType, "Cache-Control": "private, max-age=300" } });
  });
}
