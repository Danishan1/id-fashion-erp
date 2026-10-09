import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { searchLinkableErpDocuments } from "@/modules/crm/opportunities/crm-opportunity-erp.service";

/** ?docType=&search=&limit= (≤50) — the opportunity customer's ERP documents the user may link. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await searchLinkableErpDocuments(actor, params.id, Object.fromEntries(req.nextUrl.searchParams)) }));
