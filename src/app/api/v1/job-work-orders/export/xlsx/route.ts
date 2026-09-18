import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buildXlsxBuffer, xlsxResponseHeaders } from "@/lib/xlsx";
import { listJobWorkOrders } from "@/modules/production/job-work-order.service";
import { EXPORT_ROW_CAP_EXCEL as EXPORT_ROW_CAP } from "@/core/reports/constants";

// See the identical comment in products/export/xlsx/route.ts — the same
// repository-return-type inference gap, confirmed present at runtime by
// JobWorkOrderRepository.findMany's own `include`.
interface JobWorkOrderExportRow {
  jobWorkNumber: string;
  supplier: { name: string };
  jobOrder: { jobNumber: string; lot: { lotNumber: string } };
  issuedQuantity: unknown;
  receivedQuantity: unknown;
  rejectedQuantity: unknown;
  damagedQuantity: unknown;
  status: string;
  issueDate: Date;
  metrics: { pendingQuantity: number; daysElapsed: number; isOverdue: boolean };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "export");
    // External Unit User (2026-09-18) — blocked outright, even filtered to
    // their own supplier: a spreadsheet export of this business document
    // type is an internal audit tool, not something a vendor's own account
    // should be able to download.
    if ((await PermissionService.getAllowedSupplierId(session.user.id)) !== null) {
      throw new BusinessRuleError("PERMISSION_DENIED", "This action is not available to an external unit account.", {});
    }

    const params = req.nextUrl.searchParams;
    const { data } = await listJobWorkOrders(session.user.companyId, {
      page: 1,
      pageSize: EXPORT_ROW_CAP,
      skip: 0,
      take: EXPORT_ROW_CAP,
      search: params.get("search") || undefined,
      sortBy: "createdAt",
      sortOrder: "desc",
      supplierId: params.get("supplierId") || undefined,
      overdueOnly: params.get("overdueOnly") === "true",
    });

    const buffer = await buildXlsxBuffer(
      "Job Work Orders",
      [
        { header: "Job-Work #", key: "jobWorkNumber" },
        { header: "Contractor", key: "contractor" },
        { header: "Lot", key: "lot" },
        { header: "Job Order", key: "jobOrder" },
        { header: "Issued", key: "issued", type: "number" },
        { header: "Received", key: "received", type: "number" },
        { header: "Rejected", key: "rejected", type: "number" },
        { header: "Damaged", key: "damaged", type: "number" },
        { header: "Pending", key: "pending", type: "number" },
        { header: "Days Elapsed", key: "daysElapsed", type: "number" },
        { header: "Overdue", key: "overdue" },
        { header: "Status", key: "status" },
        { header: "Issue Date", key: "issueDate", type: "date" },
      ],
      (data as unknown as JobWorkOrderExportRow[]).map((o) => ({
        jobWorkNumber: o.jobWorkNumber,
        contractor: o.supplier.name,
        lot: o.jobOrder.lot.lotNumber,
        jobOrder: o.jobOrder.jobNumber,
        issued: Number(o.issuedQuantity),
        received: Number(o.receivedQuantity),
        rejected: Number(o.rejectedQuantity),
        damaged: Number(o.damagedQuantity),
        pending: o.metrics.pendingQuantity,
        daysElapsed: o.metrics.daysElapsed,
        overdue: o.metrics.isOverdue ? "Yes" : "No",
        status: o.status,
        issueDate: o.issueDate,
      }))
    );

    return new NextResponse(new Uint8Array(buffer), { headers: xlsxResponseHeaders("job-work-orders.xlsx") });
  } catch (error) {
    return handleApiError(error);
  }
}
