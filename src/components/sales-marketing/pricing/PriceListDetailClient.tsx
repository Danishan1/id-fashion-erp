"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/date-format";
import { PRICE_LIST_VERSION_STATUSES, VERSION_TIMING_LABELS, type PriceListVersionStatusKey, type VersionTiming } from "@/modules/sales-marketing/pricing/pricing-registry";
import { Badge, CARD, PriceEntriesEditor, PriceEntriesTable, PricingHistory, TextDialog, entryPayload, toEntryDrafts, useLookups, type EntryDraft, type TextDialogSpec } from "./pricing-ui";

type Person = { id?: string; fullName: string } | null;
interface Version {
  id: string;
  versionNumber: number;
  status: PriceListVersionStatusKey;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeNote: string | null;
  approvalComment: string | null;
  version: number;
  timing: VersionTiming | null;
  createdBy: Person;
  submittedBy: Person;
  approvedBy: Person;
  approvedAt: string | null;
  _count: { entries: number };
}
interface Entry {
  id: string;
  productId: string;
  uomId: string;
  minQuantity: string;
  unitPrice: string;
  notes: string | null;
  product: { styleName: string; styleCode: string };
  uom: { code: string };
}
export interface PriceListDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: "DEFAULT" | "CUSTOMER";
  customer: { id: string; name: string } | null;
  priority: number;
  isActive: boolean;
  currencyCode: string;
  versions: Version[];
  selected: (Version & { entries: Entry[]; viewerCanApprove: boolean }) | null;
  events: { id: string; type: string; versionNumber: number | null; comment: string | null; createdAt: string; createdBy: { fullName: string } | null }[];
  usedByRules: { id: string; code: string; name: string; status: string }[];
}

const statusTone = (v: Version) => (v.status === "APPROVED" ? (v.timing === "IN_FORCE" ? "green" : v.timing === "SCHEDULED" ? "indigo" : "zinc") : v.status === "PENDING_APPROVAL" ? "amber" : "zinc");
const statusLabel = (v: Version) => (v.status === "APPROVED" && v.timing ? VERSION_TIMING_LABELS[v.timing] : PRICE_LIST_VERSION_STATUSES[v.status]);

