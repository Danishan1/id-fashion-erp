import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { IncomingFile } from "./support-ticket.service";

/** Customer ticket routes: any signed-in company user, but never a platform support session. */
export async function requireTicketUser() {
  const session = await requireSession();
  if (session.user.userType === "SUPPORT") {
    throw new BusinessRuleError("PERMISSION_DENIED", "Support tickets can't be raised from a support session.");
  }
  return { session, actor: { userId: session.user.id, companyId: session.user.companyId } };
}

/** Reads the "files" entries of a multipart form. */
export async function filesFromForm(form: FormData): Promise<IncomingFile[]> {
  const files: IncomingFile[] = [];
  for (const entry of form.getAll("files")) {
    if (entry instanceof File && entry.size > 0) {
      files.push({
        buffer: Buffer.from(await entry.arrayBuffer()),
        fileName: entry.name,
        mimeType: entry.type || "application/octet-stream",
      });
    }
  }
  return files;
}

export function fileResponse(
  attachment: { mimeType: string; fileName: string; fileSizeBytes: number },
  buffer: Buffer,
  inline: boolean
) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(attachment.fileName)}"`,
      "Content-Length": String(attachment.fileSizeBytes),
    },
  });
}
