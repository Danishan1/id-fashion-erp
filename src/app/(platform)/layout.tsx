import type { ReactNode } from "react";
import { PlatformSessionInvalid, PlatformShell } from "@/components/platform/PlatformShell";
import { getPlatformPageUser } from "@/modules/platform/platform-page";

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_SUPER_ADMIN: "Platform Super Admin",
  SUPPORT_AGENT: "Support Agent",
  BILLING_ADMIN: "Billing Admin",
};

/**
 * The platform administration portal (Platform SaaS Phase 1, PLAT-003).
 * Separate from the customer ERP's (dashboard) layout. The middleware only
 * lets platform sessions in here; this re-checks the account live.
 */
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await getPlatformPageUser();
  if (!user) return <PlatformSessionInvalid />;

  return (
    <PlatformShell userName={user.fullName} roleLabel={ROLE_LABELS[user.role] ?? user.role}>
      {children}
    </PlatformShell>
  );
}
