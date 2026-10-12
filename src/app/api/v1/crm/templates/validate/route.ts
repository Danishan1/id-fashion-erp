import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { previewDraft } from "@/modules/crm/templates/crm-templates.service";

/** Validate unsaved editor content (same body as /preview): { valid, errors, warnings, variables, sms? }. channelId adds the provider's checks. */
export const POST = crmRoute("view", async ({ req, actor }) => {
  const r = await previewDraft(actor, await req.json());
  return NextResponse.json({ data: { valid: r.valid, errors: r.errors, warnings: r.warnings, variables: r.variables, ...(r.sms ? { sms: r.sms } : {}) } });
});
