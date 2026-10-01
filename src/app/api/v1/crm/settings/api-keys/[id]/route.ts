import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { revokeApiKey, updateApiKey } from "@/modules/crm/capture/crm-api-keys.service";

const EDIT = { module: "crm_settings", action: "edit" } as const;

export const PATCH = crmRoute<{ id: string }>(EDIT, async ({ req, params, actor }) => NextResponse.json({ data: await updateApiKey(actor, params.id, await req.json()) }));

/** Revokes the key (kept for history; requests with it get 401). */
export const DELETE = crmRoute<{ id: string }>(EDIT, async ({ params, actor }) => NextResponse.json({ data: await revokeApiKey(actor, params.id) }));
