import { NextResponse } from "next/server";
import { getAppointmentMeta } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Statuses (with allowed transitions), actions, reminders, appointment types, cancel / no-show reasons, outcomes, default zone. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getAppointmentMeta(actor) }));
