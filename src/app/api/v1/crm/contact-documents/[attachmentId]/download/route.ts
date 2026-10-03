import { NextResponse } from "next/server";
import { downloadContactDocument } from "@/modules/crm/contacts/contact-related.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

export const GET = crmRoute<{ attachmentId: string }>("view", async ({ req, params, actor }) => {
  const { attachment, buffer } = await downloadContactDocument(actor, params.attachmentId);
  const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(attachment.fileSizeBytes),
    },
  });
});
