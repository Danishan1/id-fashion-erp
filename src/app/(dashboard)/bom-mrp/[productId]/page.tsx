import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BomDetailTabs } from "./BomDetailTabs";

export default async function BomEditorPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const session = await auth();

  const { product, bom } = await getBomByProductId(session!.user.companyId, productId).catch(() => ({
    product: null,
    bom: null,
  }));
  if (!product) notFound();

  const initialItems = (bom?.items ?? []).map((item) => ({
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
      <BomDetailTabs key={productId} productId={productId} initialNotes={bom?.notes ?? ""} initialItems={initialItems} />
    </div>
  );
}
