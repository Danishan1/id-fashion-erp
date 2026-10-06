import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createPipeline, listPipelines } from "@/modules/crm/pipelines/crm-pipelines.service";

/**
 * GET: pipelines with their stages for pickers and filters (crm.view; ?includeArchived=0 hides archived ones).
 * POST: create a pipeline (CRM settings edit). Body: { name, description?, isDefault?, stages?: [{ name, probability?, description?, isDefault? }] }.
 */
export const GET = crmRoute("view", async ({ req, actor }) =>
  NextResponse.json({ data: await listPipelines(actor.companyId, { includeArchived: req.nextUrl.searchParams.get("includeArchived") !== "0" }) })
);

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createPipeline(actor, await req.json()) }, { status: 201 }));
