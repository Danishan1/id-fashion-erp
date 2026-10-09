import { NextResponse } from "next/server";
import { changeContactTags } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { entityTagChangeSchema } from "@/modules/crm/tags/crm-tag.schema";

/** Body: { addTagIds?, addTagNames?, removeTagIds? } — names are created if they don't exist. Returns the contact's tags. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  const change = entityTagChangeSchema.parse(await req.json());
  return NextResponse.json({ data: await changeContactTags(actor, params.id, change) });
});
