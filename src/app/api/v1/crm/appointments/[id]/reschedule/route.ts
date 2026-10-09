import { NextResponse } from "next/server";
import { rescheduleAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version?, startDate, startTime, endDate?, endTime, timezone?, reminderMinutes?, reason?, allowConflict? } → Rescheduled. 409 CRM_APPOINTMENT_CONFLICT when the employee is busy. Emits appointment.rescheduled. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await rescheduleAppointment(actor, params.id, await req.json().catch(() => ({}))) }));
