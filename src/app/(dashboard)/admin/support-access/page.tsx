import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { isCompanySupportAdmin, listCompanySupportAccess } from "@/modules/support-access/support-access.service";
import { SupportAccessPanel } from "./SupportAccessPanel";

/**
 * Customer-side control of platform support access (Platform SaaS Phase 2,
 * PLAT-010/013/014/015). Only the company's own Super Admin sees this page:
 * approve or reject requests with the code support gives you, approve write
 * access separately, revoke a live session, and read the full event log.
 */
export default async function SupportAccessPage() {
  const session = await auth();
  if (!session?.user || session.user.userType === "SUPPORT") notFound();
  const actor = { userId: session.user.id, companyId: session.user.companyId };
  if (!(await isCompanySupportAdmin(actor))) notFound();

  const requests = await listCompanySupportAccess(actor);

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administration", href: "/admin" },
          { label: "Support Access" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Support Access</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Platform support can only see your company&apos;s data after you approve a request with the 6-digit code they give
          you. Access is read-only, time-limited (max 2 hours), and you can revoke it at any time. Changing data needs a
          second, separate approval. Everything support opens or changes is logged below.
        </p>
      </div>
      <SupportAccessPanel initialRequests={JSON.parse(JSON.stringify(requests))} />
    </div>
  );
}
