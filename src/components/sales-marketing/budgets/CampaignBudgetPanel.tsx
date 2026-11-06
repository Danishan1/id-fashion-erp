"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { Badge, CARD, FormButtons, FormField, inr, send, useApi } from "../promotions/promotion-ui";
import { ALERT_LABELS, SPEND_KIND_LABELS, UsedBar, type SpendKindKey } from "./budget-ui";

interface Figures {
  limit: number | null;
  actual: number;
  committed: number;
  pipeline: number;
  remaining: number | null;
  usedPercent: number | null;
}
interface Allocation extends Figures {
  id: string;
  name: string;
  category: string;
  categoryId: string | null;
  campaignChannelId: string | null;
  notes: string | null;
  status: string;
  version: number;
}
interface SpendRow {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: string;
  allocationId: string | null;
  allocation: string | null;
  description?: string;
  supplier?: string;
  invoiced?: number;
  inherited?: boolean;
}
export interface CampaignBudget {
  campaignId: string;
  approved: number | null;
  plannedNotApproved: number | null;
  canEdit: boolean;
  canLink: boolean;
  totals: Figures & { allocated: number; unallocatedLimit: number | null };
  allocations: Allocation[];
  expenses: SpendRow[] | null;
  purchaseOrders: SpendRow[] | null;
  purchaseInvoices: SpendRow[] | null;
  categories: { id: string; name: string }[];
  channels: { id: string; name: string }[];
  alerts: { id: string; kind: string; scope: string; status: string; message: string; raisedAt: string; clearedAt: string | null }[];
}

const NOT_ALLOCATED = "-";
const statusText = (s: string) => s.toLowerCase().replace(/_/g, " ");
const HREF: Record<SpendKindKey, (id: string) => string> = {
  EXPENSE: (id) => `/accounts/expenses/${id}`,
  PURCHASE_ORDER: (id) => `/purchase-orders/${id}`,
  PURCHASE_INVOICE: (id) => `/accounts/purchase-invoices/${id}`,
};

