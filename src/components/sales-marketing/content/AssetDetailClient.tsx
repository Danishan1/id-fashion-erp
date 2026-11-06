"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { readApiError } from "@/lib/api-client";
import { ASSET_TYPES, type AssetType } from "@/modules/sales-marketing/content/content-registry";
import { CARD, ReviewActions, ReviewBadge, fileUrl, fmtBytes, fmtDateTime, send, useApi } from "./content-ui";

interface Version {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  preview: "image" | "pdf" | "video" | null;
  attachable: boolean;
  fileSizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  scanStatus: string;
  changeNote: string | null;
  createdBy: string;
  createdByMe: boolean;
  createdAt: string;
  review: string;
  decidedBy: string | null;
  decisionComment: string | null;
}
interface Asset {
  id: string;
  code: string;
  name: string;
  description: string | null;
  assetType: AssetType;
  tags: string[];
  altText: string | null;
  usageNotes: string | null;
  expiresOn: string | null;
  expired: boolean;
  owner: string;
  status: string;
  currentVersionId: string | null;
  approvedVersionId: string | null;
  version: number;
  versions: Version[];
  usage: { contentId: string; contentName: string; contentVersion: number; assetVersion: number; campaign: { id: string; code: string; status: string }; live: boolean }[];
  duplicates: { id: string; code: string; name: string }[];
}

