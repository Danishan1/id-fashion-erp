import { NextResponse } from "next/server";
import { z } from "zod";
import { getMergePreview } from "@/modules/crm/contacts/contact-merge.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

const query = z.object({ survivorId: z.string().uuid(), mergedId: z.string().uuid() });

/** Both contacts side by side with counts of what will move. */
export const GET = crmRoute("edit", async ({ req, actor }) => {
  const { survivorId, mergedId } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ data: await getMergePreview(actor, survivorId, mergedId) });
});