/** Campaign → Budget (Phase 12): budget lines under the approved budget, linked Finance spend, alerts. */
export function CampaignBudgetPanel({ campaignId }: { campaignId: string }) {
  const url = `/api/v1/sales-marketing/campaigns/${campaignId}/budget`;
  const { data, error, reload, setData } = useApi<CampaignBudget>(url);
  const [lineDialog, setLineDialog] = useState<Allocation | "new" | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlink, setUnlink] = useState<{ kind: SpendKindKey; row: SpendRow } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  if (error) return <div className={`${CARD} mt-4`}><ErrorState message={error} onRetry={reload} /></div>;
  if (!data) return <div className={`${CARD} mt-4`}><LoadingState /></div>;
  const lines = data.allocations.filter((a) => a.id !== NOT_ALLOCATED);
  const activeLines = lines.filter((a) => a.status === "ACTIVE");

  async function move(kind: SpendKindKey, row: SpendRow, allocationId: string) {
    setRowError(null);
    try {
      setData(await send<CampaignBudget>(`${url}/spend`, "POST", { kind, recordId: row.id, allocationId: allocationId || null }));
    } catch (e) {
      setRowError((e as Error).message);
    }
  }

  const t = data.totals;
  return (
    <section id="budget" className={`${CARD} mt-4 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Budget</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Spend comes from Finance records linked here — nothing is copied. All amounts before GST.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.canEdit && data.approved !== null && (
            <Button size="sm" variant="secondary" onClick={() => setLineDialog("new")}>
              Add budget line
            </Button>
          )}
          {data.canEdit && activeLines.length > 0 && lines.length > 1 && (
            <Button size="sm" variant="secondary" onClick={() => setTransfer(true)}>
              Move budget
            </Button>
          )}
          {data.canLink && (
            <Button size="sm" onClick={() => setLinking(true)}>
              Link spend
            </Button>
          )}
        </div>
      </div>

      {data.approved === null && (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {data.plannedNotApproved !== null ? `A budget of ${inr(data.plannedNotApproved)} is planned but not approved yet.` : "No budget is planned."} Budget lines need an approved budget; spend can still be linked once the campaign is approved.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Approved", t.limit === null ? "—" : inr(t.limit)],
          ["In budget lines", inr(t.allocated)],
          ["Actual", inr(t.actual)],
          ["Committed", inr(t.committed)],
          ["Pending (not counted)", inr(t.pipeline)],
          ["Remaining", t.remaining === null ? "—" : inr(t.remaining)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-zinc-50 p-2.5 dark:bg-zinc-800/50">
            <div className="text-xs text-zinc-500">{k}</div>
            <div className={`font-semibold tabular-nums ${k === "Remaining" && (t.remaining ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{v}</div>
          </div>
        ))}
      </div>
      <UsedBar percent={t.usedPercent} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="py-1.5 pr-3 font-medium">Budget line</th>
              <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
              <th className="py-1.5 pr-3 text-right font-medium">Actual</th>
              <th className="py-1.5 pr-3 text-right font-medium">Committed</th>
              <th className="py-1.5 pr-3 text-right font-medium">Remaining</th>
              <th className="py-1.5 pr-3 font-medium">Used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.allocations.map((a) => (
              <tr key={a.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1.5 pr-3">
                  <span className={a.id === NOT_ALLOCATED ? "italic text-zinc-500" : "font-medium"}>{a.name}</span>
                  {a.status === "CLOSED" && <Badge>Closed</Badge>}
                  {a.id !== NOT_ALLOCATED && (
                    <div className="text-xs text-zinc-500">
                      {a.category}
                      {a.campaignChannelId ? ` · ${data.channels.find((c) => c.id === a.campaignChannelId)?.name ?? "channel"}` : ""}
                    </div>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{a.limit === null ? "—" : inr(a.limit)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{inr(a.actual)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{inr(a.committed)}</td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${(a.remaining ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{a.remaining === null ? "—" : inr(a.remaining)}</td>
                <td className="py-1.5 pr-3">
                  <UsedBar percent={a.usedPercent} />
                </td>
                <td className="py-1.5 text-right">
                  {data.canEdit && a.id !== NOT_ALLOCATED && (
                    <button type="button" onClick={() => setLineDialog(a)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rowError && <p className="text-sm text-red-600 dark:text-red-400">{rowError}</p>}
      {(["EXPENSE", "PURCHASE_ORDER", "PURCHASE_INVOICE"] as SpendKindKey[]).map((kind) => {
        const rows = kind === "EXPENSE" ? data.expenses : kind === "PURCHASE_ORDER" ? data.purchaseOrders : data.purchaseInvoices;
        if (rows === null) return <p key={kind} className="text-xs text-zinc-500">{SPEND_KIND_LABELS[kind]}s: you can&apos;t see these records; their amounts are in the totals.</p>;
        if (!rows.length) return null;
        return (
          <div key={kind} className="space-y-1">
            <h3 className="text-sm font-semibold">{SPEND_KIND_LABELS[kind]}s</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="py-1.5 pr-3">
                        <Link href={HREF[kind](r.id)} className="text-indigo-600 hover:underline dark:text-indigo-400">
                          {r.number}
                        </Link>
                        <div className="text-xs text-zinc-500">
                          {formatDate(r.date)} · {r.supplier ?? r.description}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {inr(r.amount)}
                        {kind === "PURCHASE_ORDER" && (r.invoiced ?? 0) > 0 && <div className="text-xs text-zinc-500">{inr(r.invoiced)} invoiced</div>}
                      </td>
                      <td className="py-1.5 pr-3">{statusText(r.status)}</td>
                      <td className="py-1.5 pr-3">
                        {r.inherited ? (
                          <span className="text-xs text-zinc-500">{r.allocation ?? "Not allocated"} (from its order)</span>
                        ) : data.canLink ? (
                          <select aria-label={`Budget line for ${r.number}`} value={r.allocationId ?? ""} onChange={(e) => move(kind, r, e.target.value)} className={`${textInputClass()} !w-auto !py-1 text-xs`}>
                            <option value="">Not allocated</option>
                            {lines.filter((l) => l.status === "ACTIVE" || l.id === r.allocationId).map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs">{r.allocation ?? "Not allocated"}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {data.canEdit && !r.inherited && (
                          <button type="button" onClick={() => setUnlink({ kind, row: r })} className="text-xs font-medium text-red-600 hover:underline">
                            Unlink
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {data.alerts.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Alerts</h3>
          <ul className="space-y-1 text-sm">
            {data.alerts.map((a) => (
              <li key={a.id} className={a.status === "OPEN" ? "" : "text-zinc-500"}>
                <Badge tone={a.status !== "OPEN" ? "zinc" : a.kind === "WARN_THRESHOLD" ? "amber" : "red"}>{ALERT_LABELS[a.kind] ?? a.kind}</Badge> {a.message}
                <span className="text-xs text-zinc-500">
                  {" "}
                  · {formatDateTime(a.raisedAt)}
                  {a.clearedAt ? ` · cleared ${formatDateTime(a.clearedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lineDialog && <LineDialog url={url} data={data} line={lineDialog === "new" ? null : lineDialog} onClose={() => setLineDialog(null)} onSaved={(d) => (setData(d), setLineDialog(null))} />}
      {transfer && <TransferDialog url={url} lines={lines} onClose={() => setTransfer(false)} onSaved={(d) => (setData(d), setTransfer(false))} />}
      {linking && <LinkDialog url={url} lines={activeLines} onClose={() => setLinking(false)} onSaved={(d) => (setData(d), setLinking(false))} />}
      {unlink && <UnlinkDialog url={url} kind={unlink.kind} row={unlink.row} onClose={() => setUnlink(null)} onSaved={(d) => (setData(d), setUnlink(null))} />}
    </section>
  );
}

function useSubmit(onSaved: (d: CampaignBudget) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await send<CampaignBudget>(url, method, body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, submit };
}

function LineDialog({ url, data, line, onClose, onSaved }: { url: string; data: CampaignBudget; line: Allocation | null; onClose: () => void; onSaved: (d: CampaignBudget) => void }) {
  const [f, setF] = useState({ name: line?.name ?? "", categoryId: line?.categoryId ?? data.categories[0]?.id ?? "", campaignChannelId: line?.campaignChannelId ?? "", amount: line?.limit?.toString() ?? "", notes: line?.notes ?? "" });
  const { busy, error, submit } = useSubmit(onSaved);
  const input = textInputClass();
  const free = data.totals.unallocatedLimit ?? 0;
  return (
    <Modal open onClose={onClose} title={line ? `Budget line: ${line.name}` : "New budget line"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (line) submit(`${url}/allocations/${line.id}`, "PATCH", { ...f, version: line.version });
          else submit(`${url}/allocations`, "POST", f);
        }}
      >
        <FormField label="Name" htmlFor="l-name" required>
          <input id="l-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
        </FormField>
        <FormField label="Spend category" htmlFor="l-cat" required hint="The list is kept in Campaign settings.">
          <select id="l-cat" required value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className={input}>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        {data.channels.length > 0 && (
          <FormField label="Delivery channel (optional)" htmlFor="l-ch">
            <select id="l-ch" value={f.campaignChannelId} onChange={(e) => setF({ ...f, campaignChannelId: e.target.value })} className={input}>
              <option value="">— None —</option>
              {data.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
        <FormField label="Amount (₹, before GST)" htmlFor="l-amt" required hint={line ? undefined : `Not yet in a line: ${inr(free)}.`}>
          <input id="l-amt" type="number" required min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={input} />
        </FormField>
        <FormField label="Notes" htmlFor="l-notes">
          <textarea id="l-notes" rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={input} />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {line && (
              <Button type="button" size="sm" variant="secondary" isLoading={busy} onClick={() => submit(`${url}/allocations/${line.id}`, "PATCH", { status: line.status === "ACTIVE" ? "CLOSED" : "ACTIVE", version: line.version })}>
                {line.status === "ACTIVE" ? "Close line" : "Reopen line"}
              </Button>
            )}
            {line && line.actual + line.committed + line.pipeline === 0 && (
              <Button type="button" size="sm" variant="danger" isLoading={busy} onClick={() => submit(`${url}/allocations/${line.id}`, "DELETE")}>
                Remove
              </Button>
            )}
          </div>
          <FormButtons busy={busy} onCancel={onClose} submitLabel="Save" />
        </div>
      </form>
    </Modal>
  );
}

function TransferDialog({ url, lines, onClose, onSaved }: { url: string; lines: Allocation[]; onClose: () => void; onSaved: (d: CampaignBudget) => void }) {
  const [f, setF] = useState({ fromId: lines[0]?.id ?? "", toId: lines.find((l) => l.status === "ACTIVE" && l.id !== lines[0]?.id)?.id ?? "", amount: "", reason: "" });
  const { busy, error, submit } = useSubmit(onSaved);
  const input = textInputClass();
  const from = lines.find((l) => l.id === f.fromId);
  return (
    <Modal open onClose={onClose} title="Move budget between lines">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(`${url}/transfer`, "POST", f);
        }}
      >
        <FormField label="From" htmlFor="t-from" required hint={from ? `Free on this line: ${inr(Math.max(0, from.remaining ?? 0))}` : undefined}>
          <select id="t-from" value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })} className={input}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="To" htmlFor="t-to" required>
          <select id="t-to" value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })} className={input}>
            <option value="">—</option>
            {lines.filter((l) => l.status === "ACTIVE" && l.id !== f.fromId).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Amount (₹)" htmlFor="t-amt" required>
          <input id="t-amt" type="number" required min={0.01} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={input} />
        </FormField>
        <FormField label="Reason" htmlFor="t-reason" required>
          <input id="t-reason" required minLength={3} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={input} />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <FormButtons busy={busy} onCancel={onClose} submitLabel="Move" />
      </form>
    </Modal>
  );
}

function LinkDialog({ url, lines, onClose, onSaved }: { url: string; lines: Allocation[]; onClose: () => void; onSaved: (d: CampaignBudget) => void }) {
  const [kind, setKind] = useState<SpendKindKey>("EXPENSE");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [recordId, setRecordId] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const { data: options, error: loadError } = useApi<{ id: string; label: string; sublabel: string }[]>(`${url}/spend?kind=${kind}${q ? `&search=${encodeURIComponent(q)}` : ""}`);
  const { busy, error, submit } = useSubmit(onSaved);
  const input = textInputClass();
  return (
    <Modal open onClose={onClose} title="Link spend to this campaign">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(`${url}/spend`, "POST", { kind, recordId, allocationId: allocationId || null });
        }}
      >
        <FormField label="Kind of record" htmlFor="k-kind" required>
          <select
            id="k-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as SpendKindKey);
              setRecordId("");
            }}
            className={input}
          >
            {Object.entries(SPEND_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </FormField>
        <div className="flex gap-2">
          <input aria-label="Search records" placeholder="Number, description or supplier…" value={search} onChange={(e) => setSearch(e.target.value)} className={input} />
          <Button type="button" size="sm" variant="secondary" onClick={() => setQ(search.trim())}>
            Search
          </Button>
        </div>
        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : (
          <FormField label="Record" htmlFor="k-rec" required>
            <SearchableSelect id="k-rec" required value={recordId} onChange={setRecordId} options={options ?? []} placeholder={options ? "Pick one…" : "Loading…"} emptyOptionLabel={null} />
          </FormField>
        )}
        <FormField label="Budget line" htmlFor="k-line">
          <select id="k-line" value={allocationId} onChange={(e) => setAllocationId(e.target.value)} className={input}>
            <option value="">Not allocated</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </FormField>
        <p className="text-xs text-zinc-500">An invoice against a purchase order already on this campaign counts through the order — link the order, not the invoice. Rejected and cancelled records aren&apos;t spend.</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <FormButtons busy={busy} onCancel={onClose} submitLabel="Link" />
      </form>
    </Modal>
  );
}

function UnlinkDialog({ url, kind, row, onClose, onSaved }: { url: string; kind: SpendKindKey; row: SpendRow; onClose: () => void; onSaved: (d: CampaignBudget) => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, submit } = useSubmit(onSaved);
  return (
    <Modal open onClose={onClose} title={`Unlink ${row.number}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(`${url}/spend/unlink`, "POST", { kind, recordId: row.id, reason });
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">It will no longer count for this campaign. The record itself isn&apos;t changed otherwise.</p>
        <FormField label="Reason" htmlFor="u-reason" required>
          <input id="u-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <FormButtons busy={busy} onCancel={onClose} submitLabel="Unlink" />
      </form>
    </Modal>
  );
}
