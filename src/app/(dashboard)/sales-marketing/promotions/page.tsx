import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PromotionsListClient } from "@/components/sales-marketing/promotions/PromotionsListClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Sales & Marketing → Promotions (Phase 12). */
export default async function PromotionsPage() {
  const session = await auth();
  const canCreate = session?.user?.id ? await PermissionService.can(session.user.id, "marketing_promotions", "create") : false;
  return (
    <>
      <SalesMarketingPageHeader
        title="Promotions"
        description="Line discounts that apply automatically or with a code, priced by the same engine as price lists and discount rules. A promotion prices nothing until a version is approved and it is switched on."
        breadcrumbs={[{ label: "Promotions" }]}
        actions={
          canCreate ? (
            <Link href="/sales-marketing/promotions/new" className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              New promotion
            </Link>
          ) : null
        }
      />
      <PromotionsListClient />
    </>
  );
}
