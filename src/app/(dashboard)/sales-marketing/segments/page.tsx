import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SegmentsClient } from "@/components/sales-marketing/segments/SegmentsClient";
import { buttonClasses } from "@/components/ui/Button";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Sales & Marketing → Audience Segments (Phase 09). */
export default async function SegmentsPage() {
  const session = await auth();
  const canCreate = session?.user?.id ? await PermissionService.can(session.user.id, "marketing_segments", "create") : false;
  return (
    <>
      <SalesMarketingPageHeader
        title="Audience Segments"
        description="Reusable audiences of CRM contacts, companies, leads or ERP customers — by rules (dynamic) or by hand (static), with snapshots and consent checks. Nothing here sends messages."
        breadcrumbs={[{ label: "Audience Segments" }]}
        actions={
          canCreate ? (
            <Link href="/sales-marketing/segments/new" className={buttonClasses("primary", "sm")}>
              New segment
            </Link>
          ) : null
        }
      />
      <SegmentsClient />
    </>
  );
}
