import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getActivityMeta } from "@/modules/crm/activities/crm-activities.service";

/** Activity types, statuses, priorities, reminder choices and outcome suggestions for the composer. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getActivityMeta(actor) }));
