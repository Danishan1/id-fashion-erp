import { auth } from "@/core/auth/auth";
import { CrmDashboardClient } from "@/components/crm/dashboard/CrmDashboardClient";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";

/**
 * CRM Dashboard (Phase 21): KPIs, pipeline, leads, follow-ups, my work, recent
 * activity, automation health and quick actions — all from GET
 * /api/v1/crm/dashboard (server-side aggregation with record visibility).
 * Each user can show / hide, reorder and resize the sections.
 */
export default async function CrmDashboardPage() {
  const [{ actor, permissions }, session] = await Promise.all([getCrmPageContext(), auth()]);
  return <CrmDashboardClient permissions={permissions} currentUserId={actor.userId} userName={session?.user?.name ?? null} />;
}
