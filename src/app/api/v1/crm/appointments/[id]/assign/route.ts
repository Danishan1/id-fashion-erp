import { NextResponse } from "next/server";
import { assignAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, assignedToUserId, allowConflict? } — reassign to another ERP user (conflict-checked). Emits appointment.assigned. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignAppointment(actor, params.id, await req.json().catch(() => ({}))) }));
