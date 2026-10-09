import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteTag, updateTag } from "@/modules/crm/tags/crm-tags.service";

const SETTINGS_EDIT = { module: "crm_settings", action: "edit" } as const;

export const PATCH = crmRoute<{ id: string }>(SETTINGS_EDIT, async ({ req, params, actor }) => NextResponse.json({ data: await updateTag(actor, params.id, await req.json()) }));

/** Removes the tag from every record. */
export const DELETE = crmRoute<{ id: string }>(SETTINGS_EDIT, async ({ params, actor }) => {
  await deleteTag(actor, params.id);
  return NextResponse.json({ data: { id: params.id } });
});
