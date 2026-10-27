import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { decideOvertime } from "@/modules/hrms/overtime.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_attendance_overtime", "reject", async (actor) => {
    const { reason } = z.object({ reason: z.string().trim().min(1, "A reason is required") }).parse(await req.json());
    return decideOvertime(actor, id, "REJECTED", reason);
  });
}
