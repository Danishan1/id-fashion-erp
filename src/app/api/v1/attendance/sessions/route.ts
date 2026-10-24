import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { addManualSession, listSessions } from "@/modules/hrms/attendance-session.service";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return hrmsRoute("hrms_attendance", "view", (actor) =>
    listSessions(actor, {
      employeeId: p.get("employeeId") || undefined,
      month: p.get("month") || undefined,
      date: p.get("date") || undefined,
      outsideOnly: p.get("outsideOnly") === "true",
    })
  );
}

const manualSchema = z.object({
  employeeId: z.string().uuid("Employee is required"),
  attendanceDate: z.string().min(1, "Date is required"),
  checkIn: z.string().min(1, "Check-in time is required"),
  checkOut: z.string().optional().nullable().or(z.literal("")),
  remarks: z.string().max(500).optional().nullable().or(z.literal("")),
});

/** Admin manual entry ("override"; HR "edit" also allowed). */
export async function POST(req: NextRequest) {
  return hrmsRoute("hrms_attendance", ["override", "edit"], async (actor) => addManualSession(actor, manualSchema.parse(await req.json())), 201);
}
