import { redirect } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { AccountSuspendedScreen } from "@/components/layout/AccountSuspendedScreen";

/**
 * Where a suspended company's users land (PLAT-006). Deliberately outside the
 * (dashboard) route group, so none of the ERP renders. If the company isn't
 * actually suspended, go back to the dashboard.
 */
export default async function AccountSuspendedPage() {
  const session = await auth();
  if (!session?.user || session.user.userType === "PLATFORM") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { company: { select: { isActive: true, name: true } } },
  });
  if (!user || user.company.isActive) redirect("/dashboard");

  return <AccountSuspendedScreen companyName={user.company.name} />;
}
