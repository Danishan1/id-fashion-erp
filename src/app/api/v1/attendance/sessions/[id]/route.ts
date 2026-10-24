import { NextRequest } from "next/server";
import { z } from "zod";
import { hrmsRoute } from "@/modules/hrms/hrms-route";
import { correctSession } from "@/modules/hrms/attendance-session.service";

const schema = z.object({ checkInAt: z.string().min(1), checkOutAt: z.string().nullable().optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return hrmsRoute("hrms_attendance", "override", async (actor) => correctSession(actor, { sessionId: id, ...schema.parse(await req.json()) }));
}
