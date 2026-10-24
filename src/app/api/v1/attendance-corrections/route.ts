import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createAttendanceCorrectionSchema } from "@/modules/hrms/attendance-correction.schema";
import { listAttendanceCorrections, createAttendanceCorrectionRequest } from "@/modules/hrms/attendance-correction.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const { data, totalCount } = await listAttendanceCorrections({ companyId: session.user.companyId, userId: session.user.id }, query, status, {
      mine: req.nextUrl.searchParams.get("mine") === "true",
      type: req.nextUrl.searchParams.get("type") || undefined,
    });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_attendance", "create");

    const input = createAttendanceCorrectionSchema.parse(await req.json());
    const request = await createAttendanceCorrectionRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
