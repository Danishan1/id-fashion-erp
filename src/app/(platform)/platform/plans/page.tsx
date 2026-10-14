import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listSubscriptionPlans } from "@/modules/platform/subscription-plan.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PlansClient } from "./PlansClient";

/** Platform SaaS Phase 4 (PLAT-022): the subscription plan catalog. */
export default async function PlatformPlansPage() {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const plans = await listSubscriptionPlans();

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Plans" }]} />
      <PlansClient
        initialPlans={JSON.parse(JSON.stringify(plans))}
        canManage={user.role === "PLATFORM_SUPER_ADMIN" || user.role === "BILLING_ADMIN"}
      />
    </div>
  );
}
