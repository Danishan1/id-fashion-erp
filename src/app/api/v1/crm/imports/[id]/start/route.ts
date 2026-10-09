import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { startImport } from "@/modules/crm/imports/crm-import.service";

/** Queues the import for the background worker (202). Progress: GET /imports/:id. */
export const POST = crmRoute<{ id: string }>("create", async ({ params, actor }) => NextResponse.json({ data: await startImport(actor, params.id) }, { status: 202 }));
