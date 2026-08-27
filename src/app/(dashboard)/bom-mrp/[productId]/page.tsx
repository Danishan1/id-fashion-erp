import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BomEditor } from "../BomEditor";
import { BomVersionPanel } from "./BomVersionPanel";

export default async function BomEditorPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const session = await auth();

  const { product, bom } = await getBomByProductId(session!.user.companyId, productId).catch(() => ({
    product: null,
    bom: null,
  }));
  if (!product) notFound();

  const currentVersion = bom?.versions.find((v) => v.versionNumber === bom.currentVersionNumber) ?? null;
  const canApprove = await PermissionService.can(session!.user.id, "bom_mrp", "approve");

  const initialItems = (currentVersion?.items ?? []).map((item) => ({
    materialId: item.materialId,
    colorId: item.colorId,
    quantityPerUnit: item.quantityPerUnit.toString(),
    wastagePercentage: item.wastagePercentage.toString(),
    uomId: item.uomId,
    notes: item.notes,
  }));

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "BOM / MRP", href: "/bom-mrp" },
          { label: product.styleName },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Bill of Materials — {product.styleName} <span className="text-sm text-zinc-400">({product.styleCode})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Materials consumed per one finished piece of this style.
        </p>
      </div>
      <BomVersionPanel
        key={productId}
        productId={productId}
        versions={JSON.parse(JSON.stringify(bom?.versions ?? []))}
        currentVersionNumber={bom?.currentVersionNumber ?? 0}
        canApprove={canApprove}
      />
      <BomEditor
        key={`editor-${productId}`}
        productId={productId}
        initialNotes={currentVersion?.notes ?? ""}
        initialItems={initialItems}
        isCurrentVersionLocked={currentVersion?.status === "APPROVED"}
        currentVersionNumber={bom?.currentVersionNumber ?? 0}
      />
    </div>
  );
}
