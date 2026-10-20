import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { installDefaultWorkflows, listDefaultWorkflows } from "@/modules/crm/workflows/crm-workflows.service";

/**
 * Default CRM automations (default-workflows.ts).
 * GET: the catalogue and which ones this company already has.
 * POST { keys? }: adds the missing ones (all, or the listed keys), published with
 * the caller as run-as user; on or off per the catalogue. Never duplicates or overwrites.
 */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listDefaultWorkflows(actor) }));

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await installDefaultWorkflows(actor, body ?? {}) });
});
