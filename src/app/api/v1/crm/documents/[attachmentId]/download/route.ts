import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { downloadCrmDocument } from "@/modules/crm/documents/crm-documents.service";

/** Downloads a CRM document after checking the caller can see its record. ?disposition=inline for previews. */
export const GET = crmRoute<{ attachmentId: string }>("view", async ({ req, params, actor }) => {
  const { attachment, buffer } = await downloadCrmDocument(actor, params.attachmentId);
  const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(attachment.fileSizeBytes),
    },
  });
});
