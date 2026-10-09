import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { activitySortSchema, parseActivityFilterParams } from "@/modules/crm/activities/activity.schema";
import { createActivity, listActivities } from "@/modules/crm/activities/crm-activities.service";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET: activities with server-side search, filters (types, statuses, priorities,
 * assignedToUserIds, unassigned, mine=assigned|created, due=overdue|today|tomorrow|
 * upcoming|no_due_date|completed, dueFrom/dueTo, state=open|closed, relatedType,
 * entityType+entityId = one record's activities), sort (dueAt, createdAt,
 * completedAt, updatedAt, subject) and paging. Visibility rules apply.
 * POST: create (schedule or log) an activity on a CRM record.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseActivityFilterParams(sp);
  const sort = activitySortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listActivities(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createActivity(actor, await req.json()) }, { status: 201 }));
