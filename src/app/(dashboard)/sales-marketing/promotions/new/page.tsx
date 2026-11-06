import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PromotionCreateClient } from "@/components/sales-marketing/promotions/PromotionCreateClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";

export default async function NewPromotionPage() {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_promotions", "create"))) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New promotion" breadcrumbs={[{ label: "Promotions", href: "/sales-marketing/promotions" }, { label: "New" }]} />
      <PromotionCreateClient today={todayIsoDate()} />
    </>
  );
}
