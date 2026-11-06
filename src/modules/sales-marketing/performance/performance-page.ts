import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";

/** Phase 05 screens need sales_performance.view (used by their layouts). */
export async function assertPerformanceView() {
  const session = await auth();
  if (!session?.user?.id) notFound();
  if (!(await PermissionService.can(session.user.id, "sales_performance", "view"))) notFound();
}

/** Fiscal year start month and today, for the period pickers. */
export async function periodContext(companyId: string) {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
  return { fiscalStartMonth: c?.fiscalYearStartMonth ?? 1, today: todayIsoDate() };
}
