import { NextRequest } from "next/server";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { decideOvertime } from "@/modules/hrms/overtime.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_attendance_overtime", "approve", (actor) => decideOvertime(actor, id, "APPROVED"));
}
