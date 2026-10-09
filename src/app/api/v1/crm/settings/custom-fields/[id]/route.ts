import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateCustomField } from "@/modules/crm/custom-fields/crm-custom-fields.service";

/** Label, description, options, required, active, order. Key and type can't change. */
export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateCustomField(actor, params.id, await req.json()) })
);
