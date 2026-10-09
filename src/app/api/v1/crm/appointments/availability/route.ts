import { NextResponse } from "next/server";
import { checkAvailability } from "@/modules/crm/appointments/crm-appointments.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET ?assignedToUserId=&startAt=&endAt= (or startDate, startTime, endDate?, endTime, timezone) [&excludeId=]
 * → { available, conflicts[] }. Titles of appointments the caller can't open show as "Busy".
 */
export const GET = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await checkAvailability(actor, Object.fromEntries(req.nextUrl.searchParams)) }));
