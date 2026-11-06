"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, LoadingState } from "@/components/ui/PageStates";
import { readApiError } from "@/lib/api-client";
import { ASSET_MIME, ASSET_TYPE_KEYS, ASSET_TYPES, REVIEW_SUBJECTS, assetMaxBytes, type AssetType, type ReviewSubject } from "@/modules/sales-marketing/content/content-registry";
import { selectClass } from "../performance/performance-ui";
import { CARD, ReviewBadge, fileUrl, fmtBytes, fmtDateTime } from "./content-ui";

type Tab = "assets" | "templates" | "reviews";

/** Sales & Marketing → Content Library (Phase 11). */
export function ContentLibraryClient({ initialTab, canCreate }: { initialTab: Tab; canCreate: boolean }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: [Tab, string][] = [
    ["assets", "Assets"],
    ["templates", "Templates"],
    ["reviews", "Reviews"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => (setTab(k), window.history.replaceState(null, "", `?tab=${k}`))}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "assets" && <AssetsTab canCreate={canCreate} />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "reviews" && <ReviewsTab />}
    </div>
  );
}

// ── Assets ─────────────────────────────────────────────────────────

interface AssetRow {
  id: string;
  code: string;
  name: string;
  assetType: string;
  tags: string[];
  status: string;
  owner: string;
  currentVersion: { id: string; versionNumber: number; mimeType: string; fileSizeBytes: number; width: number | null; height: number | null; review: string } | null;
  approvedVersionNumber: number | null;
  expiresOn: string | null;
}

