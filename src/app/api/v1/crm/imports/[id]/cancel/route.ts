import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { cancelImport } from "@/modules/crm/imports/crm-import.service";

/** Before start: cancels at once. While running: stops after the current batch; unprocessed rows are reported as skipped. */
export const POST = crmRoute<{ id: string }>("create", async ({ params, actor }) => NextResponse.json({ data: await cancelImport(actor, params.id) }));
