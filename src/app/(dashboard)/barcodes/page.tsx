import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BarcodeManagementListClient } from "./BarcodeManagementListClient";

export default async function BarcodeManagementPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "barcodes", "view").catch(() => notFound());

  return <BarcodeManagementListClient />;
}
