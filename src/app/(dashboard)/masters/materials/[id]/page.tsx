import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getMaterialById } from "@/modules/products/product.service";
import type { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { MaterialEditFormClient } from "./MaterialEditFormClient";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditMaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const material = await getMaterialById(session!.user.companyId, id).catch(() => null);
  if (!material) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Raw Materials", href: "/masters/materials" },
            { label: material.styleName },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{material.styleName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Item Code: {material.styleCode}</p>
      </div>

      <MaterialEditFormClient
        key={id}
        id={id}
        initialValues={{
          styleCode: material.styleCode,
          styleName: material.styleName,
          materialCategory: (material.materialCategory ?? "OTHER") as (typeof MATERIAL_CATEGORIES)[number],
          baseUomId: material.baseUomId ?? "",
          defaultSupplierId: material.defaultSupplierId ?? "",
          reorderLevel: material.reorderLevel?.toString() ?? "",
          unitCost: material.unitCost?.toString() ?? "",
          description: material.description ?? "",
          hsnSacCode: material.hsnSacCode ?? "",
          isActive: material.isActive,
        }}
      />
    </div>
  );
}
