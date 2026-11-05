"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { insertVariable } from "@/modules/crm/templates/template-engine";
import { TEMPLATE_VARIABLES } from "@/modules/crm/templates/template-registry";
import { DELIVERY_TEMPLATE_ENTITIES } from "@/modules/sales-marketing/delivery/delivery-render-entities";
import { MAX_ATTACHMENTS } from "@/modules/sales-marketing/content/content-registry";
import { CARD, ReviewActions, ReviewBadge, fmtBytes, fmtDateTime, send, useApi } from "./content-ui";

interface Attachment {
  assetId: string;
  code: string;
  name: string;
  assetVersionId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  review: string;
}
interface CVersion {
  id: string;
  versionNumber: number;
  subject: string | null;
  body: string;
  providerMetadata: Record<string, string>;
  changeNote: string | null;
  templateVersionNumber: number;
  createdBy: string;
  createdByMe: boolean;
  createdAt: string;
  review: string;
  submittedByMe: boolean;
  decidedBy: string | null;
  decisionComment: string | null;
  attachments: Attachment[];
}
interface Content {
  id: string;
  name: string;
  channelType: string;
  locale: string;
  status: string;
  version: number;
  campaign: { id: string; code: string; name: string; status: string };
  template: { id: string; name: string; status: string };
  currentVersionId: string | null;
  approvedVersionId: string | null;
  providerFields: { key: string; label: string; help: string }[];
  subjectRequired: boolean;
  attachmentsAllowed: boolean;
  currentCheck: { errors: string[]; warnings: string[] } | null;
  versions: CVersion[];
  channels: { id: string; connection: string; isActive: boolean; runs: { id: string; runNumber: number; status: string; contentVersionNumber: number | null }[] }[];
}
interface Attachable {
  assetId: string;
  code: string;
  name: string;
  assetVersionId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}
interface Preview {
  basis: "sample" | "contact";
  versionNumber: number;
  subject: string | null;
  body: string;
  issues: { severity: "error" | "warning"; message: string }[];
  sms: { encoding: string; units: number; segments: number } | null;
  attachments: { name: string; fileName: string; fileSizeBytes: number }[];
  attachmentProblems: string[];
  unsubscribeFooter: boolean;
}

const VARIABLES = TEMPLATE_VARIABLES.filter((v) => DELIVERY_TEMPLATE_ENTITIES.has(v.entity));

