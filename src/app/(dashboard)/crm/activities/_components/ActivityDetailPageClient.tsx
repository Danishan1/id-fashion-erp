"use client";

import { useRouter } from "next/navigation";
import { ActivityDetail } from "@/components/crm/activities/ActivityDetail";
import { useActivityLookups } from "@/components/crm/activities/useActivityLookups";

export function ActivityDetailPageClient({ activityId, canEdit }: { activityId: string; canEdit: boolean }) {
  const router = useRouter();
  const { meta, users } = useActivityLookups();
  return (
    <div className="max-w-3xl rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <ActivityDetail activityId={activityId} meta={meta} users={users} canEdit={canEdit} onChanged={(a) => (a ? router.refresh() : router.push("/crm/activities"))} />
    </div>
  );
}
