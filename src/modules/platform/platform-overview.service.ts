import { prisma } from "@/core/db/client";
import { getCompanyCounts } from "@/modules/dashboard/dashboard.service";
import { computeSubscriptionStatus } from "@/core/subscriptions/subscription-state";

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

export interface PlatformFinancials {
  mrr: number;
  arr: number;
  totalRevenue: number;
  activePaidSubscriptions: number;
  trialSubscriptions: number;
  graceSubscriptions: number;
  expiredSubscriptions: number;
}

export interface PlatformPlanStat {
  id: string;
  name: string;
  code: string;
  monthlyPrice: number;
  annualPrice: number;
  companyCount: number;
}

export interface PlatformRecentPayment {
  id: string;
  companyId: string;
  companyName: string;
  planName: string;
  amount: number;
  currencyCode: string;
  paidAt: Date;
  method: string;
}

export interface PlatformExpiringTenant {
  companyId: string;
  companyName: string;
  planName: string | null;
  isTrial: boolean;
  periodEndsAt: Date;
  daysLeft: number;
  statusState: string;
}

export interface PlatformRecentActivity {
  id: string;
  performedAt: Date;
  tableName: string;
  action: string;
  companyName: string;
  operatorName: string | null;
}

export interface PlatformOverviewResult {
  overall: PlatformOverview;
  companies: PlatformCompanyRow[];
  financials: PlatformFinancials;
  planBreakdown: PlatformPlanStat[];
  recentPayments: PlatformRecentPayment[];
  expiringSoon: PlatformExpiringTenant[];
  recentActivity: PlatformRecentActivity[];
}

/**
 * The platform portal's home view with aggregate counts, SaaS revenue metrics (MRR/ARR),
 * plan distributions, recent payments, and renewal alerts across all tenants.
 */
export async function getPlatformOverview(): Promise<PlatformOverviewResult> {
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

  // Financials & Subscription Analytics (Safe-guarded for tests where models might be unmocked)
  let mrr = 0;
  let totalRevenue = 0;
  let activePaidSubscriptions = 0;
  let trialSubscriptions = 0;
  let graceSubscriptions = 0;
  let expiredSubscriptions = 0;
  const expiringSoon: PlatformExpiringTenant[] = [];
  const planCountMap = new Map<string, number>();

  if (prisma.companySubscription) {
    const subs = await prisma.companySubscription.findMany({
      include: {
        plan: true,
        company: { select: { id: true, name: true, isActive: true } },
      },
    });

    const now = new Date();
    for (const sub of subs) {
      const status = computeSubscriptionStatus(sub, now);
      if (sub.company.isActive) {
        planCountMap.set(sub.planId, (planCountMap.get(sub.planId) ?? 0) + 1);
      }

      if (status.state === "TRIAL") {
        trialSubscriptions++;
      } else if (status.state === "ACTIVE" || status.state === "UNLIMITED") {
        activePaidSubscriptions++;
        const monthly = sub.plan.monthlyPrice ? Number(sub.plan.monthlyPrice) : 0;
        const annual = sub.plan.annualPrice ? Number(sub.plan.annualPrice) : 0;
        if (sub.billingCycle === "ANNUAL" && annual > 0) {
          mrr += annual / 12;
        } else if (monthly > 0) {
          mrr += monthly;
        }
      } else if (status.state === "GRACE") {
        graceSubscriptions++;
      } else if (status.state === "EXPIRED") {
        expiredSubscriptions++;
      }

      if (
        sub.company.isActive &&
        status.periodEndsAt &&
        status.daysLeft !== null &&
        status.daysLeft <= 7
      ) {
        expiringSoon.push({
          companyId: sub.company.id,
          companyName: sub.company.name,
          planName: sub.plan.name,
          isTrial: sub.isTrial,
          periodEndsAt: status.periodEndsAt,
          daysLeft: status.daysLeft,
          statusState: status.state,
        });
      }
    }
  }

  // Sort expiring soon by days left ascending (soonest first)
  expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  // Total collected revenue
  if (prisma.subscriptionPayment) {
    const rev = await prisma.subscriptionPayment.aggregate({
      _sum: { amount: true },
    });
    totalRevenue = Number(rev._sum.amount ?? 0);
  }

  // Plan Breakdown
  let planBreakdown: PlatformPlanStat[] = [];
  if (prisma.subscriptionPlan) {
    const allPlans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    planBreakdown = allPlans.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      monthlyPrice: Number(p.monthlyPrice ?? 0),
      annualPrice: Number(p.annualPrice ?? 0),
      companyCount: planCountMap.get(p.id) ?? 0,
    }));
  }

  // Recent 5 payments
  let recentPayments: PlatformRecentPayment[] = [];
  if (prisma.subscriptionPayment) {
    const payments = await prisma.subscriptionPayment.findMany({
      take: 5,
      orderBy: { paidAt: "desc" },
      include: {
        company: { select: { id: true, name: true } },
        plan: { select: { name: true } },
      },
    });
    recentPayments = payments.map((p) => ({
      id: p.id,
      companyId: p.companyId,
      companyName: p.company.name,
      planName: p.plan.name,
      amount: Number(p.amount),
      currencyCode: p.currencyCode,
      paidAt: p.paidAt,
      method: p.method,
    }));
  }

  // Recent 5 audit activity events
  let recentActivity: PlatformRecentActivity[] = [];
  if (prisma.auditLog) {
    const logs = await prisma.auditLog.findMany({
      take: 5,
      orderBy: { performedAt: "desc" },
      include: {
        company: { select: { name: true } },
        platformUser: { select: { fullName: true } },
        user: { select: { fullName: true } },
      },
    });
    recentActivity = logs.map((l) => ({
      id: l.id,
      performedAt: l.performedAt,
      tableName: l.tableName,
      action: l.action,
      companyName: l.company.name,
      operatorName: l.platformUser?.fullName ?? l.user?.fullName ?? null,
    }));
  }

  return {
    overall,
    companies: rows,
    financials: {
      mrr: Math.round(mrr),
      arr: Math.round(mrr * 12),
      totalRevenue: Math.round(totalRevenue),
      activePaidSubscriptions,
      trialSubscriptions,
      graceSubscriptions,
      expiredSubscriptions,
    },
    planBreakdown,
    recentPayments,
    expiringSoon,
    recentActivity,
  };
}
