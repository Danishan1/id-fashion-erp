import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { PaymentsListClient } from "./PaymentsListClient";

export default async function PaymentsListPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "payments", "view").catch(() => notFound());

  return <PaymentsListClient />;
}
