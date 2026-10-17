import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { getCompanyDetail } from "@/modules/platform/platform-company-lifecycle.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PlatformCompanyDetailClient } from "./PlatformCompanyDetailClient";
import { getCompanySubscription } from "@/modules/platform/company-subscription.service";
import { listSubscriptionPlans } from "@/modules/platform/subscription-plan.service";

/** Platform SaaS Phase 3 (PLAT-017/020): one company's lifecycle and modules. */
export default async function PlatformCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const { id } = await params;

  const detail = await getCompanyDetail(id).catch((error) => {
    if (error instanceof BusinessRuleError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!detail) notFound();
  const [subscription, plans] = await Promise.all([getCompanySubscription(id), listSubscriptionPlans({ activeOnly: true })]);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Platform", href: "/platform" },
          { label: "Companies", href: "/platform/companies" },
          { label: detail.company.name },
        ]}
      />
      <PlatformCompanyDetailClient
        key={id}
        initialDetail={JSON.parse(JSON.stringify(detail))}
        initialSubscription={JSON.parse(JSON.stringify(subscription))}
        plans={JSON.parse(JSON.stringify(plans))}
        canManageBilling={user.role === "PLATFORM_SUPER_ADMIN" || user.role === "BILLING_ADMIN"}
        canManage={user.role === "PLATFORM_SUPER_ADMIN"}
        canRequestSupport={user.role === "PLATFORM_SUPER_ADMIN" || user.role === "SUPPORT_AGENT"}
      />
    </div>
  );
}
