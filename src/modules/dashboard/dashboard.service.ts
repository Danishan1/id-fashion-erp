import { HIERARCHY_MODULES, descendantsOf, loadManagerMap } from "@/core/hierarchy/team-scope";
import { prisma } from "@/core/db/client";

/**
 * Two distinct dashboard "shapes," chosen once per render by
 * getDashboardViewForUser() below — never mixed on one screen. A tagged
 * union rather than one big optional-everything object, so the page
 * component's rendering branch and the data actually available always agree
 * at the type level. (The cross-company "platform" view moved to the
 * separate /platform portal in Platform SaaS Phase 1 —
 * src/modules/platform/platform-overview.service.ts.)
 */
export type DashboardView =
  | { kind: "team"; supervisorName: string; team: TeamOverview }
  | { kind: "company"; counts: CompanyCounts };

export interface CompanyCounts {
  customers: number;
  suppliers: number;
  employees: number;
  warehouses: number;
  users: number;
}

interface TeamOverview {
  teamSize: number;
  presentToday: number;
  activeJobOrders: number;
  pendingLeaveRequests: number;
}

/** The pre-existing single-company view — unchanged from before this file existed, just extracted. */
export async function getCompanyCounts(companyId: string): Promise<CompanyCounts> {
  const [customers, suppliers, employees, warehouses, users] = await Promise.all([
    prisma.customer.count({ where: { companyId, isActive: true } }),
    prisma.supplier.count({ where: { companyId, isActive: true } }),
    prisma.employee.count({ where: { companyId, isActive: true } }),
    prisma.warehouse.count({ where: { companyId, isActive: true } }),
    prisma.user.count({ where: { companyId, status: "ACTIVE", supportForPlatformUserId: null } }),
  ]);
  return { customers, suppliers, employees, warehouses, users };
}

// UTC calendar-day boundaries — every @db.Date column in this schema is
// populated from a plain "YYYY-MM-DD" string, which the JS Date constructor
// always parses as UTC midnight. Building "today" from local Date components
// (`new Date(y, m, d)`) is the exact bug this project has already found and
// fixed multiple times (Executive Dashboard, Daily Attendance) — never repeat
// it here.
function utcDayBoundaries(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Everyone below this employee in any module's reporting hierarchy
 * (Production, CRM or HRMS lines, falling back to Employee.reportsToId) —
 * direct reports and all descendants (P3, decision 9). Active employees only.
 */
export async function getTeamEmployeeIds(companyId: string, employeeId: string): Promise<string[]> {
  const below = new Set<string>();
  for (const hierarchyModule of HIERARCHY_MODULES) {
    for (const id of descendantsOf(await loadManagerMap(companyId, hierarchyModule), employeeId)) below.add(id);
  }
  if (below.size === 0) return [];
  const active = await prisma.employee.findMany({
    where: { companyId, id: { in: [...below] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return active.map((e) => e.id);
}

/**
 * A supervisor's own "my team" view — everyone below them in the reporting
 * hierarchy (P3: direct reports and all descendants, across the module
 * reporting lines; previously direct reports only). Deliberately excludes
 * anyone with zero direct reports from ever reaching this function — see
 * getDashboardViewForUser()'s own branch below, which falls back to the
 * ordinary company view for an individual contributor.
 */
export async function getTeamDashboard(companyId: string, supervisorEmployeeId: string): Promise<TeamOverview> {
  const reportIds = await getTeamEmployeeIds(companyId, supervisorEmployeeId);
  if (reportIds.length === 0) {
    return { teamSize: 0, presentToday: 0, activeJobOrders: 0, pendingLeaveRequests: 0 };
  }

  const { start, end } = utcDayBoundaries();

  const [presentToday, activeJobOrderAssignments, pendingLeaveRequests] = await Promise.all([
    prisma.attendanceRecord.count({
      where: { companyId, employeeId: { in: reportIds }, attendanceDate: { gte: start, lt: end }, punchIn: { not: null } },
    }),
    prisma.jobOrderAssignment.findMany({
      where: {
        employeeId: { in: reportIds },
        jobOrder: { companyId, status: { in: ["PENDING", "IN_PROGRESS", "PARTIALLY_COMPLETED"] } },
      },
      select: { jobOrderId: true },
      distinct: ["jobOrderId"],
    }),
    prisma.leaveRequest.count({ where: { companyId, employeeId: { in: reportIds }, status: "PENDING" } }),
  ]);

  return {
    teamSize: reportIds.length,
    presentToday,
    activeJobOrders: activeJobOrderAssignments.length,
    pendingLeaveRequests,
  };
}

/**
 * The single entry point the Dashboard page calls — decides which of the
 * two views above a given session actually sees: "do I supervise anyone"
 * (Employee.reports.length > 0) is the actual signal, not a hardcoded role-name check — a MANAGEMENT or
 * SUPER_ADMIN user who happens to have direct reports in the Employee
 * hierarchy sees the team view too, and a PRODUCTION_SUPERVISOR with none
 * configured correctly falls through to the ordinary company view rather
 * than showing an empty/misleading "team of zero."
 */
export async function getDashboardViewForUser(params: {
  userId: string;
  companyId: string;
}): Promise<DashboardView> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { employeeId: true, employee: { select: { fullName: true } } },
  });

  if (user?.employeeId) {
    const teamIds = await getTeamEmployeeIds(params.companyId, user.employeeId);
    if (teamIds.length > 0) {
      const team = await getTeamDashboard(params.companyId, user.employeeId);
      return { kind: "team", supervisorName: user.employee?.fullName ?? "You", team };
    }
  }

  const counts = await getCompanyCounts(params.companyId);
  return { kind: "company", counts };
}
