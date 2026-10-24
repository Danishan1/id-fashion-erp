import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { istDateKey, isValidDateKey } from "@/modules/hrms/attendance-calculator";
import { computeEmployeesMonth, DAY_CODE_LABELS } from "@/modules/hrms/attendance-month.service";
import { parseReportDateRange } from "./report-date-range";
import { validateStatusFilter } from "./report-filters";
import { AttendanceOvertimeStatus, LeaveRequestStatus } from "@prisma/client";

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
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
      designation: { select: { name: true } },
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
    designation: e.designation?.name ?? "—",
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
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const requests = await prisma.leaveRequest.findMany({
    where: {
      companyId,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...validateStatusFilter(filters, LeaveRequestStatus),
      ...(dateFrom || dateToExclusive ? { startDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      employee: { select: { employeeCode: true, fullName: true } },
      leaveType: { select: { name: true } },
      startDate: true,
      endDate: true,
      status: true,
      reason: true,
      days: { where: { taken: true }, select: { fraction: true } },
    },
    orderBy: { startDate: "desc" },
  });

  const rows = requests.map((r) => ({
    employeeCode: r.employee.employeeCode,
    fullName: r.employee.fullName,
    leaveType: r.leaveType.name,
    startDate: r.startDate,
    endDate: r.endDate,
    // Day-wise requests: the real fractions (half / quarter days, sandwich days included).
    days: r.days.length > 0 ? r.days.reduce((sum, d) => sum + Number(d.fraction), 0) : Math.round((r.endDate.getTime() - r.startDate.getTime()) / 86400000) + 1,
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
// Category: attendance — built on the attendance module's month engine
// (src/modules/hrms/attendance-month.service.ts) so reports match the screens.
// ===========================================================================
const ATTENDANCE_CATEGORY = "attendance" as const;

const IST_TIME = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true } as const;
function istTime(d: Date | string | null): string {
  return d ? new Date(d).toLocaleTimeString("en-IN", IST_TIME) : "—";
}

async function activeEmployeeIds(companyId: string, departmentId?: string) {
  const rows = await prisma.employee.findMany({
    where: { companyId, isActive: true, deletedAt: null, ...(departmentId ? { departmentId } : {}) },
    select: { id: true },
    orderBy: { fullName: "asc" },
  });
  return rows.map((r) => r.id);
}

async function getDailyAttendanceDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const targetDateStr = filters.date && isValidDateKey(filters.date) ? filters.date : istDateKey(new Date());
  const ids = await activeEmployeeIds(companyId, filters.departmentId);
  const months = await computeEmployeesMonth(companyId, ids, Number(targetDateStr.slice(0, 4)), Number(targetDateStr.slice(5, 7)));
  const departments = new Map(
    (await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, department: { select: { name: true } } } })).map((e) => [e.id, e.department?.name ?? "—"])
  );

  const rows = months.map((m) => {
    const d = m.days.find((x) => x.dateKey === targetDateStr)!;
    return {
      employeeCode: m.employee.employeeCode,
      fullName: m.employee.fullName,
      department: departments.get(m.employee.id) ?? "—",
      punchIn: istTime(d.firstIn),
      punchOut: d.hasOpenSession ? "In now" : istTime(d.lastOut),
      hours: d.workedHours,
      status: DAY_CODE_LABELS[d.code],
      isLate: d.isLate === null ? "—" : d.isLate ? "Yes" : "No",
      outside: d.isOutside ? "Yes" : "No",
      leave: d.leaveLabel ?? "—",
    };
  });

  return {
    title: "Daily Attendance",
    subtitle: `Attendance for ${targetDateStr}. Status comes from hours worked against each employee's shift; times are IST.`,
    filtersApplied: [{ label: "Date", value: targetDateStr }],
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "department", label: "Department" },
      { key: "punchIn", label: "First In", type: "text" },
      { key: "punchOut", label: "Last Out", type: "text" },
      { key: "hours", label: "Hours", type: "number", align: "right" },
      { key: "status", label: "Status" },
      { key: "isLate", label: "Late?" },
      { key: "outside", label: "Outside?" },
      { key: "leave", label: "Leave" },
    ],
    rows,
    totals: { hours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100 },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getMonthlyAttendanceSummaryDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const reference = filters.dateFrom && isValidDateKey(filters.dateFrom) ? filters.dateFrom : istDateKey(new Date());
  const year = Number(reference.slice(0, 4));
  const month = Number(reference.slice(5, 7));
  const ids = await activeEmployeeIds(companyId, filters.departmentId);
  const months = await computeEmployeesMonth(companyId, ids, year, month);
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  const rows = months.map((m) => ({
    employeeCode: m.employee.employeeCode,
    fullName: m.employee.fullName,
    workingDays: m.summary.workingDays,
    presentDays: m.summary.presentDays,
    paidLeaveDays: m.summary.paidLeaveDays,
    unpaidLeaveDays: m.summary.unpaidLeaveDays,
    absentDays: m.summary.absentDays,
    weekendDays: m.summary.weekendDays,
    holidayDays: m.summary.holidayDays,
    sandwichDays: m.summary.sandwichDays,
    lateDays: m.summary.lateDays,
    totalHours: m.summary.totalHours,
    overtimeHours: m.summary.approvedOvertimeHours,
  }));
  const sum = (k: keyof (typeof rows)[number]) => Math.round(rows.reduce((s, r) => s + Number(r[k]), 0) * 100) / 100;

  return {
    title: "Monthly Attendance Summary",
    subtitle: `Summary for ${monthLabel}. Present days use the hours rule (full shift = 1, 75% = 0.75, half = 0.5); a weekly off or holiday between two absent/leave days counts as a sandwich absence.`,
    filtersApplied: [{ label: "Month", value: monthLabel }],
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "workingDays", label: "Working Days", type: "number", align: "right" },
      { key: "presentDays", label: "Present", type: "number", align: "right" },
      { key: "paidLeaveDays", label: "Paid Leave", type: "number", align: "right" },
      { key: "unpaidLeaveDays", label: "Unpaid Leave", type: "number", align: "right" },
      { key: "absentDays", label: "Absent", type: "number", align: "right" },
      { key: "weekendDays", label: "Weekly Off", type: "number", align: "right" },
      { key: "holidayDays", label: "Holidays", type: "number", align: "right" },
      { key: "sandwichDays", label: "Sandwich", type: "number", align: "right" },
      { key: "lateDays", label: "Late Days", type: "number", align: "right" },
      { key: "totalHours", label: "Hours", type: "number", align: "right" },
      { key: "overtimeHours", label: "Approved OT Hours", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      presentDays: sum("presentDays"),
      paidLeaveDays: sum("paidLeaveDays"),
      unpaidLeaveDays: sum("unpaidLeaveDays"),
      absentDays: sum("absentDays"),
      lateDays: sum("lateDays"),
      totalHours: sum("totalHours"),
      overtimeHours: sum("overtimeHours"),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getOvertimeRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const records = await prisma.overtimeRecord.findMany({
    where: {
      companyId,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...validateStatusFilter(filters, AttendanceOvertimeStatus),
      ...(dateFrom || dateToExclusive ? { attendanceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    include: { employee: { select: { employeeCode: true, fullName: true, attendanceProfile: { select: { overtimeRatePerHour: true } } } }, decidedBy: { select: { fullName: true } } },
    orderBy: { attendanceDate: "desc" },
  });
  const rows = records.map((r) => {
    const rate = r.employee.attendanceProfile?.overtimeRatePerHour ? Number(r.employee.attendanceProfile.overtimeRatePerHour) : 0;
    return {
      date: r.attendanceDate,
      employeeCode: r.employee.employeeCode,
      fullName: r.employee.fullName,
      workedHours: Number(r.workedHours),
      shiftHours: Number(r.shiftHours),
      hours: Number(r.hours),
      rate,
      amount: Math.round(Number(r.hours) * rate * 100) / 100,
      status: r.status,
      decidedBy: r.decidedBy?.fullName ?? "—",
    };
  });
  const approved = rows.filter((r) => r.status === "APPROVED");
  return {
    title: "Overtime Register",
    subtitle: "Overtime = hours worked beyond the shift, calculated at punch-out. Totals count approved overtime only.",
    filtersApplied: filtersApplied(filters, { employeeId: "Employee", status: "Status", dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "workedHours", label: "Worked", type: "number", align: "right" },
      { key: "shiftHours", label: "Shift", type: "number", align: "right" },
      { key: "hours", label: "OT Hours", type: "number", align: "right" },
      { key: "rate", label: "Rate / Hour", type: "currency", align: "right" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "status", label: "Status" },
      { key: "decidedBy", label: "Decided By" },
    ],
    rows,
    totals: {
      hours: Math.round(approved.reduce((s, r) => s + r.hours, 0) * 100) / 100,
      amount: Math.round(approved.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getOutdoorPunchRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const sessions = await prisma.attendanceSession.findMany({
    where: {
      companyId,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      OR: [{ isLoginFromOffice: false }, { isLogoutFromOffice: false }, { status: { in: ["PRESENT_FROM_OUTSIDE", "REMOTE"] } }],
      ...(dateFrom || dateToExclusive ? { attendanceRecord: { attendanceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, fullName: true } },
      attendanceRecord: { select: { attendanceDate: true } },
      outdoorRejections: { orderBy: { rejectedAt: "desc" }, take: 1, select: { status: true, isRevoked: true } },
    },
    orderBy: { checkInAt: "desc" },
  });
  const rows = sessions.map((s) => {
    const rej = s.outdoorRejections[0];
    return {
      date: s.attendanceRecord.attendanceDate,
      employeeCode: s.employee.employeeCode,
      fullName: s.employee.fullName,
      checkIn: istTime(s.checkInAt),
      checkOut: istTime(s.checkOutAt),
      inDistance: s.inDistanceMeters ?? null,
      outDistance: s.outDistanceMeters ?? null,
      decision: s.status === "REMOTE" ? "Approved" : rej ? (rej.isRevoked ? "Rejection cancelled" : `Rejected (${rej.status.toLowerCase().replace("_", " ")})`) : "Waiting",
    };
  });
  return {
    title: "Outdoor Punch Register",
    subtitle: "Punches made outside every office location, and what was decided.",
    filtersApplied: filtersApplied(filters, { employeeId: "Employee", dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "checkIn", label: "In", type: "text" },
      { key: "checkOut", label: "Out", type: "text" },
      { key: "inDistance", label: "In Distance (m)", type: "number", align: "right" },
      { key: "outDistance", label: "Out Distance (m)", type: "number", align: "right" },
      { key: "decision", label: "Decision" },
    ],
    rows,
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
registerReport({ category: ATTENDANCE_CATEGORY, key: "overtime-register", title: "Overtime Register", buildDescriptor: getOvertimeRegisterDescriptor });
registerReport({ category: ATTENDANCE_CATEGORY, key: "outdoor-punch-register", title: "Outdoor Punch Register", buildDescriptor: getOutdoorPunchRegisterDescriptor });
