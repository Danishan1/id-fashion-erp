import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { reviewImportRows } from "@/modules/crm/imports/crm-import.service";

/** Decide flagged rows. Body: { action: "CREATE" | "UPDATE" | "SKIP", rowIds: [...], leadId? }. */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await reviewImportRows(actor, params.id, await req.json()) }));
