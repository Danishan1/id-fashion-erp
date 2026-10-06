import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { unlinkErpDocument } from "@/modules/crm/opportunities/crm-opportunity-erp.service";

/** Removes the reference only; the ERP document is untouched. */
export const DELETE = crmRoute<{ id: string; linkId: string }>("edit", async ({ params, actor }) => {
  await unlinkErpDocument(actor, params.id, params.linkId);
  return NextResponse.json({ data: { id: params.linkId } });
});
