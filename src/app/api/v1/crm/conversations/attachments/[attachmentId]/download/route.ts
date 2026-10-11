import { NextResponse } from "next/server";
import { downloadMessageAttachment } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** A message attachment, after checking the caller can open its conversation. ?disposition=inline for previews. */
export const GET = crmRoute<{ attachmentId: string }>("view", async ({ req, params, actor }) => {
  const { fileName, mimeType, buffer } = await downloadMessageAttachment(actor, params.attachmentId);
  const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(fileName)}"`,
      "Content-Length": String(buffer.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
});
