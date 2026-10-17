import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { duplicateTemplate } from "@/modules/crm/templates/crm-templates.service";

/** { name? } → a new DRAFT template with its own id and history, copying the current version. */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await duplicateTemplate(actor, params.id, await req.json().catch(() => ({}))) }, { status: 201 }));
