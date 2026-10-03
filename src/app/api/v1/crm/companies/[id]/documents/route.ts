import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listCrmDocuments, uploadCrmDocument } from "@/modules/crm/documents/crm-documents.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listCrmDocuments(actor, "COMPANY", params.id) }));

/** multipart/form-data: file (required), label (optional). Same file rules as every ERP attachment (type list, 20 MB). */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
  const label = form.get("label");
  const buffer = Buffer.from(await file.arrayBuffer());
  const data = await uploadCrmDocument(actor, "COMPANY", params.id, { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }, typeof label === "string" ? label : null);
  return NextResponse.json({ data }, { status: 201 });
});
