"use client";

import { useEffect, useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface ProductRow {
  id: string;
  styleCode: string;
  styleName: string;
  imageUrl: string | null;
  category: { name: string } | null;
  season: { name: string } | null;
  brand: { name: string } | null;
  productType: { name: string } | null;
  productFitting: { name: string } | null;
  isActive: boolean;
  _count: { variants: number };
}

interface NamedOption {
  id: string;
  name: string;
}

const EMPTY_FILTERS = { categoryId: "", seasonId: "", brandId: "", productTypeId: "", productFittingId: "", isActive: "" };

export function ProductsListClient() {
  const [categories, setCategories] = useState<NamedOption[]>([]);
  const [seasons, setSeasons] = useState<NamedOption[]>([]);
  const [brands, setBrands] = useState<NamedOption[]>([]);
  const [productTypes, setProductTypes] = useState<NamedOption[]>([]);
  const [productFittings, setProductFittings] = useState<NamedOption[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  useEffect(() => {
    fetch("/api/v1/categories?pageSize=200").then((r) => r.json()).then((b) => setCategories(b.data ?? []));
    fetch("/api/v1/seasons?pageSize=200").then((r) => r.json()).then((b) => setSeasons(b.data ?? []));
    fetch("/api/v1/brands?pageSize=200").then((r) => r.json()).then((b) => setBrands(b.data ?? []));
    fetch("/api/v1/product-types?pageSize=200").then((r) => r.json()).then((b) => setProductTypes(b.data ?? []));
    fetch("/api/v1/product-fittings?pageSize=200").then((r) => r.json()).then((b) => setProductFittings(b.data ?? []));
  }, []);

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
        newHref="/masters/products/new"
        newLabel="New Style"
        searchPlaceholder="Search by style name or code…"
        rowHref={(row) => `/masters/products/${row.id}`}
        columns={[
          {
            key: "imageUrl",
            header: "",
            render: (row) =>
              row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.imageUrl} alt={row.styleName} className="h-10 w-10 rounded object-cover" />
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
    </div>
  );
}
