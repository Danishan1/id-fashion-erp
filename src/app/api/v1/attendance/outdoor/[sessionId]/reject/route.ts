import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { rejectOutdoorSession } from "@/modules/hrms/outdoor-attendance.service";

const schema = z.object({
  reason: z.string().trim().min(1, "A reason is required"),
  trimmedCheckInAt: z.string().min(1, "Allowed check-in time is required"),
  trimmedCheckOutAt: z.string().min(1, "Allowed check-out time is required"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return hrmsRoute("hrms_attendance", "reject", async (actor) => rejectOutdoorSession(actor, sessionId, schema.parse(await req.json())));
}