/** Campaign content (Phase 11): edit (= new version), attach approved files, preview, review. */
export function ContentEditorClient({ contentId, canEdit, canArchive, canApprove, canReject, canPreviewContact }: { contentId: string; canEdit: boolean; canArchive: boolean; canApprove: boolean; canReject: boolean; canPreviewContact: boolean }) {
  const { data: c, error, reload } = useApi<Content>(`/api/v1/sales-marketing/content/items/${contentId}`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!c) return <LoadingState />;
  const v = c.versions.find((x) => x.id === (selected ?? c.currentVersionId)) ?? c.versions[0];
  const open = c.status === "ACTIVE" && !["COMPLETED", "CANCELLED"].includes(c.campaign.status);
  const done = (text: string) => (setMsg({ ok: true, text }), reload());

  const archive = async () => {
    try {
      await send(`/api/v1/sales-marketing/content/items/${c.id}/archive`, "POST", { archived: c.status === "ACTIVE", version: c.version });
      done(c.status === "ACTIVE" ? "Archived." : "Restored.");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-start justify-between gap-3 text-sm`}>
        <div className="space-y-1">
          <div>
            Campaign{" "}
            <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/campaigns/${c.campaign.id}`}>
              {c.campaign.code} · {c.campaign.name}
            </Link>
          </div>
          <div className="text-zinc-600 dark:text-zinc-400">
            {c.channelType.charAt(0) + c.channelType.slice(1).toLowerCase()} · language {c.locale} · made from template{" "}
            <Link className="underline" href={`/sales-marketing/content/templates/${c.template.id}`}>
              {c.template.name}
            </Link>{" "}
            (the template itself isn&apos;t changed)
          </div>
          <div>
            {c.approvedVersionId ? (
              <>
                Campaign channels send <strong>v{c.versions.find((x) => x.id === c.approvedVersionId)?.versionNumber}</strong> (newest approved).
              </>
            ) : (
              <span className="text-amber-700">Nothing approved yet — channels using this content can&apos;t send.</span>
            )}{" "}
            {c.status === "ARCHIVED" && <span className="text-zinc-500">Archived.</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && open && !editing && <Button size="sm" onClick={() => setEditing(true)}>Edit (new version)</Button>}
          {canArchive && (
            <Button size="sm" variant={c.status === "ACTIVE" ? "danger" : "secondary"} onClick={archive}>
              {c.status === "ACTIVE" ? "Archive" : "Restore"}
            </Button>
          )}
        </div>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}

      {editing && c.currentVersionId && (
        <Editor c={c} base={c.versions.find((x) => x.id === c.currentVersionId)!} onCancel={() => setEditing(false)} onSaved={(n) => (setEditing(false), setSelected(null), done(`Saved as version ${n}. Submit it for review — channels keep sending the approved version until then.`))} />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {v && (
            <div className={CARD}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">Version {v.versionNumber}</span>
                {v.id === c.currentVersionId && <span className="text-xs text-zinc-500">latest</span>}
                {v.id === c.approvedVersionId && <span className="text-xs text-green-700">being sent</span>}
                <ReviewBadge status={v.review} />
              </div>
              <p className="mb-2 text-xs text-zinc-500">
                By {v.createdBy}, {fmtDateTime(v.createdAt)} · based on template v{v.templateVersionNumber}
                {v.changeNote ? ` — ${v.changeNote}` : ""}
              </p>
              {v.subject !== null && (
                <div className="mb-2 text-sm">
                  <span className="text-zinc-500">Subject: </span>
                  {v.subject}
                </div>
              )}
              <pre className="whitespace-pre-wrap rounded bg-zinc-50 p-3 text-sm dark:bg-zinc-950">{v.body}</pre>
              {v.attachments.length > 0 && (
                <ul className="mt-2 text-sm">
                  {v.attachments.map((a) => (
                    <li key={a.assetVersionId} className="flex items-center gap-2">
                      📎{" "}
                      <Link className="text-indigo-600 hover:underline" href={`/sales-marketing/content/assets/${a.assetId}`}>
                        {a.name} v{a.versionNumber}
                      </Link>
                      <span className="text-xs text-zinc-500">{fmtBytes(a.fileSizeBytes)}</span>
                      <ReviewBadge status={a.review} />
                    </li>
                  ))}
                </ul>
              )}
              {v.id === c.currentVersionId && c.currentCheck && (c.currentCheck.errors.length > 0 || c.currentCheck.warnings.length > 0) && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {c.currentCheck.errors.map((e) => (
                    <li key={e} className="text-red-700">
                      {e}
                    </li>
                  ))}
                  {c.currentCheck.warnings.map((e) => (
                    <li key={e} className="text-amber-700">
                      {e}
                    </li>
                  ))}
                </ul>
              )}
              {v.decidedBy && (
                <p className="mt-2 text-sm text-zinc-600">
                  Decided by {v.decidedBy}
                  {v.decisionComment ? `: ${v.decisionComment}` : ""}
                </p>
              )}
              {c.status === "ACTIVE" && (
                <div className="mt-3">
                  <ReviewActions subjectType="CONTENT_VERSION" subjectId={v.id} status={v.review} canEdit={canEdit} canApprove={canApprove} canReject={canReject} isAuthor={v.createdByMe || v.submittedByMe} onDone={done} />
                </div>
              )}
            </div>
          )}
          {v && <PreviewPanel contentId={c.id} versionId={v.id} canPreviewContact={canPreviewContact} />}
        </div>
        <div className="space-y-4">
          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Versions</h3>
            <ul className="space-y-1 text-sm">
              {c.versions.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`flex w-full items-center justify-between rounded px-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 ${x.id === v?.id ? "font-medium" : ""}`} onClick={() => setSelected(x.id)}>
                    <span>v{x.versionNumber}</span>
                    <ReviewBadge status={x.review} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className={CARD}>
            <h3 className="mb-2 text-sm font-semibold">Sent by</h3>
            {c.channels.length === 0 ? (
              <p className="text-sm text-zinc-500">No campaign channel uses this content yet. Add one in the campaign&apos;s Channels &amp; delivery panel.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.channels.map((ch) => (
                  <li key={ch.id}>
                    {ch.connection}
                    {ch.isActive ? "" : " (disabled)"}
                    {ch.runs.length > 0 && (
                      <ul className="ml-3 text-xs text-zinc-600">
                        {ch.runs.map((r) => (
                          <li key={r.id}>
                            <Link className="underline" href={`/sales-marketing/delivery/runs/${r.id}`}>
                              Run #{r.runNumber}
                            </Link>{" "}
                            {r.status.toLowerCase()} · sent v{r.contentVersionNumber ?? "?"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Editor({ c, base, onCancel, onSaved }: { c: Content; base: CVersion; onCancel: () => void; onSaved: (n: number) => void }) {
  const [subject, setSubject] = useState(base.subject ?? "");
  const [body, setBody] = useState(base.body);
  const [meta, setMeta] = useState<Record<string, string>>(base.providerMetadata);
  const [locale, setLocale] = useState(c.locale);
  const [note, setNote] = useState("");
  const [att, setAtt] = useState<string[]>(base.attachments.map((a) => a.assetVersionId));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data: attachables } = useApi<Attachable[]>(c.attachmentsAllowed ? "/api/v1/sales-marketing/content/attachables" : null);
  const known = new Map<string, { label: string; size: number }>([...base.attachments.map((a) => [a.assetVersionId, { label: `${a.name} v${a.versionNumber}`, size: a.fileSizeBytes }] as const), ...(attachables ?? []).map((a) => [a.assetVersionId, { label: `${a.name} v${a.versionNumber}`, size: a.fileSizeBytes }] as const)]);
  const insert = (key: string) => {
    const el = bodyRef.current;
    const r = insertVariable(body, key, el?.selectionStart ?? body.length, el?.selectionEnd ?? body.length);
    setBody(r.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await send<{ versionNumber: number }>(`/api/v1/sales-marketing/content/items/${c.id}/versions`, "POST", { subject: c.subjectRequired ? subject : null, body, providerMetadata: meta, assetVersionIds: att, locale, changeNote: note || null, version: c.version });
      onSaved(r.versionNumber);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${CARD} space-y-3`}>
      <h3 className="text-sm font-semibold">New version (from v{base.versionNumber})</h3>
      {c.subjectRequired && (
        <FormField label="Subject" htmlFor="c-subject" required>
          <input id="c-subject" className={textInputClass()} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={250} />
        </FormField>
      )}
      <FormField label="Message (plain text)" htmlFor="c-body" required>
        <textarea id="c-body" ref={bodyRef} rows={10} className={`${textInputClass()} font-mono text-sm`} value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="mt-1 text-xs text-zinc-500">
          Variables: {"{{contact.first_name|there}}"} — the text after | is used when the value is missing. A variable without a fallback skips recipients who don&apos;t have that value.{c.channelType === "EMAIL" ? " An unsubscribe footer is always added to emails." : ""}
        </p>
      </FormField>
      <div className="flex flex-wrap gap-1">
        {VARIABLES.map((x) => (
          <button key={x.key} type="button" className="rounded border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => insert(x.key)} title={`Sample: ${x.sample}`}>
            {x.entity}.{x.label.toLowerCase()}
          </button>
        ))}
      </div>
      {c.providerFields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {c.providerFields.map((f) => (
            <FormField key={f.key} label={f.label} htmlFor={`pm-${f.key}`}>
              <input id={`pm-${f.key}`} className={textInputClass()} value={meta[f.key] ?? ""} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} />
              <p className="mt-1 text-xs text-zinc-500">{f.help}</p>
            </FormField>
          ))}
        </div>
      )}
      {c.attachmentsAllowed && (
        <div>
          <div className="mb-1 text-sm font-medium">Attachments (approved library files, up to {MAX_ATTACHMENTS}, 10 MB total)</div>
          <ul className="mb-2 space-y-1 text-sm">
            {att.map((id) => (
              <li key={id} className="flex items-center gap-2">
                📎 {known.get(id)?.label ?? id}
                <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setAtt(att.filter((x) => x !== id))}>
                  remove
                </button>
              </li>
            ))}
          </ul>
          <select
            className={`${textInputClass()} !w-auto`}
            value=""
            disabled={att.length >= MAX_ATTACHMENTS}
            onChange={(e) => e.target.value && setAtt([...att, e.target.value])}
            aria-label="Add attachment"
          >
            <option value="">{attachables ? (attachables.length ? "Add a file…" : "No approved files in the library") : "Loading…"}</option>
            {(attachables ?? [])
              .filter((a) => !att.includes(a.assetVersionId))
              .map((a) => (
                <option key={a.assetVersionId} value={a.assetVersionId}>
                  {a.name} v{a.versionNumber} ({fmtBytes(a.fileSizeBytes)})
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Attachments are pinned to the exact file version; a newer version of the asset needs a new content version.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Language" htmlFor="c-locale">
          <input id="c-locale" className={textInputClass()} value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en, hi-IN" />
        </FormField>
        <FormField label="What changed?" htmlFor="c-note">
          <input id="c-note" className={textInputClass()} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </FormField>
      </div>
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button disabled={busy || !body.trim()} onClick={save}>
          {busy ? "Saving…" : "Save as new version"}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PreviewPanel({ contentId, versionId, canPreviewContact }: { contentId: string; versionId: string; canPreviewContact: boolean }) {
  const [contactId, setContactId] = useState("");
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (withContact: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      setP(await send<Preview>(`/api/v1/sales-marketing/content/items/${contentId}/preview`, "POST", { versionId, ...(withContact && contactId ? { contactId } : {}) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={CARD}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        <Button size="xs" variant="secondary" disabled={busy} onClick={() => run(false)}>
          With sample data
        </Button>
        {canPreviewContact && (
          <>
            <input className={`${textInputClass()} !w-72`} placeholder="CRM contact id (one you can see)" value={contactId} onChange={(e) => setContactId(e.target.value.trim())} aria-label="Contact id" />
            <Button size="xs" variant="secondary" disabled={busy || !/^[0-9a-f-]{36}$/i.test(contactId)} onClick={() => run(true)}>
              With this contact
            </Button>
          </>
        )}
      </div>
      <p className="mb-2 text-xs text-zinc-500">Previews never send anything.</p>
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
      {p && (
        <div className="space-y-2 text-sm">
          <div className="text-xs text-zinc-500">
            v{p.versionNumber} with {p.basis === "sample" ? "sample data" : "the contact's data"}
            {p.sms ? ` · ${p.sms.units} characters, ${p.sms.segments} SMS part${p.sms.segments === 1 ? "" : "s"} (${p.sms.encoding})` : ""}
          </div>
          {p.subject && <div className="font-medium">{p.subject}</div>}
          <pre className="whitespace-pre-wrap rounded border border-zinc-200 p-3 dark:border-zinc-800">
            {p.body}
            {p.unsubscribeFooter ? "\n\n--\n[unsubscribe footer with a personal link]" : ""}
          </pre>
          {p.attachments.length > 0 && <div>📎 {p.attachments.map((a) => `${a.fileName} (${fmtBytes(a.fileSizeBytes)})`).join(", ")}</div>}
          {[...p.issues.map((i) => ({ ...i })), ...p.attachmentProblems.map((m) => ({ severity: "error" as const, message: m }))].map((i, n) => (
            <div key={n} className={i.severity === "error" ? "text-red-700" : "text-amber-700"}>
              {i.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
