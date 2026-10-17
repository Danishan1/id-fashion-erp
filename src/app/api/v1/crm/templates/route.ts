import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { createTemplate, listTemplates } from "@/modules/crm/templates/crm-templates.service";
import { parseTemplateFilterParams, templateSortSchema } from "@/modules/crm/templates/template.schema";

/**
 * Phase 12 — message templates (a shared company library).
 * GET: list without bodies — search (name, description, current text), filters
 * channels / statuses / categoryIds / usable=true, sort (updatedAt, createdAt,
 * name, channelType, status), paging. Archived only when asked for by status.
 * POST: create (DRAFT, version 1).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "updatedAt");
  const sort = templateSortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listTemplates(actor, parseTemplateFilterParams(sp), sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createTemplate(actor, await req.json()) }, { status: 201 }));
