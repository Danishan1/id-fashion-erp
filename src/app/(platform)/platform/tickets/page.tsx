import { notFound } from "next/navigation";
import { getPlatformPageUser } from "@/modules/platform/platform-page";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PlatformTicketsClient } from "./PlatformTicketsClient";

/** Platform SaaS Phase 5 (PLAT-029): the support ticket inbox across every company. */
export default async function PlatformTicketsPage() {
  const user = await getPlatformPageUser();
  if (!user) notFound();
  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Platform", href: "/platform" }, { label: "Support Tickets" }]} />
      <PlatformTicketsClient />
    </div>
  );
}
