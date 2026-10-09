import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { myTaskCounts } from "@/modules/crm/activities/crm-activities.service";

/** My Tasks section counts for the signed-in user (overdue / today / upcoming / no due date). */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await myTaskCounts(actor) }));
