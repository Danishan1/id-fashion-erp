import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyMergePreview } from "@/modules/crm/companies/company-merge.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

const query = z.object({ survivorId: z.string().uuid(), mergedId: z.string().uuid() });

/** Both companies side by side, the conflicts that need a choice, counts of what moves, and any ERP conflict. */
export const GET = crmRoute("edit", async ({ req, actor }) => {
  const { survivorId, mergedId } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ data: await getCompanyMergePreview(actor, survivorId, mergedId) });
});
