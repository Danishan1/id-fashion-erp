import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { appointmentSortSchema, parseAppointmentFilterParams } from "@/modules/crm/appointments/appointment.schema";
import { createAppointment, listAppointments } from "@/modules/crm/appointments/crm-appointments.service";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET: appointment list — server-side search (title, location, type, contact,
 * company, opportunity, employee), filters (from/to window, assignedToUserIds,
 * mine, statuses, appointmentTypes (|-separated), contactId, companyId,
 * opportunityId, leadId, when=upcoming|past), sort (startAt, createdAt,
 * updatedAt, title) and paging. Visibility rules apply.
 * POST: create an appointment (409 CRM_APPOINTMENT_CONFLICT when the employee
 * is busy — resend with allowConflict: true to book anyway).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseAppointmentFilterParams(sp);
  const sort = appointmentSortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listAppointments(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createAppointment(actor, await req.json()) }, { status: 201 }));
