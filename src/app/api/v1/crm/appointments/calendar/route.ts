import { NextResponse } from "next/server";
import { parseAppointmentFilterParams } from "@/modules/crm/appointments/appointment.schema";
import { calendarAppointments } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** GET: every appointment overlapping [from, to) (ISO instants, at most 62 days) with the list filters and ?search=. `truncated` when over 1000. */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(await calendarAppointments(actor, parseAppointmentFilterParams(sp), sp.get("search") ?? undefined));
});
