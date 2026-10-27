import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { bulkCorrectSessions } from "@/modules/hrms/attendance-session.service";

const schema = z.object({
  corrections: z.array(z.object({ sessionId: z.string().uuid(), checkInAt: z.string().min(1), checkOutAt: z.string().nullable().optional() })).min(1).max(200),
});

export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance_team", "override", async (actor) => bulkCorrectSessions(actor, schema.parse(await req.json()).corrections));
}
