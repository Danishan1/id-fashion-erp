import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listCompanySummaries } from "@/modules/platform/platform-company-lifecycle.service";
import { PlatformCompaniesClient } from "./PlatformCompaniesClient";

export default async function PlatformCompaniesPage() {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const canCreate = user.role === "PLATFORM_SUPER_ADMIN";
  const canRequestSupport = user.role === "PLATFORM_SUPER_ADMIN" || user.role === "SUPPORT_AGENT";

  const rawCompanies = await listCompanySummaries();

  // Ensure all Date objects are cleanly serializable across the RSC boundary
  const companies = rawCompanies.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    lastLoginAt: c.lastLoginAt ? c.lastLoginAt.toISOString() : null,
    periodEndsAt: c.periodEndsAt ? c.periodEndsAt.toISOString() : null,
  }));

  return (
    <PlatformCompaniesClient
      companies={companies}
      canCreate={canCreate}
      canRequestSupport={canRequestSupport}
    />
  );
}
