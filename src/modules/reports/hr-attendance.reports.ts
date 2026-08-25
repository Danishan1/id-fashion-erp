import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { computeIsLate } from "@/modules/hrms/attendance.service";

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

// ===========================================================================
// Category: hr
// ===========================================================================
const HR_CATEGORY = "hr" as const;

async function getEmployeeRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const employees = await prisma.employee.findMany({
    where: {
      companyId,
      deletedAt: null,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.status ? { isActive: filters.status === "true" } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      designation: true,
      phone: true,
      joinDate: true,
      isActive: true,
      department: { select: { name: true } },
    },
    orderBy: { fullName: "asc" },
  });

  const rows = employees.map((e) => ({
    employeeId: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: e.department?.name ?? "—",
    designation: e.designation ?? "—",
    phone: e.phone ?? "—",
    joinDate: e.joinDate,
    status: e.isActive ? "Active" : "Inactive",
  }));

  return {
    title: "Employee Register",
    subtitle: "All employees matching the selected filters.",
    filtersApplied: filtersApplied(filters, { departmentId: "Department", status: "Status" }),
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name", linkTo: "employee" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      { key: "phone", label: "Phone" },
      { key: "joinDate", label: "Join Date", type: "date" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getDepartmentWiseEmployeesDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const employees = await prisma.employee.findMany({
    where: { companyId, isActive: true, deletedAt: null },
    select: { department: { select: { name: true } } },
  });

  const counts = new Map<string, number>();
  for (const e of employees) {
    const name = e.department?.name ?? "Unassigned";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .map(([department, employeeCount]) => ({ department, employeeCount }))
    .sort((a, b) => b.employeeCount - a.employeeCount);

  return {
    title: "Department-wise Employees",
    subtitle: "Active employees grouped by department.",
    filtersApplied: [],
    columns: [
      { key: "department", label: "Department" },
      { key: "employeeCount", label: "Employee Count", type: "number", align: "right" },
    ],
    rows,
    totals: { employeeCount: rows.reduce((s, r) => s + r.employeeCount, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Leave Register — every LeaveRequest matching the selected filters,
// reusing the exact HRMS Leave schema this app already built (LeaveType/
// LeaveRequest) — never a second leave-tracking mechanism.
// ---------------------------------------------------------------------------
async function getLeaveRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const requests = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(dateFrom || dateTo ? { startDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: {
      employee: { select: { employeeCode: true, fullName: true } },
      leaveType: { select: { name: true } },
      startDate: true,
      endDate: true,
      status: true,
      reason: true,
    },
    orderBy: { startDate: "desc" },
  });

  const rows = requests.map((r) => ({
    employeeCode: r.employee.employeeCode,
    fullName: r.employee.fullName,
    leaveType: r.leaveType.name,
    startDate: r.startDate,
    endDate: r.endDate,
    days: Math.round((r.endDate.getTime() - r.startDate.getTime()) / 86400000) + 1,
    status: r.status,
    reason: r.reason ?? "—",
  }));

  return {
    title: "Leave Register",
    subtitle: "Every leave request matching the selected filters.",
    filtersApplied: filtersApplied(filters, { employeeId: "Employee", status: "Status", dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "leaveType", label: "Leave Type" },
      { key: "startDate", label: "Start Date", type: "date" },
      { key: "endDate", label: "End Date", type: "date" },
      { key: "days", label: "Days", type: "number", align: "right" },
      { key: "status", label: "Status" },
      { key: "reason", label: "Reason" },
    ],
    rows,
    totals: { days: rows.reduce((s, r) => s + r.days, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: HR_CATEGORY, key: "employee-register", title: "Employee Register", buildDescriptor: getEmployeeRegisterDescriptor });
registerReport({
  category: HR_CATEGORY,
  key: "department-wise-employees",
  title: "Department-wise Employees",
  buildDescriptor: (companyId, generatedByName) => getDepartmentWiseEmployeesDescriptor(companyId, generatedByName),
});
registerReport({ category: HR_CATEGORY, key: "leave-register", title: "Leave Register", buildDescriptor: getLeaveRegisterDescriptor });

// ===========================================================================
// Category: attendance
// ===========================================================================
const ATTENDANCE_CATEGORY = "attendance" as const;

async function getDailyAttendanceDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const targetDateStr = filters.date || new Date().toISOString().slice(0, 10);
  // `new Date("YYYY-MM-DD")` already parses as UTC midnight, matching how
  // `attendanceDate` (@db.Date) is stored — do NOT round-trip this through a
  // local-timezone Date constructor (see dashboard.reports.ts's startOfDay
  // comment for why that silently shifts the day boundary on a server whose
  // local timezone isn't UTC).
  const dayStart = new Date(targetDateStr);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const records = await prisma.attendanceRecord.findMany({
    where: { companyId, attendanceDate: { gte: dayStart, lt: dayEnd } },
    select: {
      punchIn: true,
      punchOut: true,
      remarks: true,
      employee: { select: { employeeCode: true, fullName: true, department: { select: { name: true } }, shift: { select: { startTime: true } } } },
    },
    orderBy: { employee: { fullName: "asc" } },
  });

  const rows = records.map((r) => {
    const punchIn = r.punchIn ? new Date(r.punchIn) : null;
    const isLate = computeIsLate(punchIn, r.employee.shift?.startTime);
    return {
      employeeCode: r.employee.employeeCode,
      fullName: r.employee.fullName,
      department: r.employee.department?.name ?? "—",
      punchIn: punchIn ? punchIn.toLocaleTimeString() : "—",
      punchOut: r.punchOut ? new Date(r.punchOut).toLocaleTimeString() : "—",
      isLate: isLate === null ? "—" : isLate ? "Yes" : "No",
      remarks: r.remarks ?? "—",
    };
  });

  return {
    title: "Daily Attendance",
    subtitle: `Attendance for ${targetDateStr}.`,
    filtersApplied: [{ label: "Date", value: targetDateStr }],
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "department", label: "Department" },
      { key: "punchIn", label: "Punch In", type: "text" },
      { key: "punchOut", label: "Punch Out", type: "text" },
      { key: "isLate", label: "Late?" },
      { key: "remarks", label: "Remarks" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getMonthlyAttendanceSummaryDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const reference = filters.dateFrom ? new Date(filters.dateFrom) : new Date();
  // UTC components, not local — see dashboard.reports.ts's startOfDay comment.
  const monthStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));

  const records = await prisma.attendanceRecord.findMany({
    where: { companyId, attendanceDate: { gte: monthStart, lt: monthEnd } },
    select: {
      punchIn: true,
      employee: { select: { id: true, employeeCode: true, fullName: true, department: { select: { name: true } }, shift: { select: { startTime: true } } } },
    },
  });

  interface EmployeeAgg {
    employeeCode: string;
    fullName: string;
    department: string;
    presentDays: number;
    lateDays: number;
    totalRecords: number;
  }
  const byEmployee = new Map<string, EmployeeAgg>();
  for (const r of records) {
    const existing = byEmployee.get(r.employee.id) ?? {
      employeeCode: r.employee.employeeCode,
      fullName: r.employee.fullName,
      department: r.employee.department?.name ?? "—",
      presentDays: 0,
      lateDays: 0,
      totalRecords: 0,
    };
    existing.totalRecords += 1;
    if (r.punchIn) {
      existing.presentDays += 1;
      const isLate = computeIsLate(new Date(r.punchIn), r.employee.shift?.startTime);
      if (isLate) existing.lateDays += 1;
    }
    byEmployee.set(r.employee.id, existing);
  }

  const rows = [...byEmployee.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const monthLabel = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;

  return {
    title: "Monthly Attendance Summary",
    subtitle: `Summary for ${monthLabel}. Present Days = records with a punch-in; this ERP has no explicit absence-marking mechanism, so no Absent Days column is shown.`,
    filtersApplied: [{ label: "Month", value: monthLabel }],
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "department", label: "Department" },
      { key: "presentDays", label: "Present Days", type: "number", align: "right" },
      { key: "lateDays", label: "Late Days", type: "number", align: "right" },
      { key: "totalRecords", label: "Total Records", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      presentDays: rows.reduce((s, r) => s + r.presentDays, 0),
      lateDays: rows.reduce((s, r) => s + r.lateDays, 0),
      totalRecords: rows.reduce((s, r) => s + r.totalRecords, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: ATTENDANCE_CATEGORY, key: "daily-attendance", title: "Daily Attendance", buildDescriptor: getDailyAttendanceDescriptor });
registerReport({
  category: ATTENDANCE_CATEGORY,
  key: "monthly-attendance-summary",
  title: "Monthly Attendance Summary",
  buildDescriptor: getMonthlyAttendanceSummaryDescriptor,
});
