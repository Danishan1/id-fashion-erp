import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getImportJob, updateImportSetup } from "@/modules/crm/imports/crm-import.service";

export const GET = crmRoute<{ id: string }>("create", async ({ params, actor }) => NextResponse.json({ data: await getImportJob(actor, params.id) }));

/** Body: { mapping: {header: fieldKey|""}, sourceId, duplicatePolicy, options } — resets any earlier preview. */
export const PATCH = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await updateImportSetup(actor, params.id, await req.json()) }));
