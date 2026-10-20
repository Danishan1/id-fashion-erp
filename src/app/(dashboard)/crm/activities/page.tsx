import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ActivitiesListClient } from "./_components/ActivitiesListClient";

const VIEW_KEYS = ["my-open", "today", "overdue", "upcoming", "completed", "logged", "all"] as const;

/**
 * Phase 09 — every task, call, meeting and logged message the user may see.
 * `?view=overdue|today|…&assignee=<userId>` opens that quick view for that assignee (used by the dashboard's drill-downs).
 */
export default async function CrmActivitiesPage({ searchParams }: { searchParams: Promise<{ view?: string; assignee?: string }> }) {
  const { actor, permissions } = await getCrmPageContext();
  const sp = await searchParams;
  const initialView = VIEW_KEYS.find((v) => v === sp.view);
  const initialAssignee = sp.assignee && /^[0-9a-f-]{36}$/i.test(sp.assignee) ? sp.assignee : undefined;
  return (
    <>
      <CrmPageHeader
        title="Activities"
        description={permissions.viewAll ? "Tasks, calls, meetings and logged messages across the CRM." : "Activities assigned to you or created by you. Open a record to see all of its activities."}
        breadcrumbs={[{ label: "Activities" }]}
      />
      <ActivitiesListClient permissions={permissions} currentUserId={actor.userId} initialView={initialView} initialAssignee={initialAssignee} />
    </>
  );
}
