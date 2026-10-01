import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { validateImport } from "@/modules/crm/imports/crm-import.service";

/** Builds the preview: normalizes, validates and duplicate-checks every row. Inline for small files, background for large ones. */
export const POST = crmRoute<{ id: string }>("create", async ({ params, actor }) => NextResponse.json({ data: await validateImport(actor, params.id) }));
