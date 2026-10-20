import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { checkSystemHealth } from "@/modules/platform/platform-system-health.service";
import { PlatformSystemHealthClient } from "./PlatformSystemHealthClient";

export default async function PlatformSystemHealthPage() {
  const user = await getPlatformPageUser();
  if (!user || (user.role !== "PLATFORM_SUPER_ADMIN" && user.role !== "SUPPORT_AGENT")) {
    notFound();
  }

  const initialReport = await checkSystemHealth();

  return <PlatformSystemHealthClient initialReport={initialReport} />;
}
