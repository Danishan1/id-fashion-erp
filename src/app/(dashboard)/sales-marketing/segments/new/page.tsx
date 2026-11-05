import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SegmentForm } from "@/components/sales-marketing/segments/SegmentForm";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

export default async function NewSegmentPage() {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_segments", "create"))) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New segment" breadcrumbs={[{ label: "Audience Segments", href: "/sales-marketing/segments" }, { label: "New" }]} />
      <SegmentForm currentUserId={session.user.id} />
    </>
  );
}