export function PriceListDetailClient({ initial, perms }: { initial: PriceListDetail; perms: { edit: boolean; approve: boolean; reject: boolean } }) {
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const [header, setHeader] = useState({ name: d.name, description: d.description ?? "", priority: String(d.priority) });
  const sel = d.selected;
  const draftEditable = Boolean(sel && sel.status === "DRAFT" && perms.edit);
  const [draft, setDraft] = useState({ effectiveFrom: sel?.effectiveFrom ?? "", effectiveTo: sel?.effectiveTo ?? "", changeNote: sel?.changeNote ?? "" });
  const [entries, setEntries] = useState<EntryDraft[]>(() => toEntryDrafts(sel?.entries ?? []));
  const { styles, units } = useLookups(draftEditable ? ["styles", "units"] : []);
  const base = `/api/v1/sales-marketing/pricing/price-lists/${d.id}`;

  const load = (next: PriceListDetail) => {
    setD(next);
    setDraft({ effectiveFrom: next.selected?.effectiveFrom ?? "", effectiveTo: next.selected?.effectiveTo ?? "", changeNote: next.selected?.changeNote ?? "" });
    setEntries(toEntryDrafts(next.selected?.entries ?? []));
    setHeader({ name: next.name, description: next.description ?? "", priority: String(next.priority) });
  };

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", "x-toast": "off" }, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res));
      return null;
    }
    const { data } = await res.json();
    if (data?.deleted) {
      router.push("/sales-marketing/pricing");
      return null;
    }
    load(data);
    setDialog(null);
    return data as PriceListDetail;
  };

  const versionAction = (action: string, body: Record<string, string> = {}) => sel && call(`${base}/versions/${sel.id}/actions/${action}`, "POST", body);
  const saveDraft = () =>
    sel && call(`${base}/versions/${sel.id}`, "PUT", { effectiveFrom: draft.effectiveFrom, effectiveTo: draft.effectiveTo, changeNote: draft.changeNote, entries: entryPayload(entries), version: sel.version });

  const open = (spec: TextDialogSpec) => {
    setError(null);
    if (!spec.field && !spec.help) return versionAction(spec.action);
    setDialog(spec);
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-start justify-between gap-3`}>
        {editHeader ? (
          <form
            className="grid flex-1 gap-3 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(base, "PATCH", header)) setEditHeader(false);
            }}
          >
            <FormField label="Name" htmlFor="h-name" required>
              <input id="h-name" required maxLength={200} value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Priority (higher wins)" htmlFor="h-priority" required>
              <input id="h-priority" type="number" required value={header.priority} onChange={(e) => setHeader({ ...header, priority: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Description" htmlFor="h-desc">
              <input id="h-desc" maxLength={1000} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} className={textInputClass()} />
            </FormField>
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" size="xs" isLoading={busy}>
                Save
              </Button>
              <Button type="button" size="xs" variant="secondary" onClick={() => setEditHeader(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {d.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
              <span>{d.kind === "CUSTOMER" ? <>Customer: <strong>{d.customer?.name}</strong></> : "Default prices (everyone)"}</span>
              <span className="text-zinc-500">· priority {d.priority} · {d.currencyCode}</span>
            </div>
            {d.description && <p className="text-zinc-600 dark:text-zinc-300">{d.description}</p>}
          </div>
        )}
        {perms.edit && !editHeader && (
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="secondary" onClick={() => setEditHeader(true)}>
              Edit details
            </Button>
            {!d.versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL") && (
              <Button size="xs" disabled={busy} onClick={() => call(`${base}/versions`, "POST").then((r) => r && router.replace(`/sales-marketing/pricing/${d.id}?version=${r.selected?.versionNumber}`))}>
                New version
              </Button>
            )}
            <Button size="xs" variant={d.isActive ? "danger" : "secondary"} disabled={busy} onClick={() => call(`${base}/actions/${d.isActive ? "deactivate" : "reactivate"}`, "POST")}>
              {d.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>
      {error && !dialog && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {sel && (
            <section className={`${CARD} space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Version {sel.versionNumber}</h2>
                  <Badge tone={statusTone(sel)}>{statusLabel(sel)}</Badge>
                  {!draftEditable && (
                    <span className="text-xs text-zinc-500">
                      from {formatDate(sel.effectiveFrom)}
                      {sel.effectiveTo ? ` to ${formatDate(sel.effectiveTo)}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {sel.status === "DRAFT" && perms.edit && (
                    <>
                      <Button size="xs" variant="secondary" disabled={busy} onClick={saveDraft}>
                        Save draft
                      </Button>
                      <Button size="xs" disabled={busy} onClick={() => open({ action: "submit", title: `Submit ${d.code} v${sel.versionNumber} for approval`, help: "Save first if you changed anything. Someone else approves it; the prices apply from the start date.", field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Submit" })}>
                        Submit for approval
                      </Button>
                      <Button size="xs" variant="danger" disabled={busy} onClick={() => open({ action: "discard", title: "Discard this draft", help: d.versions.length === 1 ? "This list has no other version, so the whole price list is deleted." : "The draft and its prices are deleted.", submitLabel: "Discard", danger: true })}>
                        Discard
                      </Button>
                    </>
                  )}
                  {sel.status === "PENDING_APPROVAL" && sel.viewerCanApprove && perms.approve && (
                    <Button size="xs" disabled={busy} onClick={() => open({ action: "approve", title: `Approve ${d.code} v${sel.versionNumber}`, help: `Prices apply from ${formatDate(sel.effectiveFrom)}.`, field: { name: "comment", label: "Comment (optional)", required: false }, submitLabel: "Approve" })}>
                      Approve
                    </Button>
                  )}
                  {sel.status === "PENDING_APPROVAL" && sel.viewerCanApprove && perms.reject && (
                    <Button size="xs" variant="secondary" disabled={busy} onClick={() => open({ action: "decline", title: "Send back to draft", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Decline", danger: true })}>
                      Decline
                    </Button>
                  )}
                  {sel.status === "PENDING_APPROVAL" && perms.edit && (
                    <Button size="xs" variant="secondary" disabled={busy} onClick={() => open({ action: "return-to-draft", title: "Return to draft", help: "The approval request is withdrawn so the draft can be changed.", submitLabel: "Return to draft" })}>
                      Return to draft
                    </Button>
                  )}
                  {sel.status === "APPROVED" && sel.timing === "SCHEDULED" && perms.edit && (
                    <Button size="xs" variant="danger" disabled={busy} onClick={() => open({ action: "withdraw", title: `Withdraw v${sel.versionNumber}`, help: "It hasn't started yet; the current prices stay in force.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Withdraw", danger: true })}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </div>
              {sel.status === "DRAFT" && sel.approvalComment && <p className="text-xs text-red-700 dark:text-red-400">Sent back by the approver: {sel.approvalComment}</p>}
              {sel.status === "PENDING_APPROVAL" && !sel.viewerCanApprove && <p className="text-xs text-amber-700 dark:text-amber-400">Waiting for approval by someone with pricing approval rights who didn&apos;t prepare it.</p>}

              {draftEditable ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField label="Prices apply from" htmlFor="v-from" required>
                      <input id="v-from" type="date" required value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={textInputClass()} />
                    </FormField>
                    <FormField label="Until (optional)" htmlFor="v-to">
                      <input id="v-to" type="date" min={draft.effectiveFrom} value={draft.effectiveTo} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} className={textInputClass()} />
                    </FormField>
                    <FormField label="Note" htmlFor="v-note">
                      <input id="v-note" maxLength={1000} value={draft.changeNote} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} className={textInputClass()} />
                    </FormField>
                  </div>
                  <PriceEntriesEditor entries={entries} onChange={setEntries} styles={styles} units={units} />
                </>
              ) : (
                <>
                  {sel.changeNote && <p className="text-sm text-zinc-600 dark:text-zinc-300">{sel.changeNote}</p>}
                  <PriceEntriesTable entries={sel.entries} />
                </>
              )}
              <p className="text-xs text-zinc-500">
                Prepared by {sel.createdBy?.fullName ?? "—"}
                {sel.submittedBy ? ` · submitted by ${sel.submittedBy.fullName}` : ""}
                {sel.approvedBy ? ` · approved by ${sel.approvedBy.fullName}${sel.approvedAt ? ` on ${formatDate(sel.approvedAt)}` : ""}` : ""}
              </p>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className={`${CARD} space-y-2`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Versions</h2>
            <ul className="space-y-1.5 text-sm">
              {d.versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <Link href={`/sales-marketing/pricing/${d.id}?version=${v.versionNumber}`} className={`hover:underline ${sel?.id === v.id ? "font-semibold" : ""}`}>
                    v{v.versionNumber} · {formatDate(v.effectiveFrom)} · {v._count.entries} price{v._count.entries === 1 ? "" : "s"}
                  </Link>
                  <Badge tone={statusTone(v)}>{statusLabel(v)}</Badge>
                </li>
              ))}
            </ul>
          </section>
          {d.usedByRules.length > 0 && (
            <section className={`${CARD} space-y-2`}>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Discount rules for this list</h2>
              <ul className="space-y-1 text-sm">
                {d.usedByRules.map((r) => (
                  <li key={r.id}>
                    <Link href={`/sales-marketing/pricing/discounts/${r.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {r.code}
                    </Link>{" "}
                    {r.name} <span className="text-xs text-zinc-500">({r.status.toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className={`${CARD} space-y-2`}>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">History</h2>
            <PricingHistory events={d.events} />
          </section>
        </div>
      </div>
      {dialog && <TextDialog key={dialog.action} spec={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSubmit={(body) => versionAction(dialog.action, body)} />}
    </div>
  );
}
