import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { getPlatformOverview } from "@/modules/platform/platform-overview.service";
import { PlatformOverviewClient } from "./PlatformOverviewClient";

export default async function PlatformOverviewPage() {
  if (!(await getPlatformPageUser())) notFound();
  const rawData = await getPlatformOverview();

  // Clean serialization for client component boundary
  const data = {
    ...rawData,
    recentPayments: rawData.recentPayments.map((p) => ({
      ...p,
      paidAt: p.paidAt.toISOString(),
    })),
    expiringSoon: rawData.expiringSoon.map((e) => ({
      ...e,
      periodEndsAt: e.periodEndsAt.toISOString(),
    })),
    recentActivity: rawData.recentActivity.map((a) => ({
      ...a,
      performedAt: a.performedAt.toISOString(),
    })),
  };

  return <PlatformOverviewClient data={data} />;
}
