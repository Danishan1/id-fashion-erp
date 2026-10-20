import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listPlatformAuditLogs } from "@/modules/platform/platform-audit.service";
import { PlatformAuditLogsClient } from "./PlatformAuditLogsClient";

export default async function PlatformAuditLogsPage() {
  const user = await getPlatformPageUser();
  if (!user || (user.role !== "PLATFORM_SUPER_ADMIN" && user.role !== "SUPPORT_AGENT")) {
    notFound();
  }

  const { logs, total } = await listPlatformAuditLogs({ limit: 100 });

  const serializedLogs = logs.map((log) => ({
    ...log,
    performedAt: log.performedAt.toISOString(),
  }));

  return <PlatformAuditLogsClient initialLogs={serializedLogs} totalCount={total} />;
}
