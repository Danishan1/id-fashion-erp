import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { approveOutdoorSessions, listUnverifiedSessions } from "@/modules/hrms/outdoor-attendance.service";

/** Outside punches waiting for a decision. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_attendance_outdoor", ["approve", "reject"], (actor) =>
    listUnverifiedSessions(actor, { month: p.get("month") || undefined, employeeId: p.get("employeeId") || undefined })
  );
}

/** Bulk approve outside punches as they are. */
export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance_outdoor", "approve", async (actor) => {
    const { sessionIds } = z.object({ sessionIds: z.array(z.string().uuid()).min(1).max(500) }).parse(await req.json());
    return approveOutdoorSessions(actor, sessionIds);
  });
}
