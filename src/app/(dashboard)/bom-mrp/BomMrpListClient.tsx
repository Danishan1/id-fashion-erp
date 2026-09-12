"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../sampling/statusLabels";
import { BomVersionPanel } from "./[productId]/BomVersionPanel";
import { BomEditor } from "./BomEditor";
import { DesignBomTabs } from "./design/[sampleRequestId]/DesignBomTabs";

interface StyleRow {
  id: string;
  styleName: string;
  styleCode: string;
  bomItemCount: number;
}

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string | null;
  status: keyof typeof STATUS_LABELS;
  requestDate: string;
  customer: { name: string } | null;
  product: { styleName: string } | null;
}

interface StyleBomVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  approvedAt: string | null;
  approvedBy: { fullName: string } | null;
  items: {
    materialId: string;
    colorId: string | null;
    quantityPerUnit: string;
    wastagePercentage: string;
    uomId: string;
    notes: string | null;
  }[];
}

interface StyleBomData {
  product: { id: string; styleName: string; styleCode: string } | null;
  bom: { currentVersionNumber: number; versions: StyleBomVersion[] } | null;
}

// "Style" is the existing Style BOM (Bom/BomItem, once a design has
// graduated into a real Product); "Design BOM" is Sampling's own material
// list per sample — reuses the exact same /api/v1/sampling list endpoint
// the Sampling worklist itself is built on, just projected through the
// generic DataTable instead of that page's own bespoke filter panel, since
// this tab only needs a quick way to reach a design's BOM, not the full
// Sampling worklist experience.
//
// Both tabs edit inline, on this same page — selecting a row expands its
// editable BOM directly below the list (client-fetched via the same GET
// endpoints the dedicated /bom-mrp/[productId] and /bom-mrp/design/[id]
// pages use), rather than navigating away to either of those routes. Those
// two standalone pages are kept as-is for their own direct entry points
// (deep links from AI Garment Flow/Products/Material Request, and
// Sampling's own "Design BOM" list link) — this view is purely a second,
// faster way to reach the exact same editors without leaving /bom-mrp.
export function BomMrpListClient({
  canViewDesignBom,
  canEditSampleMaterials,
  canApproveBom,
}: {
  canViewDesignBom: boolean;
  canEditSampleMaterials: boolean;
  canApproveBom: boolean;
}) {
  const [tab, setTab] = useState<"style" | "design">("style");
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedSampleRequestId, setSelectedSampleRequestId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "BOM / MRP" }]} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">BOM / MRP</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Bill of Materials per style, and material requirements planning against Sales Orders.
          </p>
        </div>
        <Link
          href="/bom-mrp/requirements"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Material Requirements
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("style")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "style"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Style
        </button>
        {canViewDesignBom && (
          <button
            type="button"
            onClick={() => setTab("design")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "design"
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Design BOM
          </button>
        )}
      </div>

      {tab === "style" && (
        <div className="space-y-4">
          <DataTable<StyleRow>
            fetchUrl="/api/v1/bom-mrp"
            searchPlaceholder="Search by style name or code…"
            onEditRow={(row) => setSelectedStyleId(row.id)}
            columns={[
              { key: "styleName", header: "Style" },
              { key: "styleCode", header: "Code" },
              {
                key: "bomItemCount",
                header: "BOM Lines",
                render: (row) =>
                  row.bomItemCount > 0 ? (
                    `${row.bomItemCount} line${row.bomItemCount === 1 ? "" : "s"}`
                  ) : (
                    <span className="text-zinc-400">No BOM yet</span>
                  ),
              },
            ]}
          />
          {selectedStyleId && (
            <InlineStyleBom
              key={selectedStyleId}
              productId={selectedStyleId}
              canApproveBom={canApproveBom}
              onClose={() => setSelectedStyleId(null)}
            />
          )}
        </div>
      )}

      {tab === "design" && canViewDesignBom && (
        <div className="space-y-4">
          <DataTable<SampleRequestRow>
            fetchUrl="/api/v1/sampling"
            searchPlaceholder="Search by request number…"
            onEditRow={(row) => setSelectedSampleRequestId(row.id)}
            columns={[
              { key: "requestNumber", header: "Request #" },
              { key: "styleName", header: "Design Name", render: (row) => row.styleName ?? "—" },
              { key: "product", header: "Style", render: (row) => row.product?.styleName ?? "—" },
              { key: "customer", header: "Customer", render: (row) => row.customer?.name ?? "—" },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}>
                    {STATUS_LABELS[row.status] ?? row.status}
                  </span>
                ),
              },
              { key: "requestDate", header: "Request Date", render: (row) => new Date(row.requestDate).toLocaleDateString() },
            ]}
          />
          {selectedSampleRequestId && (
            <InlineDesignBom
              key={selectedSampleRequestId}
              sampleRequestId={selectedSampleRequestId}
              canEditMaterials={canEditSampleMaterials}
              canApproveBom={canApproveBom}
              onClose={() => setSelectedSampleRequestId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 dark:border-indigo-900 dark:bg-indigo-500/5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ✕ Close
        </button>
      </div>
      {children}
    </div>
  );
}

function InlineStyleBom({
  productId,
  canApproveBom,
  onClose,
}: {
  productId: string;
  canApproveBom: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<StyleBomData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/bom-mrp/${productId}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setData(body.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (data === undefined) {
    return (
      <SectionCard title="Style BOM" onClose={onClose}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </SectionCard>
    );
  }

  if (!data || !data.product) {
    return (
      <SectionCard title="Style BOM" onClose={onClose}>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load this style&rsquo;s BOM.</p>
      </SectionCard>
    );
  }

  const { product, bom } = data;
  const currentVersion = bom?.versions.find((v) => v.versionNumber === bom.currentVersionNumber) ?? null;
  const initialItems = (currentVersion?.items ?? []).map((item) => ({
    materialId: item.materialId,
    colorId: item.colorId,
    quantityPerUnit: item.quantityPerUnit.toString(),
    wastagePercentage: item.wastagePercentage.toString(),
    uomId: item.uomId,
    notes: item.notes,
  }));

  return (
    <SectionCard title={`Style BOM — ${product.styleName} (${product.styleCode})`} onClose={onClose}>
      <div className="space-y-4">
        <BomVersionPanel
          productId={productId}
          versions={bom?.versions ?? []}
          currentVersionNumber={bom?.currentVersionNumber ?? 0}
          canApprove={canApproveBom}
        />
        <BomEditor
          productId={productId}
          initialNotes={currentVersion?.notes ?? ""}
          initialItems={initialItems}
          isCurrentVersionLocked={currentVersion?.status === "APPROVED"}
          currentVersionNumber={bom?.currentVersionNumber ?? 0}
        />
      </div>
    </SectionCard>
  );
}

function InlineDesignBom({
  sampleRequestId,
  canEditMaterials,
  canApproveBom,
  onClose,
}: {
  sampleRequestId: string;
  canEditMaterials: boolean;
  canApproveBom: boolean;
  onClose: () => void;
}) {
  const [request, setRequest] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [styleBom, setStyleBom] = useState<StyleBomData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sampling/${sampleRequestId}`)
      .then((res) => res.json())
      .then(async (body) => {
        if (cancelled) return;
        const data = body.data ?? null;
        setRequest(data);
        if (data?.productId) {
          const bomRes = await fetch(`/api/v1/bom-mrp/${data.productId}`);
          const bomBody = await bomRes.json();
          if (!cancelled) setStyleBom(bomBody.data ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setRequest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sampleRequestId]);

  if (request === undefined) {
    return (
      <SectionCard title="Design BOM" onClose={onClose}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </SectionCard>
    );
  }

  if (!request) {
    return (
      <SectionCard title="Design BOM" onClose={onClose}>
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load this design&rsquo;s BOM.</p>
      </SectionCard>
    );
  }

  const versions = (request.versions as { materials: unknown[] }[] | undefined) ?? [];
  const currentVersion = versions[0] ?? null;
  const styleBomVersions = styleBom?.bom?.versions ?? [];
  const styleBomCurrentVersionNumber = styleBom?.bom?.currentVersionNumber ?? 0;
  const currentStyleVersion = styleBomVersions.find((v) => v.versionNumber === styleBomCurrentVersionNumber);
  const initialStyleItems = (currentStyleVersion?.items ?? []).map((item) => ({
    materialId: item.materialId,
    colorId: item.colorId,
    quantityPerUnit: item.quantityPerUnit.toString(),
    wastagePercentage: item.wastagePercentage.toString(),
    uomId: item.uomId,
    notes: item.notes,
  }));

  return (
    <SectionCard
      title={`Design BOM — ${(request.styleName as string | null) ?? (request.requestNumber as string)} (${request.requestNumber as string})`}
      onClose={onClose}
    >
      <DesignBomTabs
        productId={(request.productId as string | null) ?? null}
        styleLabel={styleBom?.product ? `${styleBom.product.styleName} (${styleBom.product.styleCode})` : null}
        materials={(currentVersion?.materials as never[]) ?? []}
        canEditMaterials={canEditMaterials}
        styleBomVersions={styleBomVersions}
        styleBomCurrentVersionNumber={styleBomCurrentVersionNumber}
        canApproveBom={canApproveBom}
        initialStyleNotes={currentStyleVersion?.notes ?? ""}
        initialStyleItems={initialStyleItems}
        isStyleVersionLocked={currentStyleVersion?.status === "APPROVED"}
      />
    </SectionCard>
  );
}
