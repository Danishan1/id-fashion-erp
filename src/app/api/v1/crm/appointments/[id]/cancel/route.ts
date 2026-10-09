import { NextResponse } from "next/server";
import { cancelAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, reason? } → Cancelled (pending reminder cancelled); idempotent. Emits appointment.cancelled. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await cancelAppointment(actor, params.id, await req.json().catch(() => ({}))) }));
