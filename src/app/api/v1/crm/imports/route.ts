import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { listImportJobs, uploadImportFile } from "@/modules/crm/imports/crm-import.service";
import { importJobListQuerySchema } from "@/modules/crm/imports/crm-import.schema";
import { MAX_IMPORT_BYTES } from "@/modules/crm/imports/import-file";

/** GET: import history (own imports, or all with crm.view_all). POST (multipart `file`): upload a CSV/XLSX — nothing is imported yet. */
export const GET = crmRoute("create", async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams);
  const { status } = importJobListQuerySchema.parse({ status: req.nextUrl.searchParams.get("status") || undefined });
  const { data, totalCount } = await listImportJobs(actor, { status, skip: query.skip, take: query.take });
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64 * 1024) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The file is larger than 20 MB.");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a file to upload.", { fieldErrors: { file: "Choose a file." } });
  if (file.size > MAX_IMPORT_BYTES) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", "The file is larger than 20 MB.");
  const job = await uploadImportFile(actor, { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
  return NextResponse.json({ data: job }, { status: 201 });
});
