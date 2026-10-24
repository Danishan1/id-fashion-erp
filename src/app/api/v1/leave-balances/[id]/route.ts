import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { adjustLeaveBalance } from "@/modules/hrms/leave-balance.service";

const schema = z.object({
  allocated: z.coerce.number().min(0).max(366),
  remaining: z.coerce.number().min(0).max(366),
  carryForward: z.coerce.number().min(0).max(366),
});

/** Admin quota override for one employee-month. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_leave", "edit", async (actor) => adjustLeaveBalance(actor, id, schema.parse(await req.json())));
}
