import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listPipelines } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Pipelines with their stages (read-only until Phase 07 adds pipeline management). */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await listPipelines(actor.companyId) }));
