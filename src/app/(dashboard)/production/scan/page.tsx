import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ProductionScanClient } from "./ProductionScanClient";

export default async function ProductionScanPage() {
  const session = await auth();
  await PermissionService.assert(session!.user.id, "barcodes", "scan").catch(() => notFound());

  return <ProductionScanClient />;
}