function AssetsTab({ canCreate }: { canCreate: boolean }) {
  const [filters, setFilters] = useState({ search: "", assetType: "", status: "", review: "", tag: "" });
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ data: AssetRow[]; meta: { totalPages: number; totalCount: number } } | null>(null);
  const [uploading, setUploading] = useState(false);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page: String(page), pageSize: "24" }).toString();
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/sales-marketing/content/assets?${qs}`, { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => alive && b && setData(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [qs, tick]);
  const set = (k: keyof typeof filters, v: string) => (setFilters({ ...filters, [k]: v }), setPage(1));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${textInputClass()} !w-56`} placeholder="Search name, code, tag…" value={filters.search} onChange={(e) => set("search", e.target.value)} aria-label="Search" />
        <select className={selectClass} value={filters.assetType} onChange={(e) => set("assetType", e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {ASSET_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {ASSET_TYPES[k].label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={filters.review} onChange={(e) => set("review", e.target.value)} aria-label="Approval">
          <option value="">Approved or not</option>
          <option value="approved">Has an approved version</option>
          <option value="unapproved">Nothing approved yet</option>
        </select>
        <select className={selectClass} value={filters.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
          <option value="">Active</option>
          <option value="ARCHIVED">Archived</option>
          <option value="ANY">Active and archived</option>
        </select>
        <input className={`${textInputClass()} !w-36`} placeholder="Tag" value={filters.tag} onChange={(e) => set("tag", e.target.value)} aria-label="Tag" />
        {canCreate && (
          <Button size="sm" onClick={() => setUploading(true)}>
            Upload asset
          </Button>
        )}
      </div>
      {!data ? (
        <LoadingState />
      ) : data.data.length === 0 ? (
        <EmptyState title="No assets" description="Upload images, logos, PDFs or short videos to reuse them in campaigns." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.data.map((a) => (
            <Link key={a.id} href={`/sales-marketing/content/assets/${a.id}`} className={`${CARD} block hover:border-indigo-300`}>
              <div className="mb-2 flex h-32 items-center justify-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                {a.currentVersion?.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(a.currentVersion.id, true)} alt="" className="max-h-32 max-w-full object-contain" loading="lazy" />
                ) : (
                  <span className="text-xs uppercase text-zinc-500">{a.currentVersion ? (ASSET_MIME[a.currentVersion.mimeType as keyof typeof ASSET_MIME]?.label ?? a.currentVersion.mimeType) : "No file"}</span>
                )}
              </div>
              <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{a.name}</div>
              <div className="text-xs text-zinc-500">
                {a.code} · {ASSET_TYPES[a.assetType as AssetType]?.label ?? a.assetType}
                {a.currentVersion ? ` · v${a.currentVersion.versionNumber} · ${fmtBytes(a.currentVersion.fileSizeBytes)}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {a.currentVersion && <ReviewBadge status={a.currentVersion.review} />}
                {a.approvedVersionNumber && a.currentVersion?.review !== "APPROVED" && <span className="text-xs text-zinc-500">v{a.approvedVersionNumber} approved</span>}
                {a.status === "ARCHIVED" && <span className="text-xs text-zinc-500">Archived</span>}
              </div>
              {a.tags.length > 0 && <div className="mt-1 truncate text-xs text-zinc-500">#{a.tags.join(" #")}</div>}
            </Link>
          ))}
        </div>
      )}
      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {data.meta.totalPages} · {data.meta.totalCount} assets
          </span>
          <Button size="xs" variant="secondary" disabled={page >= data.meta.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      {uploading && <UploadAssetModal onClose={() => setUploading(false)} onDone={() => (setUploading(false), setTick((t) => t + 1))} />}
    </div>
  );
}

function UploadAssetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [meta, setMeta] = useState({ name: "", assetType: "IMAGE" as AssetType, description: "", tags: "", altText: "", usageNotes: "", expiresOn: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupes, setDupes] = useState<{ id: string; code: string; name: string }[] | null>(null);
  const max = assetMaxBytes({});
  const accept = ASSET_TYPES[meta.assetType].mimes.join(",");
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set(
      "metadata",
      JSON.stringify({
        name: meta.name,
        assetType: meta.assetType,
        description: meta.description || null,
        tags: meta.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        altText: meta.altText || null,
        usageNotes: meta.usageNotes || null,
        expiresOn: meta.expiresOn || null,
      })
    );
    try {
      const res = await fetch("/api/v1/sales-marketing/content/assets", { method: "POST", body: fd, headers: { "x-toast": "off" } });
      if (!res.ok) return setErr((await readApiError(res)).message);
      const body = await res.json();
      if (body.data.duplicates?.length) setDupes(body.data.duplicates);
      else onDone();
    } catch {
      setErr("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  if (dupes)
    return (
      <Modal open onClose={onDone} title="Uploaded — same file found elsewhere">
        <p className="text-sm">The identical file is already in the library:</p>
        <ul className="my-2 list-disc pl-5 text-sm">
          {dupes.map((d) => (
            <li key={d.id}>
              <Link className="text-indigo-600 hover:underline" href={`/sales-marketing/content/assets/${d.id}`}>
                {d.code} · {d.name}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-sm text-zinc-600">Your upload was saved. Archive one of them if it isn&apos;t needed twice.</p>
        <div className="mt-3 flex justify-end">
          <Button onClick={onDone}>OK</Button>
        </div>
      </Modal>
    );
  return (
    <Modal open onClose={onClose} title="Upload asset" maxWidthClass="max-w-xl">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="a-name" required>
            <input id="a-name" className={textInputClass()} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
          </FormField>
          <FormField label="Type" htmlFor="a-type" required>
            <select id="a-type" className={textInputClass()} value={meta.assetType} onChange={(e) => (setMeta({ ...meta, assetType: e.target.value as AssetType }), setFile(null))}>
              {ASSET_TYPE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ASSET_TYPES[k].label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="File" htmlFor="a-file" required>
          <input id="a-file" type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          <p className="mt-1 text-xs text-zinc-500">
            {ASSET_TYPES[meta.assetType].help} Up to {Math.round(max / 1048576)} MB. The file&apos;s content is checked, not just its name. No virus scanner is configured.
          </p>
          {file && file.size > max && <p className="mt-1 text-xs text-red-700">This file is {fmtBytes(file.size)} — too large.</p>}
        </FormField>
        <FormField label="Description" htmlFor="a-desc">
          <input id="a-desc" className={textInputClass()} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tags (comma separated)" htmlFor="a-tags">
            <input id="a-tags" className={textInputClass()} value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} placeholder="diwali, brochure" />
          </FormField>
          <FormField label="Usable until (licence expiry)" htmlFor="a-exp">
            <input id="a-exp" type="date" className={textInputClass()} value={meta.expiresOn} onChange={(e) => setMeta({ ...meta, expiresOn: e.target.value })} />
          </FormField>
        </div>
        {(meta.assetType === "IMAGE" || meta.assetType === "LOGO") && (
          <FormField label="Alt text (describes the image)" htmlFor="a-alt">
            <input id="a-alt" className={textInputClass()} value={meta.altText} onChange={(e) => setMeta({ ...meta, altText: e.target.value })} />
          </FormField>
        )}
        <FormField label="Usage rights / restrictions" htmlFor="a-usage">
          <input id="a-usage" className={textInputClass()} value={meta.usageNotes} onChange={(e) => setMeta({ ...meta, usageNotes: e.target.value })} placeholder="e.g. Licensed for India, print and email only" />
        </FormField>
        {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !file || !meta.name.trim() || file.size > max} onClick={save}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Templates ──────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  name: string;
  channelType: string;
  crmStatus: string;
  currentVersionNumber: number;
  currentReview: string;
  approvedVersionNumber: number | null;
  updatedAt: string;
}

function TemplatesTab() {
  const [channelType, setChannel] = useState("");
  const [review, setReview] = useState("");
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Message templates are written in CRM → Templates. A campaign can only send a template version that has been approved here for marketing; later edits need a new approval.
      </p>
      <DataTable<TemplateRow>
        fetchUrl="/api/v1/sales-marketing/content/templates"
        searchPlaceholder="Search templates…"
        rowHref={(r) => `/sales-marketing/content/templates/${r.id}`}
        extraParams={{ channelType, review }}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <select className={selectClass} value={channelType} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              <option value="">All channels</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
            <select className={selectClass} value={review} onChange={(e) => setReview(e.target.value)} aria-label="Review">
              <option value="">Any review state</option>
              <option value="needs_review">Current version not approved</option>
              <option value="pending">In review</option>
              <option value="approved">Has an approved version</option>
            </select>
          </div>
        }
        columns={[
          { key: "name", header: "Template", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "channelType", header: "Channel", render: (r) => r.channelType.charAt(0) + r.channelType.slice(1).toLowerCase() },
          { key: "current", header: "Current version", render: (r) => <span className="flex items-center gap-2">v{r.currentVersionNumber} <ReviewBadge status={r.currentReview} /></span> },
          { key: "approved", header: "Sent by campaigns", render: (r) => (r.approvedVersionNumber ? `v${r.approvedVersionNumber}` : <span className="text-zinc-500">Nothing approved</span>) },
          { key: "crm", header: "CRM status", render: (r) => r.crmStatus.toLowerCase() },
        ]}
      />
    </div>
  );
}

// ── Reviews ────────────────────────────────────────────────────────

interface ReviewRow {
  id: string;
  subjectType: ReviewSubject;
  label: string;
  href: string;
  status: string;
  author: string;
  submittedBy: string;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  mine: boolean;
}

function ReviewsTab() {
  const [status, setStatus] = useState("PENDING");
  const [subjectType, setType] = useState("");
  return (
    <DataTable<ReviewRow>
      fetchUrl="/api/v1/sales-marketing/content/reviews"
      hideSearch
      rowHref={(r) => r.href}
      extraParams={{ status, subjectType }}
      toolbar={
        <div className="flex flex-wrap gap-2">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="PENDING">Waiting for review</option>
            <option value="APPROVED">Approved</option>
            <option value="CHANGES_REQUESTED">Changes requested</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
          <select className={selectClass} value={subjectType} onChange={(e) => setType(e.target.value)} aria-label="Kind">
            <option value="">Everything</option>
            {(Object.keys(REVIEW_SUBJECTS) as ReviewSubject[]).map((k) => (
              <option key={k} value={k}>
                {REVIEW_SUBJECTS[k]}
              </option>
            ))}
          </select>
        </div>
      }
      columns={[
        { key: "label", header: "Version", render: (r) => <span className="font-medium">{r.label}</span> },
        { key: "kind", header: "Kind", render: (r) => REVIEW_SUBJECTS[r.subjectType] },
        { key: "status", header: "Status", render: (r) => <ReviewBadge status={r.status} /> },
        { key: "who", header: "Written / submitted by", render: (r) => `${r.author}${r.submittedBy !== r.author ? ` / ${r.submittedBy}` : ""}${r.mine ? " (you)" : ""}` },
        { key: "when", header: "Submitted", render: (r) => fmtDateTime(r.submittedAt) },
        { key: "decision", header: "Decision", render: (r) => (r.decidedBy ? `${r.decidedBy}, ${fmtDateTime(r.decidedAt)}${r.comment ? ` — ${r.comment}` : ""}` : "—") },
      ]}
    />
  );
}
