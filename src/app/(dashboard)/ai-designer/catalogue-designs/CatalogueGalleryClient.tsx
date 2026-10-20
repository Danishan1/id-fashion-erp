"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "../statusLabels";
import { attachmentUrl } from "../new-design/NewDesignWorkspace";

interface ProjectCard {
  id: string;
  projectNumber: string;
  projectName: string;
  status: string;
  designSource: string | null;
  productCategory: string | null;
  fabricName: string | null;
  fabricProduct: { styleName: string } | null;
  currentVersion: { versionNumber: number; currentImage: { id: string; imageAttachmentId: string } | null } | null;
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = { FABRIC: "From Fabric", GARMENT: "From Garment", SKETCH: "From Sketch" };

/**
 * Catalogue Designs — every AI Designer design as a card gallery with View
 * and Edit. A design without a generated image yet opens its own step flow
 * instead (New Design workspace, or the classic wizard for older projects).
 */
export function CatalogueGalleryClient() {
  const [rows, setRows] = useState<ProjectCard[] | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ creationMode: "STANDARD", page: String(page), pageSize: "24", sortBy: "createdAt", sortOrder: "desc" });
    if (query) params.set("search", query);
    fetch(`/api/v1/ai-designer/projects?${params}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load designs.");
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setRows(body.data);
        setTotalPages(body.meta?.totalPages ?? 1);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [page, query]);

  function continueHref(p: ProjectCard) {
    return p.designSource ? `/ai-designer/new-design/${p.id}` : `/ai-designer/catalogue-designs/${p.id}`;
  }

  return (
    <div className="space-y-5">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "AI Designer" }, { label: "Catalogue Designs" }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">Catalogue Designs</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Every AI-generated design — view the catalogue shot, create colour variants, or refine it in the AI studio.</p>
        </div>
        <div className="flex gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(search.trim());
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search designs…"
              className="w-56 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
          </form>
          <Link
            href="/ai-designer/new-design"
            className="rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:brightness-110"
          >
            + New Design
          </Link>
        </div>
      </div>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>}

      {rows === null && !error && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-96 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500">No designs yet.</p>
          <Link href="/ai-designer/new-design" className="mt-2 inline-block text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">
            Create your first design →
          </Link>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {rows.map((p) => {
            const img = p.currentVersion?.currentImage;
            return (
              <div key={p.id} className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                <Link href={img ? `/ai-designer/catalogue-designs/${p.id}/view` : continueHref(p)} className="relative block">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachmentUrl(img.imageAttachmentId)} alt={p.projectName} className="h-72 w-full object-cover object-top" />
                  ) : (
                    <div className="flex h-72 flex-col items-center justify-center gap-1 bg-gradient-to-br from-zinc-50 to-violet-50 text-zinc-400 dark:from-zinc-900 dark:to-violet-950/30">
                      <span className="text-3xl">✨</span>
                      <span className="text-xs">Not generated yet</span>
                    </div>
                  )}
                  <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[p.status] ?? ""}`}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  {p.currentVersion && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">v{p.currentVersion.versionNumber}</span>
                  )}
                </Link>
                <div className="p-3">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.projectName}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {p.projectNumber}
                    {p.productCategory ? ` · ${p.productCategory}` : ""}
                    {p.designSource ? ` · ${SOURCE_LABELS[p.designSource]}` : ""}
                  </p>
                  <p className="truncate text-xs text-zinc-400">{p.fabricProduct?.styleName ?? p.fabricName ?? "—"}</p>
                  <div className="mt-3 flex gap-2">
                    {img ? (
                      <>
                        <Link
                          href={`/ai-designer/catalogue-designs/${p.id}/view`}
                          className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          View
                        </Link>
                        <Link
                          href={`/ai-designer/catalogue-designs/${p.id}/edit`}
                          className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-1.5 text-center text-xs font-semibold text-white"
                        >
                          Edit
                        </Link>
                      </>
                    ) : (
                      <Link
                        href={continueHref(p)}
                        className="flex-1 rounded-lg border border-violet-300 py-1.5 text-center text-xs font-semibold text-violet-700 hover:bg-violet-50 dark:text-violet-300"
                      >
                        Continue design →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40 dark:border-zinc-700">
            ← Prev
          </button>
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-3 py-1 disabled:opacity-40 dark:border-zinc-700">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
