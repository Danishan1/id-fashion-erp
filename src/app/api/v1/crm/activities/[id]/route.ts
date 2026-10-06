import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteActivity, getActivity, updateActivity } from "@/modules/crm/activities/crm-activities.service";

/** GET detail. PATCH / PUT: { version, subject?, description?, priority?, status?, assignedToUserId?, dueDate?, dueTime?, endTime?, reminderMinutes?, outcome?, … }. DELETE: soft delete (not for completed activities). */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getActivity(actor, params.id) }));

export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateActivity(actor, params.id, await req.json()) }));
export const PUT = PATCH;

export const DELETE = crmRoute<{ id: string }>("edit", async ({ params, actor }) => {
  await deleteActivity(actor, params.id);
  return NextResponse.json({ data: { id: params.id, deleted: true } });
});
