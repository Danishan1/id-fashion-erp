import { NextResponse } from "next/server";
import { mergeCompanies } from "@/modules/crm/companies/company-merge.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Body: { survivorId, mergedId, fieldChoices, customFieldChoices?, survivorVersion, mergedVersion }.
 * Every conflicting field must be chosen. Companies linked to different ERP
 * customers can't be merged here. Nothing is deleted.
 */
export const POST = crmRoute("edit", async ({ req, actor }) => NextResponse.json({ data: await mergeCompanies(actor, await req.json()) }));
