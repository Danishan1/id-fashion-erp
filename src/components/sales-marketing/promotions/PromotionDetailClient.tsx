"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { APPLY_MODES, REDEMPTION_STATUSES, type ApplyMode } from "@/modules/sales-marketing/promotions/promotion-registry";
import { TextDialog, type TextDialogSpec } from "../pricing/pricing-ui";
import { Badge, CARD, DisplayStatusBadge, FormButtons, FormField, TermsEditor, TermsView, VersionStatusBadge, inr, send, termsPayload, toDraft, useApi, type PromotionOptions, type StoredTerms, type TermsDraft } from "./promotion-ui";

interface Version {
  id: string;
  number: number;
  status: string;
  terms: StoredTerms;
  createdBy: string;
  createdAt: string;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  canApproveThis: boolean;
}

export interface PromotionDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  objective: string | null;
  owner: { id: string; fullName: string };
  applyMode: string;
  status: string;
  version: number;
  displayStatus: string;
  approvedVersionId: string | null;
  versions: Version[];
  labels: Record<string, string>;
  usage: { reserved: number; redeemed: number; discountRedeemed: number };
  redemptions: {
    id: string;
    status: string;
    quotationId: string;
    quotationNumber: string;
    customer: string;
    versionNumber: number | null;
    discount: number;
    expiresOn: string | null;
    reservedAt: string;
    salesOrderId: string | null;
    salesOrderNumber: string | null;
    releaseReason: string | null;
  }[];
  events: { id: string; type: string; versionNumber: number | null; comment: string | null; at: string; by: string }[];
  can: { edit: boolean; newVersion: boolean; reject: boolean; approve: boolean; activate: boolean; pause: boolean; archive: boolean };
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  HEADER_UPDATED: "Details changed",
  VERSION_SAVED: "Draft saved",
  VERSION_CREATED: "New version started",
  SUBMITTED: "Submitted for approval",
  RETURNED_TO_DRAFT: "Returned to draft",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ACTIVATE: "Switched on",
  PAUSE: "Paused",
  ARCHIVE: "Archived",
};

type Dialog = TextDialogSpec & { url: string };

