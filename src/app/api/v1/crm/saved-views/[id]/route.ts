import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteSavedView, updateSavedView } from "@/modules/crm/saved-views/crm-saved-views.service";

export const PATCH = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await updateSavedView(actor, params.id, await req.json()) }));

export const DELETE = crmRoute<{ id: string }>("view", async ({ params, actor }) => {
  await deleteSavedView(actor, params.id);
  return NextResponse.json({ data: { id: params.id } });
});
