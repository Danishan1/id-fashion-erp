import { NextResponse } from "next/server";
import { z } from "zod";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createCustomField, listCustomFields } from "@/modules/crm/custom-fields/crm-custom-fields.service";

// Only Lead fields are editable in Phase 02; other entity types open up with their phases.
const entityTypeSchema = z.enum(["LEAD"]);

export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ req, actor }) => {
  const entityType = entityTypeSchema.parse(req.nextUrl.searchParams.get("entityType") ?? "LEAD");
  return NextResponse.json({ data: await listCustomFields(actor.companyId, entityType, { includeInactive: true }) });
});

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => {
  const body = await req.json();
  const entityType = entityTypeSchema.parse(body?.entityType ?? "LEAD");
  return NextResponse.json({ data: await createCustomField(actor, entityType, body) }, { status: 201 });
});
