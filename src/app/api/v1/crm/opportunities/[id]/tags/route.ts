import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeOpportunityTags } from "@/modules/crm/opportunities/crm-opportunities.service";
import { entityTagChangeSchema } from "@/modules/crm/tags/crm-tag.schema";

/** Body: { addTagIds?, addTagNames?, removeTagIds? } — names are created if they don't exist. Returns the opportunity's tags. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const change = entityTagChangeSchema.parse(await req.json());
  return NextResponse.json({ data: await changeOpportunityTags(actor, params.id, change) });
});
