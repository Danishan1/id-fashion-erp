import { prisma } from "@/core/db/client";
import { getCompanyCounts } from "@/modules/dashboard/dashboard.service";

export interface PlatformOverview {
  companies: number;
  activeCompanies: number;
  customers: number;
  suppliers: number;
  employees: number;
  users: number;
}

export interface PlatformCompanyRow {
  id: string;
  name: string;
  isActive: boolean;
  customers: number;
  suppliers: number;
  employees: number;
  users: number;
}

/**
 * The platform portal's home view (moved here from the tenant dashboard in
 * Platform SaaS Phase 1). Aggregate counts only — no customer business
 * records — across every company, including suspended ones, so an operator
 * can see the whole instance. Deliberately the one place that queries with
 * no companyId filter.
 */
export async function getPlatformOverview(): Promise<{ overall: PlatformOverview; companies: PlatformCompanyRow[] }> {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, isActive: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    companies.map(async (company): Promise<PlatformCompanyRow> => {
      const counts = await getCompanyCounts(company.id);
      return {
        id: company.id,
        name: company.name,
        isActive: company.isActive,
        customers: counts.customers,
        suppliers: counts.suppliers,
        employees: counts.employees,
        users: counts.users,
      };
    })
  );

  const overall = rows.reduce<PlatformOverview>(
    (acc, row) => ({
      companies: acc.companies + 1,
      activeCompanies: acc.activeCompanies + (row.isActive ? 1 : 0),
      customers: acc.customers + row.customers,
      suppliers: acc.suppliers + row.suppliers,
      employees: acc.employees + row.employees,
      users: acc.users + row.users,
    }),
    { companies: 0, activeCompanies: 0, customers: 0, suppliers: 0, employees: 0, users: 0 }
  );

  return { overall, companies: rows };
}
