import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeCompanyTags } from "@/modules/crm/companies/crm-companies.service";
import { entityTagChangeSchema } from "@/modules/crm/tags/crm-tag.schema";

/** Body: { addTagIds?, addTagNames?, removeTagIds? } — names are created if they don't exist. Returns the company's tags. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const change = entityTagChangeSchema.parse(await req.json());
  return NextResponse.json({ data: await changeCompanyTags(actor, params.id, change) });
});