export function AssetDetailClient({ assetId, canEdit, canArchive, canApprove, canReject }: { assetId: string; canEdit: boolean; canArchive: boolean; canApprove: boolean; canReject: boolean }) {
  const { data: a, error, reload } = useApi<Asset>(`/api/v1/sales-marketing/content/assets/${assetId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!a) return <LoadingState />;
  const v = a.versions.find((x) => x.id === (selected ?? a.currentVersionId)) ?? a.versions[0];
  const active = a.status === "ACTIVE";
  const done = (text: string) => (setMsg({ ok: true, text }), reload());

  const archive = async () => {
    const live = a.usage.filter((u) => u.live);
    if (active && !confirm(live.length ? "This asset is used by content of open campaigns — archiving will be refused." : "Archive this asset? It stays in history but can't be picked for new content.")) return;
    try {
      await send(`/api/v1/sales-marketing/content/assets/${a.id}/archive`, "POST", { archived: active, version: a.version });
      done(active ? "Archived." : "Restored.");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`${CARD} lg:col-span-2`}>
          {v ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Version {v.versionNumber}</span>
                  {v.id === a.currentVersionId && <span className="text-xs text-zinc-500">current</span>}
                  {v.id === a.approvedVersionId && <span className="text-xs text-green-700">used for new content</span>}
                  <ReviewBadge status={v.review} />
                </div>
                <a className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" href={fileUrl(v.id)}>
                  Download
                </a>
              </div>
              <div className="flex min-h-48 items-center justify-center rounded bg-zinc-100 p-2 dark:bg-zinc-800">
                {v.preview === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(v.id, true)} alt={a.altText ?? ""} className="max-h-[28rem] max-w-full object-contain" />
                ) : v.preview === "video" ? (
                  <video src={fileUrl(v.id, true)} controls className="max-h-[28rem] max-w-full" />
                ) : v.preview === "pdf" ? (
                  <a className="text-sm text-indigo-600 hover:underline" href={fileUrl(v.id, true)} target="_blank" rel="noopener noreferrer">
                    Open the PDF in a new tab
                  </a>
                ) : (
                  <span className="text-sm text-zinc-500">No preview for this type — download it.</span>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Field label="File" value={v.fileName} />
                <Field label="Type" value={v.mimeType} />
                <Field label="Size" value={fmtBytes(v.fileSizeBytes)} />
                {v.width && <Field label="Dimensions" value={`${v.width} × ${v.height} px`} />}
                <Field label="Uploaded" value={`${v.createdBy}, ${fmtDateTime(v.createdAt)}`} />
                <Field label="Virus scan" value={v.scanStatus === "NOT_SCANNED" ? "Not scanned (no scanner configured)" : v.scanStatus} />
                <Field label="Can be emailed" value={v.attachable ? "Yes" : "No"} />
                <Field label="SHA-256" value={`${v.sha256.slice(0, 16)}…`} />
                {v.changeNote && <Field label="Change note" value={v.changeNote} />}
              </dl>
              {v.decidedBy && (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  Decided by {v.decidedBy}
                  {v.decisionComment ? `: ${v.decisionComment}` : ""}
                </p>
              )}
              {active && (
                <div className="mt-3">
                  <ReviewActions subjectType="ASSET_VERSION" subjectId={v.id} status={v.review} canEdit={canEdit} canApprove={canApprove} canReject={canReject} isAuthor={v.createdByMe} onDone={done} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-500">No file.</p>
          )}
        </div>

        <div className="space-y-4">
          <div className={CARD}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Details</h3>
              {canEdit && active && !editing && (
                <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
            {editing ? (
              <MetadataForm a={a} onCancel={() => setEditing(false)} onSaved={() => (setEditing(false), done("Saved."))} />
            ) : (
              <dl className="space-y-1 text-sm">
                <Field label="Code" value={a.code} />
                <Field label="Type" value={ASSET_TYPES[a.assetType]?.label ?? a.assetType} />
                <Field label="Owner" value={a.owner} />
                {a.description && <Field label="Description" value={a.description} />}
                {a.tags.length > 0 && <Field label="Tags" value={a.tags.join(", ")} />}
                {a.altText && <Field label="Alt text" value={a.altText} />}
                {a.usageNotes && <Field label="Usage rights" value={a.usageNotes} />}
                {a.expiresOn && <Field label="Usable until" value={`${a.expiresOn}${a.expired ? " (expired — can't be sent)" : ""}`} />}
                <Field label="Status" value={a.status === "ACTIVE" ? "Active" : "Archived"} />
              </dl>
            )}
            {canArchive && (
              <div className="mt-3">
                <Button size="xs" variant={active ? "danger" : "secondary"} onClick={archive}>
                  {active ? "Archive" : "Restore"}
                </Button>
              </div>
            )}
          </div>

          {canEdit && active && <NewVersionForm assetId={a.id} assetType={a.assetType} onDone={(t) => (setSelected(null), done(t))} />}

          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Versions</h3>
            <ul className="space-y-1 text-sm">
              {a.versions.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`flex w-full items-center justify-between gap-2 rounded px-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${x.id === v?.id ? "font-medium" : ""}`} onClick={() => setSelected(x.id)}>
                    <span>
                      v{x.versionNumber} · {fmtBytes(x.fileSizeBytes)} · {fmtDateTime(x.createdAt)}
                    </span>
                    <ReviewBadge status={x.review} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Used by</h3>
            {a.usage.length === 0 ? (
              <p className="text-sm text-zinc-500">Not attached to any campaign content.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {a.usage.map((u, i) => (
                  <li key={i}>
                    <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/content/items/${u.contentId}`}>
                      {u.campaign.code} · {u.contentName} v{u.contentVersion}
                    </Link>{" "}
                    <span className="text-zinc-500">
                      (asset v{u.assetVersion}
                      {u.live ? ", in use" : ""})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {a.duplicates.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                The same file is also in:{" "}
                {a.duplicates.map((d, i) => (
                  <span key={d.id}>
                    {i ? ", " : ""}
                    <Link className="underline" href={`/sales-marketing/content/assets/${d.id}`}>
                      {d.code}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="break-words text-zinc-900 dark:text-zinc-100">{value}</dd>
    </div>
  );
}

function MetadataForm({ a, onCancel, onSaved }: { a: Asset; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: a.name, description: a.description ?? "", tags: a.tags.join(", "), altText: a.altText ?? "", usageNotes: a.usageNotes ?? "", expiresOn: a.expiresOn ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/v1/sales-marketing/content/assets/${a.id}`, "PATCH", {
        name: f.name,
        description: f.description || null,
        tags: f.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        altText: f.altText || null,
        usageNotes: f.usageNotes || null,
        expiresOn: f.expiresOn || null,
        version: a.version,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <FormField label="Name" htmlFor="m-name" required>
        <input id="m-name" className={textInputClass()} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </FormField>
      <FormField label="Description" htmlFor="m-desc">
        <input id="m-desc" className={textInputClass()} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </FormField>
      <FormField label="Tags" htmlFor="m-tags">
        <input id="m-tags" className={textInputClass()} value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
      </FormField>
      <FormField label="Alt text" htmlFor="m-alt">
        <input id="m-alt" className={textInputClass()} value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} />
      </FormField>
      <FormField label="Usage rights" htmlFor="m-usage">
        <input id="m-usage" className={textInputClass()} value={f.usageNotes} onChange={(e) => setF({ ...f, usageNotes: e.target.value })} />
      </FormField>
      <FormField label="Usable until" htmlFor="m-exp">
        <input id="m-exp" type="date" className={textInputClass()} value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />
      </FormField>
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button size="xs" disabled={busy || !f.name.trim()} onClick={save}>
          Save
        </Button>
        <Button size="xs" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function NewVersionForm({ assetId, assetType, onDone }: { assetId: string; assetType: AssetType; onDone: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("changeNote", note);
    try {
      const res = await fetch(`/api/v1/sales-marketing/content/assets/${assetId}/versions`, { method: "POST", body: fd, headers: { "x-toast": "off" } });
      if (!res.ok) return setErr((await readApiError(res)).message);
      setFile(null);
      setNote("");
      setKey((k) => k + 1);
      onDone("New version uploaded. Submit it for review before campaigns can use it — existing content keeps the version it attached.");
    } catch {
      setErr("Upload failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={CARD}>
      <h3 className="mb-2 text-sm font-semibold">Replace the file</h3>
      <input key={key} type="file" accept={ASSET_TYPES[assetType].mimes.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" aria-label="New file" />
      <input className={`${textInputClass()} mt-2`} placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{err}</p>}
      <div className="mt-2">
        <Button size="xs" disabled={!file || busy} onClick={upload}>
          {busy ? "Uploading…" : "Upload as new version"}
        </Button>
      </div>
    </div>
  );
}
