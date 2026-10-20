import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  listReportingLines,
  setReportingLine,
  setReportingLineSchema,
} from "@/modules/employees/reporting-line.service";

type Params = { params: Promise<{ id: string }> };

/** P3: an employee's per-module managers (Production / CRM / HRMS). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    const { id } = await params;
    const data = await listReportingLines(session.user.companyId, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");
    const { id } = await params;
    const input = setReportingLineSchema.parse(await req.json());
    const line = await setReportingLine({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: line });
  } catch (error) {
    return handleApiError(error);
  }
}
