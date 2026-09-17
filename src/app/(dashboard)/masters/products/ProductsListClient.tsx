"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ProductForm, type ProductFormValues } from "./ProductForm";
import { VariantsSection } from "./VariantsSection";
import { ProductImagesSection } from "./ProductImagesSection";

interface ProductRow {
  id: string;
  styleCode: string;
  styleName: string;
  // Derived by the list API from mainImageAttachmentId — the raw imageUrl
  // column is a dead field, never written to; this is a separate, computed
  // value pointing at the designated gallery main image, if any.
  mainImageUrl: string | null;
  category: { name: string } | null;
  season: { name: string } | null;
  brand: { name: string } | null;
  productType: { name: string } | null;
  productFitting: { name: string } | null;
  isActive: boolean;
  _count: { variants: number; sampleRequests: number };
}

interface NamedOption {
  id: string;
  name: string;
}

const EMPTY_FILTERS = { categoryId: "", seasonId: "", brandId: "", productTypeId: "", productFittingId: "", isActive: "" };

/** A raw /api/v1/products/:id response — the shape ProductForm's initialValues are built from. */
interface ProductDetail {
  id: string;
  styleCode: string;
  styleName: string;
  categoryId: string | null;
  seasonId: string | null;
  brandId: string | null;
  productTypeId: string | null;
  productFittingId: string | null;
  gender: string | null;
  description: string | null;
  hsnSacCode: string | null;
  isActive: boolean;
}

function toFormValues(product: ProductDetail): ProductFormValues {
  return {
    styleCode: product.styleCode,
    styleName: product.styleName,
    categoryId: product.categoryId ?? "",
    seasonId: product.seasonId ?? "",
    brandId: product.brandId ?? "",
    productTypeId: product.productTypeId ?? "",
    productFittingId: product.productFittingId ?? "",
    gender: product.gender ?? "",
    description: product.description ?? "",
    hsnSacCode: product.hsnSacCode ?? "",
    isActive: product.isActive,
  };
}

export function ProductsListClient() {
  return (
    <Suspense>
      <ProductsListContent />
    </Suspense>
  );
}

function ProductsListContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [categories, setCategories] = useState<NamedOption[]>([]);
  const [seasons, setSeasons] = useState<NamedOption[]>([]);
  const [brands, setBrands] = useState<NamedOption[]>([]);
  const [productTypes, setProductTypes] = useState<NamedOption[]>([]);
  const [productFittings, setProductFittings] = useState<NamedOption[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; styleName: string; values: ProductFormValues } | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // A single per-row action menu (Edit/BOM/Variants/Designs/Images) replaced
  // this page's previous mix of plain links + separate bordered buttons —
  // consolidated here rather than each having its own trigger, per the same
  // "don't crowd a row with many inline buttons once it grows past 2-3"
  // standard ActionMenu.tsx's own doc comment already states.
  const [rowModal, setRowModal] = useState<{ type: "variants" | "images"; row: ProductRow } | null>(null);

  useEffect(() => {
    fetch("/api/v1/categories?pageSize=200").then((r) => r.json()).then((b) => setCategories(b.data ?? []));
    fetch("/api/v1/seasons?pageSize=200").then((r) => r.json()).then((b) => setSeasons(b.data ?? []));
    fetch("/api/v1/brands?pageSize=200").then((r) => r.json()).then((b) => setBrands(b.data ?? []));
    fetch("/api/v1/product-types?pageSize=200").then((r) => r.json()).then((b) => setProductTypes(b.data ?? []));
    fetch("/api/v1/product-fittings?pageSize=200").then((r) => r.json()).then((b) => setProductFittings(b.data ?? []));
  }, []);

  const openEdit = async (id: string) => {
    setEditLoadError(null);
    const res = await fetch(`/api/v1/products/${id}`);
    const body = await res.json();
    if (!res.ok) {
      setEditLoadError(body?.error?.message ?? "Failed to load this style.");
      return;
    }
    setEditTarget({ id, styleName: body.data.styleName, values: toFormValues(body.data) });
  };

  // Product's own edit page was removed in favor of this modal, but Sampling/
  // Reports/etc. still deep-link straight to /masters/products/{id} — that
  // route now redirects here with ?edit={id}, and this effect auto-opens the
  // same Edit modal for it, then cleans the param off the URL.
  useEffect(() => {
    const id = searchParams.get("edit");
    if (!id) return;
    // Deferred a tick so openEdit's own setState calls don't run
    // synchronously within the effect body itself (react-hooks/set-state-
    // in-effect) — same idiom used by ManageChildrenModal's own load effect.
    const timeout = setTimeout(() => {
      openEdit(id).then(() => router.replace(pathname));
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleCreated = () => {
    setAddOpen(false);
    setRefreshKey((k) => k + 1);
  };

  const handleEdited = () => {
    setEditTarget(null);
    setRefreshKey((k) => k + 1);
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const fetchUrl = `/api/v1/products${params.toString() ? `?${params.toString()}` : ""}`;
  const exportUrl = `/api/v1/products/export/xlsx${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Breadcrumb items={[{ label: "Masters", href: "/masters" }, { label: "Styles" }]} />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Styles</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Product styles with color/size variants.</p>
        </div>
        <a
          href={exportUrl}
          className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download Excel
        </a>
      </div>

      {editLoadError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {editLoadError}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div>
          <label htmlFor="category-filter" className="mb-1 block text-xs font-medium text-zinc-500">Garment Category</label>
          <select id="category-filter" value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="season-filter" className="mb-1 block text-xs font-medium text-zinc-500">Season</label>
          <select id="season-filter" value={filters.seasonId} onChange={(e) => setFilters({ ...filters, seasonId: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="brand-filter" className="mb-1 block text-xs font-medium text-zinc-500">Brand</label>
          <select id="brand-filter" value={filters.brandId} onChange={(e) => setFilters({ ...filters, brandId: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="product-type-filter" className="mb-1 block text-xs font-medium text-zinc-500">Product Type</label>
          <select id="product-type-filter" value={filters.productTypeId} onChange={(e) => setFilters({ ...filters, productTypeId: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            {productTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="fitting-filter" className="mb-1 block text-xs font-medium text-zinc-500">Fitting</label>
          <select id="fitting-filter" value={filters.productFittingId} onChange={(e) => setFilters({ ...filters, productFittingId: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            {productFittings.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status-filter" className="mb-1 block text-xs font-medium text-zinc-500">Status</label>
          <select id="status-filter" value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })} className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Clear Filters ({activeFilterCount})
          </button>
        )}
      </div>

      <DataTable<ProductRow>
        key={fetchUrl}
        fetchUrl={fetchUrl}
        refreshKey={refreshKey}
        newAction={{ label: "New Style", onClick: () => setAddOpen(true) }}
        searchPlaceholder="Search by style name or code…"
        rowActions={(row) => (
          <ActionMenu
            items={[
              { label: "Edit", onClick: () => openEdit(row.id) },
              { label: "BOM", onClick: () => router.push(`/bom-mrp/${row.id}`) },
              { label: `Variants (${row._count.variants})`, onClick: () => setRowModal({ type: "variants", row }) },
              {
                label: `Designs (${row._count.sampleRequests})`,
                onClick: () => router.push(`/masters/products/${row.id}/designs`),
              },
              { label: "Images", onClick: () => setRowModal({ type: "images", row }) },
            ]}
          />
        )}
        columns={[
          {
            key: "mainImageUrl",
            header: "",
            render: (row) =>
              row.mainImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.mainImageUrl} alt={row.styleName} className="h-10 w-10 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">—</div>
              ),
          },
          { key: "styleCode", header: "Style Code" },
          { key: "styleName", header: "Name" },
          { key: "category", header: "Garment Category", render: (row) => row.category?.name ?? "—" },
          { key: "season", header: "Season", render: (row) => row.season?.name ?? "—" },
          { key: "brand", header: "Brand", render: (row) => row.brand?.name ?? "—" },
          { key: "productType", header: "Type", render: (row) => row.productType?.name ?? "—" },
          { key: "variants", header: "Variants", render: (row) => row._count.variants },
          {
            key: "isActive",
            header: "Status",
            render: (row) => (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  row.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {row.isActive ? "Active" : "Inactive"}
              </span>
            ),
          },
        ]}
      />

      {rowModal?.type === "variants" && (
        <VariantsSection key={rowModal.row.id} productId={rowModal.row.id} onClose={() => setRowModal(null)} />
      )}
      {rowModal?.type === "images" && (
        <ProductImagesSection key={rowModal.row.id} productId={rowModal.row.id} onClose={() => setRowModal(null)} />
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New Style" maxWidthClass="max-w-xl">
        <ProductForm submitUrl="/api/v1/products" method="POST" onSuccess={handleCreated} onCancel={() => setAddOpen(false)} />
      </Modal>

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={`Edit Style — ${editTarget?.styleName ?? ""}`}
        maxWidthClass="max-w-xl"
      >
        {editTarget && (
          <ProductForm
            key={editTarget.id}
            initialValues={editTarget.values}
            submitUrl={`/api/v1/products/${editTarget.id}`}
            method="PATCH"
            onSuccess={handleEdited}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
}
