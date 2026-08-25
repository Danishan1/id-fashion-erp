import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "audit" as const;

const MAX_ACTIVITY_ROWS = 2000;

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. User Activity — raw AuditLog rows, capped at MAX_ACTIVITY_ROWS most
// recent (audit logs can be very large; the real total is still reported via
// a separate count() so the cap is visible, not silently hiding data).
// ---------------------------------------------------------------------------
async function getUserActivityDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const where = {
    companyId,
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(dateFrom || dateTo ? { performedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
  };

  const [logs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        tableName: true,
        recordId: true,
        action: true,
        ipAddress: true,
        performedAt: true,
        user: { select: { fullName: true } },
      },
      orderBy: { performedAt: "desc" },
      take: MAX_ACTIVITY_ROWS,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const rows = logs.map((log) => ({
    performedAt: log.performedAt.toLocaleString(),
    user: log.user?.fullName ?? "System",
    tableName: log.tableName,
    recordId: log.recordId,
    action: log.action,
    ipAddress: log.ipAddress ?? "—",
  }));

  const cappedNote =
    totalCount > MAX_ACTIVITY_ROWS
      ? ` Showing the ${MAX_ACTIVITY_ROWS.toLocaleString()} most recent of ${totalCount.toLocaleString()} matching entries — narrow the date range to see older activity.`
      : "";

  return {
    title: "User Activity",
    subtitle: `Audit log of every tracked create/update/approve/reject/post/cancel/delete action in the system.${cappedNote}`,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", userId: "User" }),
    columns: [
      { key: "performedAt", label: "Date", type: "text" },
      { key: "user", label: "User" },
      { key: "tableName", label: "Table" },
      { key: "recordId", label: "Record Id", type: "text" },
      { key: "action", label: "Action" },
      { key: "ipAddress", label: "IP Address" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Last Login per User — this ERP has no true login-history table, only a
// single overwritten `User.lastLoginAt` timestamp per user. This report is
// exactly that field, one row per user — not a fabricated history list.
// ---------------------------------------------------------------------------
async function getLastLoginPerUserDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const users = await prisma.user.findMany({
    where: { companyId },
    select: { id: true, fullName: true, email: true, status: true, lastLoginAt: true },
  });

  const sorted = [...users].sort((a, b) => (b.lastLoginAt?.getTime() ?? -1) - (a.lastLoginAt?.getTime() ?? -1));
  const rows = sorted.map((u) => ({
    fullName: u.fullName,
    email: u.email,
    status: u.status,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toLocaleString() : "Never logged in",
  }));

  return {
    title: "Last Login per User",
    subtitle:
      "This ERP tracks only the single most recent login timestamp per user, not a full login history — there is no history table in the schema.",
    filtersApplied: [],
    columns: [
      { key: "fullName", label: "Full Name" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status" },
      { key: "lastLoginAt", label: "Last Login", type: "text" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "user-activity", title: "User Activity", buildDescriptor: getUserActivityDescriptor });
registerReport({
  category: CATEGORY,
  key: "last-login-per-user",
  title: "Last Login per User",
  buildDescriptor: (companyId, generatedByName) => getLastLoginPerUserDescriptor(companyId, generatedByName),
});
