import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { PaymentRequestsHubClient } from "./PaymentRequestsHubClient";

export default async function PaymentRequestsPage() {
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "payment_requests", "view").catch(() => notFound());

  const [canCreate, canApprove, canPay] = await Promise.all([
    PermissionService.can(userId, "payment_requests", "create"),
    PermissionService.can(userId, "payment_requests", "approve"),
    PermissionService.can(userId, "payment_requests", "post"),
  ]);

  return <PaymentRequestsHubClient canCreate={canCreate} canApprove={canApprove} canPay={canPay} />;
}
