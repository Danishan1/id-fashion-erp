import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getActivity } from "@/modules/crm/activities/crm-activities.service";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { ActivityDetailPageClient } from "../_components/ActivityDetailPageClient";

/** One activity (linked from notifications and timelines). */
export default async function CrmActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getCrmPageContext();
  const activity = await getActivity(actor, id).catch(() => null);
  if (!activity) notFound();
  return (
    <>
      <CrmPageHeader title={activity.typeLabel} breadcrumbs={[{ label: "Activities", href: "/crm/activities" }, { label: activity.subject }]} />
      <ActivityDetailPageClient activityId={id} canEdit={permissions.edit} />
    </>
  );
}
