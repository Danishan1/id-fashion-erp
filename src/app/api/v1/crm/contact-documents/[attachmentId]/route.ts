import { NextResponse } from "next/server";
import { deleteContactDocument } from "@/modules/crm/contacts/contact-related.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Removes a contact document (uploader or crm.view_all). Only CRM contact attachments are reachable here. */
export const DELETE = crmRoute<{ attachmentId: string }>("edit", async ({ params, actor }) => {
  await deleteContactDocument(actor, params.attachmentId);
  return NextResponse.json({ data: { id: params.attachmentId } });
});