export function PromotionDetailClient({ initial }: { initial: PromotionDetail }) {
  const [p, setP] = useState(initial);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [editingVersion, setEditingVersion] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(initial.versions[0]?.id ?? null);
  const base = `/api/v1/sales-marketing/promotions/${p.id}`;

  async function run(url: string, method: "POST" | "PATCH", body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      setP(await send<PromotionDetail>(url, method, body));
      setDialog(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const ask = (spec: Dialog) => {
    setError(null);
    setDialog(spec);
  };

  return (
    <div className="space-y-4">
      <section className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <DisplayStatusBadge status={p.displayStatus} />
              <Badge>{APPLY_MODES[p.applyMode as ApplyMode]?.label ?? p.applyMode}</Badge>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{APPLY_MODES[p.applyMode as ApplyMode]?.help}</p>
            {p.objective && <p className="text-sm">Objective: {p.objective}</p>}
            {p.description && <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{p.description}</p>}
            <p className="text-xs text-zinc-500">Owner: {p.owner.fullName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.can.edit && (
              <Button size="sm" variant="secondary" onClick={() => setEditingHeader(true)}>
                Edit details
              </Button>
            )}
            {p.can.activate && (
              <Button size="sm" onClick={() => ask({ action: "activate", url: `${base}/activate`, title: "Switch on", help: "New prices will use the approved version whenever it is valid on the quotation date.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Switch on" })}>
                Switch on
              </Button>
            )}
            {p.can.pause && (
              <Button size="sm" variant="secondary" onClick={() => ask({ action: "pause", url: `${base}/pause`, title: "Pause", help: "New prices stop using it. Issued quotations keep their prices and reservations.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Pause" })}>
                Pause
              </Button>
            )}
            {p.can.archive && (
              <Button size="sm" variant="danger" onClick={() => ask({ action: "archive", url: `${base}/archive`, title: "Archive", help: "Retires the promotion for good. History and used prices are kept.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Archive", danger: true })}>
                Archive
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Reserved (open quotations)", String(p.usage.reserved)],
            ["Used (Sales Orders)", String(p.usage.redeemed)],
            ["Discount given on orders", inr(p.usage.discountRedeemed)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <div className="text-xs text-zinc-500">{k}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        {!p.approvedVersionId && <p className="text-sm text-amber-700 dark:text-amber-300">No version is approved yet — this promotion can&apos;t price anything.</p>}
        {p.approvedVersionId && p.status === "DRAFT" && <p className="text-sm text-amber-700 dark:text-amber-300">A version is approved, but the promotion isn&apos;t switched on yet.</p>}
      </section>

      <section className={`${CARD} space-y-3`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Versions</h2>
          {p.can.newVersion && (
            <Button size="sm" variant="secondary" isLoading={busy} onClick={() => run(`${base}/versions`, "POST")}>
              New version
            </Button>
          )}
        </div>
        <p className="text-xs text-zinc-500">An approved version never changes. To change the terms, start a new version; it replaces the approved one only when it is approved.</p>
        {p.versions.map((v) => (
          <div key={v.id} className="rounded-md border border-zinc-200 dark:border-zinc-800">
            <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left">
              <span className="flex items-center gap-2 font-medium">
                Version {v.number} <VersionStatusBadge status={v.status} />
              </span>
              <span className="text-xs text-zinc-500">
                {v.createdBy} · {formatDate(v.createdAt)}
                {v.decidedBy ? ` · decided by ${v.decidedBy} ${formatDate(v.decidedAt!)}` : ""}
              </span>
            </button>
            {open === v.id && (
              <div className="space-y-3 border-t border-zinc-200 p-3 dark:border-zinc-800">
                {editingVersion === v.id ? (
                  <VersionEditor
                    version={v}
                    busy={busy}
                    error={error}
                    onCancel={() => setEditingVersion(null)}
                    onSave={async (t) => {
                      if (await run(`${base}/versions/${v.id}`, "PATCH", termsPayload(t))) setEditingVersion(null);
                    }}
                  />
                ) : (
                  <TermsView terms={v.terms} labels={p.labels} />
                )}
                {v.decisionComment && (
                  <p className="text-sm">
                    <span className="text-zinc-500">Decision note:</span> {v.decisionComment}
                  </p>
                )}
                {editingVersion !== v.id && (
                  <div className="flex flex-wrap gap-2">
                    {v.status === "DRAFT" && p.can.edit && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setEditingVersion(v.id)}>
                          Edit terms
                        </Button>
                        <Button size="sm" onClick={() => ask({ action: "submit", url: `${base}/versions/${v.id}/submit`, title: `Submit version ${v.number}`, help: "Someone else with approval rights will decide on it.", field: { name: "comment", label: "Note for the approver", required: false }, submitLabel: "Submit" })}>
                          Submit for approval
                        </Button>
                      </>
                    )}
                    {v.status === "PENDING_APPROVAL" && (
                      <>
                        {v.canApproveThis && (
                          <Button size="sm" onClick={() => ask({ action: "approve", url: `${base}/versions/${v.id}/approve`, title: `Approve version ${v.number}`, help: p.approvedVersionId ? "It replaces the approved version for new prices. Issued quotations keep theirs." : "Approving doesn't switch the promotion on.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" })}>
                            Approve
                          </Button>
                        )}
                        {p.can.reject && (
                          <Button size="sm" variant="danger" onClick={() => ask({ action: "reject", url: `${base}/versions/${v.id}/reject`, title: `Reject version ${v.number}`, field: { name: "reason", label: "Reason", required: true }, submitLabel: "Reject", danger: true })}>
                            Reject
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => ask({ action: "return", url: `${base}/versions/${v.id}/return-to-draft`, title: "Return to draft", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Return to draft" })}>
                          Return to draft
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className={`${CARD} space-y-2`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Uses</h2>
        {p.redemptions.length === 0 ? (
          <p className="text-sm text-zinc-500">Not used on any issued quotation yet. Previewing prices never counts as a use.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-1.5 pr-3 font-medium">Quotation</th>
                  <th className="py-1.5 pr-3 font-medium">Customer</th>
                  <th className="py-1.5 pr-3 font-medium">Version</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Discount</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {p.redemptions.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="py-1.5 pr-3">
                      <Link href={`/sales-marketing/quotations/${r.quotationId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {r.quotationNumber}
                      </Link>
                      {r.salesOrderId && (
                        <div className="text-xs">
                          →{" "}
                          <Link href={`/sales-orders/${r.salesOrderId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                            {r.salesOrderNumber}
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{r.customer}</td>
                    <td className="py-1.5 pr-3">{r.versionNumber ? `v${r.versionNumber}` : "—"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{inr(r.discount)}</td>
                    <td className="py-1.5 pr-3">
                      <span title={REDEMPTION_STATUSES[r.status as keyof typeof REDEMPTION_STATUSES]?.help}>
                        <Badge tone={r.status === "REDEEMED" ? "green" : r.status === "RESERVED" ? "amber" : "zinc"}>{REDEMPTION_STATUSES[r.status as keyof typeof REDEMPTION_STATUSES]?.label ?? r.status}</Badge>
                      </span>
                      {r.status === "RESERVED" && r.expiresOn && <div className="text-xs text-zinc-500">until {formatDate(r.expiresOn)}</div>}
                      {r.releaseReason && <div className="text-xs text-zinc-500">{r.releaseReason}</div>}
                    </td>
                    <td className="py-1.5 text-xs text-zinc-500">{formatDateTime(r.reservedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${CARD} space-y-2`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">History</h2>
        <ul className="space-y-2 text-sm">
          {p.events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
              {e.versionNumber ? <span className="text-zinc-500"> · v{e.versionNumber}</span> : null}
              {e.comment && <span className="text-zinc-600 dark:text-zinc-300"> — {e.comment}</span>}
              <div className="text-xs text-zinc-500">
                {e.by} · {formatDateTime(e.at)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && !dialog && editingVersion === null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {dialog && <TextDialog spec={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSubmit={(body) => run(dialog.url, "POST", body)} />}
      {editingHeader && <HeaderDialog p={p} onClose={() => setEditingHeader(false)} onSaved={(d) => (setP(d), setEditingHeader(false))} />}
    </div>
  );
}

function VersionEditor({ version, busy, error, onCancel, onSave }: { version: Version; busy: boolean; error: string | null; onCancel: () => void; onSave: (t: TermsDraft) => void }) {
  const { data: options, error: loadError, reload } = useApi<PromotionOptions>("/api/v1/sales-marketing/promotions/options");
  const [terms, setTerms] = useState<TermsDraft>({ ...toDraft(version.terms), changeNote: version.terms.changeNote ?? "" });
  if (loadError) return <ErrorState message={loadError} onRetry={reload} />;
  if (!options) return <LoadingState />;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(terms);
      }}
    >
      <TermsEditor value={terms} onChange={setTerms} options={options} showChangeNote={version.number > 1} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="Save draft" />
    </form>
  );
}

function HeaderDialog({ p, onClose, onSaved }: { p: PromotionDetail; onClose: () => void; onSaved: (d: PromotionDetail) => void }) {
  const { data: options } = useApi<PromotionOptions>("/api/v1/sales-marketing/promotions/options");
  const [form, setForm] = useState({ name: p.name, description: p.description ?? "", objective: p.objective ?? "", ownerUserId: p.owner.id });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = textInputClass();
  return (
    <Modal open onClose={onClose} title="Edit promotion details">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onSaved(await send<PromotionDetail>(`/api/v1/sales-marketing/promotions/${p.id}`, "PATCH", { ...form, version: p.version }));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label="Name" htmlFor="h-name" required>
          <input id="h-name" required maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        </FormField>
        <FormField label="Objective" htmlFor="h-obj">
          <input id="h-obj" maxLength={300} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} className={input} />
        </FormField>
        <FormField label="Description" htmlFor="h-desc">
          <textarea id="h-desc" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
        </FormField>
        <FormField label="Owner" htmlFor="h-owner">
          <select id="h-owner" value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })} className={input}>
            {(options?.users ?? [{ id: p.owner.id, label: p.owner.fullName }]).map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </FormField>
        <p className="text-xs text-zinc-500">The code and how it applies can&apos;t change — they identify the promotion on issued quotations.</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <FormButtons busy={busy} onCancel={onClose} submitLabel="Save" />
      </form>
    </Modal>
  );
}
