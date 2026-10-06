import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ActivitiesListClient } from "./_components/ActivitiesListClient";

/** Phase 09 — every task, call, meeting and logged message the user may see. */
export default async function CrmActivitiesPage() {
  const { actor, permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader
        title="Activities"
        description={permissions.viewAll ? "Tasks, calls, meetings and logged messages across the CRM." : "Activities assigned to you or created by you. Open a record to see all of its activities."}
        breadcrumbs={[{ label: "Activities" }]}
      />
      <ActivitiesListClient permissions={permissions} currentUserId={actor.userId} />
    </>
  );
}
