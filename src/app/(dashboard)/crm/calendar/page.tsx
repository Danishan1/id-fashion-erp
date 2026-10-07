import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CalendarClient } from "./_components/CalendarClient";

/** Phase 10 — CRM calendar: appointments by day / week / month, plus a searchable list. */
export default async function CrmCalendarPage() {
  const { actor, permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Calendar" description={permissions.viewAll ? "Appointments across the team." : "Your appointments."} breadcrumbs={[{ label: "Calendar" }]} />
      <CalendarClient currentUserId={actor.userId} permissions={{ create: permissions.create, edit: permissions.edit, viewAll: permissions.viewAll }} />
    </>
  );
}
