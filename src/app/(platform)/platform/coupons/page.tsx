import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { listCoupons } from "@/modules/platform/coupon.service";
import { listSubscriptionPlans } from "@/modules/platform/subscription-plan.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { CouponsClient } from "./CouponsClient";

/** Platform SaaS Phase 5 (PLAT-026/027): coupons / offers. */
export default async function PlatformCouponsPage() {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  const [coupons, plans] = await Promise.all([listCoupons(), listSubscriptionPlans()]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Coupons" }]} />
      <CouponsClient
        initialCoupons={JSON.parse(JSON.stringify(coupons))}
        plans={plans.map((p) => ({ id: p.id, name: p.name }))}
        canManage={user.role === "PLATFORM_SUPER_ADMIN" || user.role === "BILLING_ADMIN"}
      />
    </div>
  );
}
