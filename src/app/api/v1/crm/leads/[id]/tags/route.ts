import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeLeadTags } from "@/modules/crm/leads/lead.service";
import { entityTagChangeSchema } from "@/modules/crm/tags/crm-tag.schema";

/** Body: { addTagIds?, addTagNames?, removeTagIds? } — names are created if they don't exist. Returns the lead's tags. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const change = entityTagChangeSchema.parse(await req.json());
  return NextResponse.json({ data: await changeLeadTags(actor, params.id, change) });
});
