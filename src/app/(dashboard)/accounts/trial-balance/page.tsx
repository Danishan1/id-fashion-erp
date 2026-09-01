import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { TrialBalanceClient } from "./TrialBalanceClient";

export default async function TrialBalancePage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "financial_reports", "view").catch(() => notFound());

  return <TrialBalanceClient />;
}
