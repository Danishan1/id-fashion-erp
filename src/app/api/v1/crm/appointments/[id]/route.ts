import { NextResponse } from "next/server";
import { deleteActivity } from "@/modules/crm/activities/crm-activities.service";
import { getAppointment, updateAppointment } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET detail. PATCH / PUT: { version, title?, description?, appointmentType?, location?, videoLink?, reminderMinutes?,
 * startDate+startTime+endTime (+endDate, timezone) → recorded as a reschedule, contactId?, companyId?, opportunityId?,
 * assignedToUserId?, allowConflict?, reason? } — open appointments only.
 * DELETE: remove a mistaken appointment (soft delete; its creator or a manager; never a completed one). Cancel is the normal way to call one off.
 */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getAppointment(actor, params.id) }));

export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateAppointment(actor, params.id, await req.json()) }));
export const PUT = PATCH;

export const DELETE = crmRoute<{ id: string }>("edit", async ({ params, actor }) => {
  await getAppointment(actor, params.id);
  await deleteActivity(actor, params.id);
  return NextResponse.json({ data: { id: params.id, deleted: true } });
});
