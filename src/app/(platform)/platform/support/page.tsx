import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listCompanies } from "@/modules/platform/platform-company.service";
import { listPlatformSupportRequests } from "@/modules/support-access/support-access.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PlatformSupportClient } from "./PlatformSupportClient";

/**
 * Platform side of customer-approved support access (Platform SaaS Phase 2,
 * PLAT-009/011). Raise a request, give the customer the code, then open the
 * approved read-only session from here.
 */
export default async function PlatformSupportPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const canRequest = user.role === "PLATFORM_SUPER_ADMIN" || user.role === "SUPPORT_AGENT";

  const [{ companyId }, companies, requests] = await Promise.all([
    searchParams,
    listCompanies(),
    listPlatformSupportRequests({ platformUserId: user.id, role: user.role }),
  ]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Support Access" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Support Access</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          You have no access to any customer&apos;s data by default. Request access with a reason; the customer&apos;s Super
          Admin approves it with the code shown to you. Sessions are read-only, last at most 2 hours, can be revoked by the
          customer at any time, and everything you open is logged.
        </p>
      </div>
      <PlatformSupportClient
        canRequest={canRequest}
        initialCompanyId={companyId ?? ""}
        companies={companies.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))}
        initialRequests={JSON.parse(JSON.stringify(requests))}
      />
    </div>
  );
}
