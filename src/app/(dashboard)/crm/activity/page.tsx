import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { ActivityLogClient } from "./ActivityLogClient";

export default function CrmActivityLogPage() {
  return (
    <>
      <CrmPageHeader
        title="Activity Log"
        description="Every change recorded across CRM records, newest first."
        breadcrumbs={[{ label: "Activity Log" }]}
      />
      <ActivityLogClient />
    </>
  );
}
