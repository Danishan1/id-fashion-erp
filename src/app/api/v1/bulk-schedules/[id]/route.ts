import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { bulkRoute, readJsonBody } from "@/modules/bulk-actions/bulk-route";
import { bulkScheduleAction, getBulkSchedule, updateBulkSchedule } from "@/modules/bulk-actions/bulk-schedules.service";

/**
 * Phase 14 (S&M) — one schedule (owner, or an admin of its record type).
 *   GET                          detail
 *   PATCH { version, name, params, frequency, timeOfDay, dayOfWeek?, dayOfMonth? }
 *   POST  { action: pause|resume|delete, version }
 */
type Params = { id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (p: Params) => {
  if (!UUID.test(p.id)) throw new BusinessRuleError("NOT_FOUND", "Schedule not found.");
  return p.id;
};

export const GET = bulkRoute<Params>(async ({ params, actor }) => NextResponse.json({ data: await getBulkSchedule(actor, idOf(params)) }));
export const PATCH = bulkRoute<Params>(async ({ req, params, actor }) => NextResponse.json({ data: await updateBulkSchedule(actor, idOf(params), await readJsonBody(req)) }));
export const POST = bulkRoute<Params>(async ({ req, params, actor }) => NextResponse.json({ data: await bulkScheduleAction(actor, idOf(params), await readJsonBody(req)) }));
