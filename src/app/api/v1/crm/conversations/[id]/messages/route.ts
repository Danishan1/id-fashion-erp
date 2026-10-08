import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { sendConversationMessage, type OutgoingFile } from "@/modules/crm/conversations/conversation-messaging.service";
import { listThread } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

const MAX_FILES = 10;

/** GET ?before=<cursor>&limit=50 — one page of the thread (messages, internal notes, events), oldest → newest, plus nextCursor for older items. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await listThread(actor, params.id, { before: sp.get("before") || undefined, limit: sp.get("limit") || undefined }) });
});

/**
 * Reply. JSON { body, subject?, clientMessageId? } or multipart/form-data with
 * the same fields plus files. Checked server-side: permission, channel
 * capabilities, DND / contactability. Returns the message (status SENT,
 * DELIVERED or FAILED with a safe reason) — a provider failure is not an error response.
 */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  let body: Record<string, unknown> = {};
  const files: OutgoingFile[] = [];
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    for (const key of ["body", "subject", "clientMessageId"]) {
      const v = form.get(key);
      if (typeof v === "string" && v !== "") body[key] = v;
    }
    const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
    if (uploads.length > MAX_FILES) throw new BusinessRuleError("VALIDATION_ERROR", `At most ${MAX_FILES} files per message.`);
    for (const f of uploads) files.push({ buffer: Buffer.from(await f.arrayBuffer()), fileName: f.name, mimeType: f.type || "application/octet-stream" });
  } else body = await req.json();
  return NextResponse.json({ data: await sendConversationMessage(actor, params.id, body, files) }, { status: 201 });
});
