import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getWorkflowMeta } from "@/modules/crm/workflows/crm-workflows.service";

/** Builder metadata: triggers, actions, fields, operators, limits and what is not available yet. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await getWorkflowMeta(actor) }));
