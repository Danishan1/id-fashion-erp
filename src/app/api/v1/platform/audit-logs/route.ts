import { NextRequest, NextResponse } from "next/server";
import { requirePlatformSession, handleApiError } from "@/lib/api-route";
import { listPlatformAuditLogs } from "@/modules/platform/platform-audit.service";
import type { AuditAction } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requirePlatformSession(["PLATFORM_SUPER_ADMIN", "SUPPORT_AGENT"]);
    const { searchParams } = new URL(req.url);

    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 50;
    const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!, 10) : 0;
    const action = (searchParams.get("action") as AuditAction) || undefined;
    const companyId = searchParams.get("companyId") || undefined;
    const tableName = searchParams.get("tableName") || undefined;

    const data = await listPlatformAuditLogs({ limit, offset, action, companyId, tableName });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}
