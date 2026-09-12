import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DesignBomTabs } from "./DesignBomTabs";

// The "Design BOM" is nothing new — it's simply this sample's own current
// SampleMaterial list (the same rows SampleWorkflowPanel's own materials
// table and "Update BOM" action already manage), just surfaced here as its
// own read-only view, reachable directly from the Sampling list. When the
// sample is already linked to a real Style, a second "Style BOM" tab
// embeds the exact same BomVersionPanel/BomEditor components the dedicated
// `/bom-mrp/[productId]` page uses — no BOM logic is duplicated, this page
// only arranges two already-existing views side by side.
export default async function DesignBomPage({ params }: { params: Promise<{ sampleRequestId: string }> }) {
  const { sampleRequestId } = await params;
  const session = await auth();
  await PermissionService.assert(session!.user.id, "sampling", "view").catch(() => notFound());

  const request = await getSampleRequestById(session!.user.companyId, sampleRequestId).catch(() => null);
  if (!request) notFound();

  const currentVersion = request.versions[0] ?? null;
  const canEditMaterials = await PermissionService.can(session!.user.id, "sampling", "edit");
  const canViewStyleBom = request.productId
    ? await PermissionService.can(session!.user.id, "bom_mrp", "view")
    : false;

  let styleBomVersions: unknown[] = [];
  let styleBomCurrentVersionNumber = 0;
  let canApproveBom = false;
  let styleName: string | null = null;
  let styleCode: string | null = null;

  if (request.productId && canViewStyleBom) {
    const { product, bom } = await getBomByProductId(session!.user.companyId, request.productId).catch(() => ({
      product: null,
      bom: null,
    }));
    styleBomVersions = bom?.versions ?? [];
    styleBomCurrentVersionNumber = bom?.currentVersionNumber ?? 0;
    styleName = product?.styleName ?? null;
    styleCode = product?.styleCode ?? null;
    canApproveBom = await PermissionService.can(session!.user.id, "bom_mrp", "approve");
  }

  const currentStyleVersion = (
    styleBomVersions as {
      versionNumber: number;
      status: string;
      notes: string | null;
      items: {
        materialId: string;
        colorId: string | null;
        quantityPerUnit: { toString(): string };
        wastagePercentage: { toString(): string };
        uomId: string;
        notes: string | null;
      }[];
    }[]
  ).find((v) => v.versionNumber === styleBomCurrentVersionNumber);
  const initialStyleItems = currentStyleVersion?.items ?? [];

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Sampling", href: "/sampling" },
          { label: request.requestNumber, href: `/sampling/${sampleRequestId}` },
          { label: "Design BOM" },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Design BOM — {request.styleName ?? request.requestNumber}{" "}
          <span className="text-sm text-zinc-400">({request.requestNumber})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The materials actually planned/used for this design&rsquo;s sample, from its current version.
        </p>
      </div>
      <DesignBomTabs
        productId={request.productId && canViewStyleBom ? request.productId : null}
        styleLabel={styleName ? `${styleName} (${styleCode})` : null}
        materials={JSON.parse(JSON.stringify(currentVersion?.materials ?? []))}
        canEditMaterials={canEditMaterials}
        styleBomVersions={JSON.parse(JSON.stringify(styleBomVersions))}
        styleBomCurrentVersionNumber={styleBomCurrentVersionNumber}
        canApproveBom={canApproveBom}
        initialStyleNotes={currentStyleVersion?.notes ?? ""}
        initialStyleItems={JSON.parse(
          JSON.stringify(
            initialStyleItems.map((item) => ({
              materialId: item.materialId,
              colorId: item.colorId,
              quantityPerUnit: item.quantityPerUnit.toString(),
              wastagePercentage: item.wastagePercentage.toString(),
              uomId: item.uomId,
              notes: item.notes,
            }))
          )
        )}
        isStyleVersionLocked={currentStyleVersion?.status === "APPROVED"}
      />
    </div>
  );
}
