import { prisma } from "@/core/db/client";

/**
 * Three distinct dashboard "shapes," chosen once per render by
 * getDashboardViewForUser() below — never mixed on one screen. A tagged
 * union rather than one big optional-everything object, so the page
 * component's rendering branch and the data actually available always agree
 * at the type level.
 */
export type DashboardView =
  | { kind: "platform"; overall: PlatformOverview; companies: PlatformCompanyRow[] }
  | { kind: "team"; supervisorName: string; team: TeamOverview }
  | { kind: "company"; counts: CompanyCounts };

interface CompanyCounts {
  customers: number;
  suppliers: number;
  employees: number;
  warehouses: number;
  users: number;
}

interface PlatformOverview {
  companies: number;
  customers: number;
  suppliers: number;
  employees: number;
  users: number;
}

interface PlatformCompanyRow {
  id: string;
  name: string;
  customers: number;
  suppliers: number;
  employees: number;
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
    prisma.user.count({ where: { companyId, status: "ACTIVE" } }),
  ]);
  return { customers, suppliers, employees, warehouses, users };
}

/**
 * Platform admin's "overall" view — genuinely cross-company, the one place
 * in this app that deliberately queries with no companyId filter at all.
 * Kept to a flat sum + a per-company breakdown table rather than anything
 * more elaborate — this is a provisioning/oversight tool for whoever runs
 * the platform, not a second full reporting suite (that already exists,
 * per-company, under /reports).
 */
export async function getPlatformDashboard(): Promise<{ overall: PlatformOverview; companies: PlatformCompanyRow[] }> {
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    companies.map(async (company): Promise<PlatformCompanyRow> => {
      const counts = await getCompanyCounts(company.id);
      return { id: company.id, name: company.name, customers: counts.customers, suppliers: counts.suppliers, employees: counts.employees, users: counts.users };
    })
  );

  const overall = rows.reduce<PlatformOverview>(
    (acc, row) => ({
      companies: acc.companies + 1,
      customers: acc.customers + row.customers,
      suppliers: acc.suppliers + row.suppliers,
      employees: acc.employees + row.employees,
      users: acc.users + row.users,
    }),
    { companies: 0, customers: 0, suppliers: 0, employees: 0, users: 0 }
  );

  return { overall, companies: rows };
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
 * A supervisor's own "my team" view — scoped to their direct reports via
 * Employee.reportsToId (a plain one-level lookup, not the full downward
 * tree — matches "my employees," not "my employees' employees," which is
 * what a line manager actually means by "my team"). Deliberately excludes
 * anyone with zero direct reports from ever reaching this function — see
 * getDashboardViewForUser()'s own branch below, which falls back to the
 * ordinary company view for an individual contributor.
 */
export async function getTeamDashboard(companyId: string, supervisorEmployeeId: string): Promise<TeamOverview> {
  const reports = await prisma.employee.findMany({
    where: { companyId, reportsToId: supervisorEmployeeId, isActive: true },
    select: { id: true },
  });
  const reportIds = reports.map((r) => r.id);
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
 * three views above a given session actually sees. Order matters: platform
 * admin outranks everything (they're not really "in" any one company's
 * hierarchy), then "do I supervise anyone" (Employee.reports.length > 0) as
 * the actual signal, not a hardcoded role-name check — a MANAGEMENT or
 * SUPER_ADMIN user who happens to have direct reports in the Employee
 * hierarchy sees the team view too, and a PRODUCTION_SUPERVISOR with none
 * configured correctly falls through to the ordinary company view rather
 * than showing an empty/misleading "team of zero."
 */
export async function getDashboardViewForUser(params: {
  userId: string;
  companyId: string;
  isPlatformAdmin: boolean;
}): Promise<DashboardView> {
  if (params.isPlatformAdmin) {
    const { overall, companies } = await getPlatformDashboard();
    return { kind: "platform", overall, companies };
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { employeeId: true, employee: { select: { fullName: true } } },
  });

  if (user?.employeeId) {
    const directReportCount = await prisma.employee.count({
      where: { companyId: params.companyId, reportsToId: user.employeeId, isActive: true },
    });
    if (directReportCount > 0) {
      const team = await getTeamDashboard(params.companyId, user.employeeId);
      return { kind: "team", supervisorName: user.employee?.fullName ?? "You", team };
    }
  }

  const counts = await getCompanyCounts(params.companyId);
  return { kind: "company", counts };
}
