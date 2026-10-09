import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { MyTasksClient } from "./_components/MyTasksClient";

/** Phase 09 — the signed-in user's follow-ups: overdue, due today, upcoming, recently completed. */
export default async function CrmMyTasksPage() {
  const { actor, permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="My Tasks" description="Your follow-ups across leads, contacts, companies and opportunities." breadcrumbs={[{ label: "My Tasks" }]} />
      <MyTasksClient currentUserId={actor.userId} canCreate={permissions.create} canEdit={permissions.edit} />
    </>
  );
}
