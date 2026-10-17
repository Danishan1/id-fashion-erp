import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CustomerReturnsClient } from "./CustomerReturnsClient";

export default async function CustomerReturnsPage() {
  const session = await auth();
  if (!session?.user) notFound();

  const canView =
    (await PermissionService.has(session.user.id, "barcodes", "view")) ||
    (await PermissionService.has(session.user.id, "dispatch", "view"));

  if (!canView) notFound();

  return <CustomerReturnsClient />;
}
