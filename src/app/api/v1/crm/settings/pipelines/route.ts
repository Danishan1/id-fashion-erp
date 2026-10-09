import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listPipelinesForSettings } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Pipelines with stages and opportunity counts for Settings → Pipelines. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listPipelinesForSettings(actor.companyId) }));
