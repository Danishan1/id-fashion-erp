import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deletePreference, setPreference } from "@/modules/crm/preferences/crm-preferences.service";

/** PUT body: { value } — validated per key (crm-preference-registry.ts). DELETE resets to the default. */
export const PUT = crmRoute<{ key: string }>("view", async ({ req, params, actor }) => {
  const body = (await req.json().catch(() => ({}))) as { value?: unknown };
  return NextResponse.json({ data: await setPreference(actor, decodeURIComponent(params.key), body.value) });
});

export const DELETE = crmRoute<{ key: string }>("view", async ({ params, actor }) => {
  await deletePreference(actor, decodeURIComponent(params.key));
  return NextResponse.json({ data: { key: params.key, deleted: true } });
});
