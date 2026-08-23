import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { getMaterialRequestById } from "@/modules/inventory/material-request.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Scoped down to this request's own audit rows (material_requests +
 * material_request_items for its own lines) — not a merged cross-table
 * feed spanning linked Purchase Orders/Goods Receipts. Deep-linking into a
 * linked PO's own detail page is how a user follows the trail further.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const { id } = await params;
    const request = await getMaterialRequestById(session.user.companyId, id);
    const recordIds = [id, ...request.lines.map((l) => l.id)];

    const entries = await prisma.auditLog.findMany({
      where: {
        companyId: session.user.companyId,
        recordId: { in: recordIds },
        tableName: { in: ["material_requests", "material_request_items"] },
      },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { performedAt: "asc" },
    });

    return NextResponse.json({ data: entries });
  } catch (error) {
    return handleApiError(error);
  }
}
