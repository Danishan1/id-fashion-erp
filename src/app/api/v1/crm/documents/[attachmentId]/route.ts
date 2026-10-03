import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteCrmDocument } from "@/modules/crm/documents/crm-documents.service";

/** Removes a CRM document (uploader or crm.view_all). Only CRM contact / company attachments are reachable here. */
export const DELETE = crmRoute<{ attachmentId: string }>("edit", async ({ params, actor }) => {
  await deleteCrmDocument(actor, params.attachmentId);
  return NextResponse.json({ data: { id: params.attachmentId } });
});
