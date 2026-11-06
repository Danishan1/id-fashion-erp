import { NextResponse } from "next/server";
import { bulkRoute, readJsonBody } from "@/modules/bulk-actions/bulk-route";
import { createBulkSchedule, listBulkSchedules } from "@/modules/bulk-actions/bulk-schedules.service";

/**
 * Phase 14 (S&M) — saved bulk-job schedules.
 *   GET  ?entityTypes=ENQUIRY,QUOTATION   own schedules + those of record types you administer
 *   POST { name, entityType, actionKey, filterQuery, params, frequency: DAILY|WEEKLY|MONTHLY,
 *          timeOfDay: "HH:MM", dayOfWeek?, dayOfMonth? }  (schedulable actions only; India time)
 */
export const GET = bulkRoute(async ({ req, actor }) => {
  const types = req.nextUrl.searchParams.get("entityTypes")?.split(",").map((s) => s.trim()).filter(Boolean);
  return NextResponse.json({ data: await listBulkSchedules(actor, { entityTypes: types?.length ? types : undefined }) });
});

export const POST = bulkRoute(async ({ req, actor }) => NextResponse.json({ data: await createBulkSchedule(actor, await readJsonBody(req)) }, { status: 201 }));
