import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { linkErpDocument, listOpportunityErpDocuments } from "@/modules/crm/opportunities/crm-opportunity-erp.service";

/** Linked ERP documents (buyer enquiries, sample requests, sales orders) with live ERP data, per-module permission and branch scope. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listOpportunityErpDocuments(actor, params.id) }));

/** Body: { docType, docId } — links an existing ERP document (never creates or edits one). */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await linkErpDocument(actor, params.id, await req.json()) }, { status: 201 }));
