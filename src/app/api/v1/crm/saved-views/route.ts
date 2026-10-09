import { NextResponse } from "next/server";
import { z } from "zod";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createSavedView, listSavedViews } from "@/modules/crm/saved-views/crm-saved-views.service";

const entityTypeSchema = z.enum(["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"]);

export const GET = crmRoute("view", async ({ req, actor }) => {
  const entityType = entityTypeSchema.parse(req.nextUrl.searchParams.get("entityType") ?? "LEAD");
  return NextResponse.json({ data: await listSavedViews(actor, entityType) });
});

export const POST = crmRoute("view", async ({ req, actor }) => {
  const body = await req.json();
  const entityType = entityTypeSchema.parse(body?.entityType ?? "LEAD");
  return NextResponse.json({ data: await createSavedView(actor, entityType, body) }, { status: 201 });
});
