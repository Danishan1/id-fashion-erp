"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityPanel } from "@/components/crm/activities/ActivityPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatDateTime } from "@/lib/date-format";
import { CAMPAIGN_EVENT_LABELS, METRIC_UNITS, PRIORITY_LABELS, REVISION_STATUS_LABELS, SYSTEM_METRICS, SYSTEM_METRIC_KEYS, type CampaignPriorityKey, type MetricUnitKey, type RevisionStatusKey } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { usePerformanceOptions } from "../performance/performance-ui";
import { Badge, CARD, StatusBadge, TextDialog, dateRange, inr, send, type TextDialogSpec } from "./campaign-ui";

type Named = { id: string; name: string } | null;
interface Metric {
  id: string;
  source: "SYSTEM" | "MANUAL";
  systemKey: string | null;
  label: string;
  unit: MetricUnitKey;
  target: number | null;
  actual: number | null;
  documents: number | null;
  percentOfTarget: number | null;
  provenance: string;
  notes: string | null;
}
interface Revision {
  id: string;
  revisionNumber: number;
  status: RevisionStatusKey;
  plannedStartDate: string;
  plannedEndDate: string;
  plannedBudget: number | null;
  budgetNotes: string | null;
  reason: string | null;
  autoApproved: boolean;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}
interface LinkRow {
  id: string;
  number: string;
  name: string;
  date: string;
  status: string;
  value?: number;
}
export interface CampaignView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  statusHelp: string;
  statusReason: string | null;
  type: Named;
  objective: Named;
  owner: { id: string; fullName: string };
  department: Named;
  salesChannel: { id: string; name: string; code: string } | null;
  parent: { id: string; code: string; name: string } | null;
  children: { id: string; code: string; name: string; status: string }[];
  priority: CampaignPriorityKey;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  plannedBudget: number | null;
  budgetNotes: string | null;
  currencyCode: string;
  approvedRevisionNumber: number | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revisions: Revision[];
  metrics: Metric[];
  budget: {
    planned: number | null;
    actual: number;
    pending: number;
    remaining: number | null;
    expenses: { id: string; number: string; date: string; description: string; supplier: string | null; amount: number; tax: number; status: string; counts: boolean }[];
  };
  links: { leads: LinkRow[] | null; enquiries: LinkRow[] | null; quotations: LinkRow[] | null; orders: LinkRow[] | null };
  progress: { total: number; done: number; overdue: number; milestones: number; milestonesDone: number };
  milestones: { id: string; subject: string; status: string; dueDate: string | null; overdue: boolean; completedAt: string | null; assignee: string | null }[];
  history: { id: string; type: string; comment: string | null; metadata: unknown; at: string; by: string }[];
  warnings: string[];
  can: Record<
    | "edit"
    | "editPlan"
    | "requestPlanChange"
    | "submit"
    | "returnToDraft"
    | "approve"
    | "sendBack"
    | "activate"
    | "pause"
    | "resume"
    | "complete"
    | "cancel"
    | "delete"
    | "metrics"
    | "linkExpenses"
    | "activities"
    | "createActivities"
    | "editActivities",
    boolean
  >;
}

const SPECS: Record<string, TextDialogSpec> = {
  submit: { action: "submit", title: "Submit for approval", help: "Someone other than you approves the plan (dates, budget). It can be activated once approved.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Submit" },
  "return-to-draft": { action: "return-to-draft", title: "Return to draft", help: "Withdraws it from approval so it can be edited.", submitLabel: "Return to draft" },
  approve: { action: "approve", title: "Approve", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" },
  "send-back": { action: "send-back", title: "Send back", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Send back", danger: true },
  pause: { action: "pause", title: "Pause campaign", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Pause" },
  resume: { action: "resume", title: "Resume campaign", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Resume" },
  cancel: { action: "cancel", title: "Cancel campaign", help: "It stays in reports with everything linked to it. This can't be undone.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Cancel campaign", danger: true },
};

const fmtMetric = (unit: MetricUnitKey, v: number | null) => (v === null ? "—" : unit === "CURRENCY" ? inr(v) : unit === "PERCENT" ? `${v.toLocaleString("en-IN")}%` : v.toLocaleString("en-IN"));
const ERR = ({ e }: { e: string | null }) => (e ? <p className="text-sm text-red-600 dark:text-red-400">{e}</p> : null);

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={CARD} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function eventText(e: CampaignView["history"][number]) {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (m.revision) parts.push(`plan v${m.revision}`);
  if (m.from || m.to) parts.push(`${m.from ?? "—"} → ${m.to ?? "—"}`);
  if (m.label) parts.push(String(m.label));
  if (m.expense) parts.push(String(m.expense));
  if (m.actualStartDate) parts.push(`from ${m.actualStartDate}`);
  if (m.actualEndDate) parts.push(`ended ${m.actualEndDate}`);
  if (m.after !== undefined && typeof m.after !== "object") parts.push(`→ ${m.after ?? "—"}`);
  const b = m.before as Record<string, unknown> | undefined;
  const a = m.after as Record<string, unknown> | undefined;
  if (b && a && typeof a === "object") parts.push(`${b.plannedStartDate} → ${b.plannedEndDate}, ${b.plannedBudget === null ? "no budget" : inr(Number(b.plannedBudget))}  ⇒  ${a.plannedStartDate} → ${a.plannedEndDate}, ${a.plannedBudget === null ? "no budget" : inr(Number(a.plannedBudget))}`);
  return parts.join(" · ");
}

/** Campaign detail (Phase 08): lifecycle, plan & approvals, success metrics, budget, milestones & activities, linked records, history. */
export function CampaignDetailClient({ initial, currentUserId }: { initial: CampaignView; currentUserId: string }) {
  const router = useRouter();
  const [c, setC] = useState(initial);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const [dateDialog, setDateDialog] = useState<"activate" | "complete" | null>(null);
  const [planDialog, setPlanDialog] = useState(false);
  const [revDialog, setRevDialog] = useState<{ spec: TextDialogSpec; id: string } | null>(null);
  const [metricDialog, setMetricDialog] = useState<"add" | Metric | null>(null);
  const [resultDialog, setResultDialog] = useState<Metric | null>(null);
  const [expenseDialog, setExpenseDialog] = useState(false);
  const [unlinkDialog, setUnlinkDialog] = useState<string | null>(null);
  const [milestoneDialog, setMilestoneDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/sales-marketing/campaigns/${c.id}`;

  const run = async (fn: () => Promise<unknown>, close?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next && typeof next === "object" && "deleted" in next) return router.push("/sales-marketing/campaigns");
      if (next && typeof next === "object" && "code" in next) setC(next as CampaignView);
      close?.();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const reload = () => run(async () => (await fetch(base, { headers: { "x-toast": "off" } }).then((r) => r.json())).data);
  const act = (key: string) => (setError(null), setDialog(SPECS[key]));
  const pending = c.revisions.find((r) => r.status === "PENDING_APPROVAL");
  const later = pending && c.status !== "PENDING_APPROVAL";

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <p>
              <StatusBadge status={c.status} /> <span className="text-zinc-600 dark:text-zinc-300">{c.statusHelp}</span>
            </p>
            {c.statusReason && <p className="mt-1 text-zinc-600 dark:text-zinc-300">Reason: {c.statusReason}</p>}
            {later && <p className="mt-1 text-amber-700 dark:text-amber-300">A plan change (v{pending.revisionNumber}) waits for approval — see Plan &amp; approvals.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.can.edit && (
              <Link href={`/sales-marketing/campaigns/${c.id}/edit`} className={buttonClasses("secondary", "xs")}>
                Edit
              </Link>
            )}
            {c.can.submit && <Button size="xs" onClick={() => act("submit")}>Submit for approval</Button>}
            {c.status === "PENDING_APPROVAL" && c.can.approve && (
              <Button size="xs" variant="success" onClick={() => act("approve")}>
                Approve
              </Button>
            )}
            {c.status === "PENDING_APPROVAL" && c.can.sendBack && (
              <Button size="xs" variant="secondary" onClick={() => act("send-back")}>
                Send back
              </Button>
            )}
            {c.can.returnToDraft && (
              <Button size="xs" variant="secondary" onClick={() => act("return-to-draft")}>
                Return to draft
              </Button>
            )}
            {c.can.activate && <Button size="xs" onClick={() => (setError(null), setDateDialog("activate"))}>Activate</Button>}
            {c.can.pause && (
              <Button size="xs" variant="secondary" onClick={() => act("pause")}>
                Pause
              </Button>
            )}
            {c.can.resume && <Button size="xs" onClick={() => act("resume")}>Resume</Button>}
            {c.can.complete && <Button size="xs" onClick={() => (setError(null), setDateDialog("complete"))}>Complete</Button>}
            {c.can.cancel && (
              <Button size="xs" variant="secondary" onClick={() => act("cancel")}>
                Cancel campaign
              </Button>
            )}
            {c.can.delete && (
              <Button size="xs" variant="secondary" isLoading={busy} onClick={() => run(() => send(base, "DELETE"))}>
                Delete draft
              </Button>
            )}
          </div>
        </div>
        {c.status === "PENDING_APPROVAL" && !c.can.approve && <p className="mt-2 text-xs text-zinc-500">Waiting for someone with approval rights other than whoever prepared or submitted it.</p>}
        {c.warnings.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-sm text-amber-700 dark:text-amber-300">
            {c.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {error && !dialog && !dateDialog && !planDialog && !revDialog && !metricDialog && !resultDialog && !expenseDialog && !unlinkDialog && !milestoneDialog && <ERR e={error} />}
      </section>

      <Section title="Details">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {[
            ["Type", c.type?.name],
            ["Primary objective", c.objective?.name],
            ["Owner", c.owner.fullName],
            ["Department", c.department?.name ?? "—"],
            ["Sales channel", c.salesChannel ? `${c.salesChannel.name} (${c.salesChannel.code})` : "—"],
            ["Priority", PRIORITY_LABELS[c.priority]],
            ["Planned", dateRange(c.plannedStartDate, c.plannedEndDate)],
            ["Actual", c.actualStartDate ? dateRange(c.actualStartDate, c.actualEndDate ?? "running") : "Not started"],
            ["Currency", c.currencyCode],
          ].map(([k, val]) => (
            <div key={k}>
              <dt className="text-xs text-zinc-500">{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        {c.parent && (
          <p className="mt-2">
            Part of{" "}
            <Link href={`/sales-marketing/campaigns/${c.parent.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {c.parent.code} {c.parent.name}
            </Link>
          </p>
        )}
        {c.children.length > 0 && (
          <p className="mt-2">
            Sub-campaigns:{" "}
            {c.children.map((ch, i) => (
              <span key={ch.id}>
                {i > 0 && ", "}
                <Link href={`/sales-marketing/campaigns/${ch.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {ch.code}
                </Link>
              </span>
            ))}
          </p>
        )}
        {c.description && <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{c.description}</p>}
        <p className="mt-2 text-xs text-zinc-500">
          Created by {c.createdBy} {formatDateTime(c.createdAt)} · last changed by {c.updatedBy} {formatDateTime(c.updatedAt)}
        </p>
      </Section>

      <Section
        title="Plan & approvals"
        actions={c.can.requestPlanChange && <Button size="xs" variant="secondary" onClick={() => (setError(null), setPlanDialog(true))}>Request plan change</Button>}
      >
        <p>
          Planned budget <strong>{c.plannedBudget === null ? "not set" : inr(c.plannedBudget)}</strong>
          {c.budgetNotes ? ` — ${c.budgetNotes}` : ""}
          {c.approvedRevisionNumber ? <span className="text-zinc-500"> · approved plan v{c.approvedRevisionNumber}</span> : <span className="text-zinc-500"> · not approved yet</span>}
        </p>
        {c.revisions.length === 0 ? (
          <p className="mt-2 text-zinc-500">No approval requests yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-1 pr-3">Plan</th>
                <th className="py-1 pr-3">Dates</th>
                <th className="py-1 pr-3 text-right">Budget</th>
                <th className="py-1 pr-3">Asked</th>
                <th className="py-1 pr-3">Decision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c.revisions.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3 whitespace-nowrap">v{r.revisionNumber}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{dateRange(r.plannedStartDate, r.plannedEndDate)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.plannedBudget === null ? "—" : inr(r.plannedBudget)}</td>
                  <td className="py-2 pr-3">
                    {r.requestedBy}, {formatDateTime(r.requestedAt)}
                    {r.reason && <span className="block text-xs text-zinc-500">{r.reason}</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={r.status === "APPROVED" ? "green" : r.status === "PENDING_APPROVAL" ? "amber" : r.status === "REJECTED" ? "red" : "zinc"}>{r.autoApproved ? "Approved automatically" : REVISION_STATUS_LABELS[r.status]}</Badge>
                    {r.decidedBy && (
                      <span className="block text-xs text-zinc-500">
                        {r.decidedBy}
                        {r.decidedAt ? `, ${formatDateTime(r.decidedAt)}` : ""}
                        {r.decisionComment ? ` — “${r.decisionComment}”` : ""}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {r.status === "PENDING_APPROVAL" && later && (
                      <>
                        {c.can.approve && (
                          <Button size="xs" variant="success" onClick={() => setRevDialog({ id: r.id, spec: { ...SPECS.approve, title: `Approve plan change v${r.revisionNumber}` } })}>
                            Approve
                          </Button>
                        )}{" "}
                        {c.can.sendBack && (
                          <Button size="xs" variant="secondary" onClick={() => setRevDialog({ id: r.id, spec: SPECS["send-back"] })}>
                            Send back
                          </Button>
                        )}{" "}
                        {c.can.edit && (
                          <Button size="xs" variant="secondary" onClick={() => setRevDialog({ id: r.id, spec: { action: "withdraw", title: "Withdraw plan change", submitLabel: "Withdraw" } })}>
                            Withdraw
                          </Button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Success metrics" actions={c.can.metrics && <Button size="xs" variant="secondary" onClick={() => (setError(null), setMetricDialog("add"))}>Add metric</Button>}>
        {c.metrics.length === 0 ? (
          <p className="text-zinc-500">No success metrics yet. Measured metrics count the leads, enquiries, quotations and orders that carry this campaign; others are entered by hand and marked as manual.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-1 pr-3">Metric</th>
                <th className="py-1 pr-3 text-right">Target</th>
                <th className="py-1 pr-3 text-right">Actual</th>
                <th className="py-1 pr-3 text-right">% of target</th>
                <th className="py-1 pr-3">Source</th>
                {c.can.metrics && <th />}
              </tr>
            </thead>
            <tbody>
              {c.metrics.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    {m.label}
                    {m.notes && <span className="block text-xs text-zinc-500">{m.notes}</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMetric(m.unit, m.target)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtMetric(m.unit, m.actual)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{m.percentOfTarget === null ? "—" : `${m.percentOfTarget}%`}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={m.source === "SYSTEM" ? "indigo" : "amber"}>{m.source === "SYSTEM" ? "Measured" : "Manual"}</Badge>
                    <span className="block text-xs text-zinc-500">{m.provenance}</span>
                  </td>
                  {c.can.metrics && (
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="secondary" onClick={() => (setError(null), setMetricDialog(m))}>
                        Target
                      </Button>{" "}
                      {m.source === "MANUAL" && (
                        <Button size="xs" variant="secondary" onClick={() => (setError(null), setResultDialog(m))}>
                          Result
                        </Button>
                      )}{" "}
                      <Button size="xs" variant="secondary" isLoading={busy} onClick={() => run(() => send(`${base}/metrics/${m.id}`, "DELETE"))}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-zinc-500">Counts of records linked to this campaign, up to today — not campaign attribution or ROI.</p>
      </Section>

      <Section title="Budget" actions={c.can.linkExpenses && <Button size="xs" variant="secondary" onClick={() => (setError(null), setExpenseDialog(true))}>Link expense</Button>}>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Planned (approved plan)", c.budget.planned === null ? "—" : inr(c.budget.planned)],
            ["Actual spend", inr(c.budget.actual)],
            ["Waiting for approval", inr(c.budget.pending)],
            ["Remaining", c.budget.remaining === null ? "—" : inr(c.budget.remaining)],
          ].map(([k, val]) => (
            <div key={k}>
              <div className="text-xs text-zinc-500">{k}</div>
              <div className={`text-lg font-semibold tabular-nums ${k === "Remaining" && (c.budget.remaining ?? 0) < 0 ? "text-red-600 dark:text-red-400" : ""}`}>{val}</div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">Actual = approved, partly paid and paid Expenses linked here, before GST. Rejected and cancelled expenses don&apos;t count.</p>
        {c.budget.expenses.length > 0 && (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-1 pr-3">Expense</th>
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3 text-right">Amount</th>
                <th className="py-1 pr-3">Status</th>
                {c.can.linkExpenses && <th />}
              </tr>
            </thead>
            <tbody>
              {c.budget.expenses.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <Link href={`/accounts/expenses/${e.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {e.number}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{e.date}</td>
                  <td className="py-2 pr-3">
                    {e.description}
                    {e.supplier && <span className="block text-xs text-zinc-500">{e.supplier}</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{inr(e.amount)}</td>
                  <td className="py-2 pr-3">
                    {e.status.toLowerCase().replace(/_/g, " ")}
                    {!e.counts && <span className="block text-xs text-zinc-500">not counted yet</span>}
                  </td>
                  {c.can.linkExpenses && (
                    <td className="py-2 text-right">
                      <Button size="xs" variant="secondary" onClick={() => (setError(null), setUnlinkDialog(e.id))}>
                        Unlink
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={`Milestones & activities (${c.progress.done}/${c.progress.total} done${c.progress.overdue ? `, ${c.progress.overdue} overdue` : ""})`}
        actions={c.can.activities && c.can.createActivities && c.can.edit && <Button size="xs" variant="secondary" onClick={() => (setError(null), setMilestoneDialog(true))}>Add milestone</Button>}
      >
        {!c.can.activities ? (
          <p className="text-zinc-500">Campaign activities are CRM tasks — you need CRM access to see them.</p>
        ) : (
          <>
            {c.milestones.length > 0 && (
              <ul className="mb-3 space-y-1">
                {c.milestones.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.status === "COMPLETED" ? "green" : m.overdue ? "red" : "zinc"}>{m.status === "COMPLETED" ? "Done" : m.overdue ? "Overdue" : m.status.toLowerCase().replace(/_/g, " ")}</Badge>
                    <Link href={`/crm/activities/${m.id}`} className="font-medium hover:underline">
                      ◆ {m.subject}
                    </Link>
                    <span className="text-xs text-zinc-500">
                      due {m.dueDate ?? "—"}
                      {m.assignee ? ` · ${m.assignee}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <ActivityPanel parent={{ entityType: "CAMPAIGN", entityId: c.id, label: `${c.code} ${c.name}` }} canCreate={c.can.createActivities} canEdit={c.can.editActivities} currentUserId={currentUserId} onChanged={reload} pageSize={10} />
            <p className="mt-2 text-xs text-zinc-500">These are CRM tasks on this campaign: they also appear in CRM → My Tasks and the CRM calendar, with reminders.</p>
          </>
        )}
      </Section>

      <Section title="Linked records">
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["Leads", c.links.leads, "/crm/leads"],
              ["Sales enquiries", c.links.enquiries, "/sales-marketing/enquiries"],
              ["Quotations", c.links.quotations, "/sales-marketing/quotations"],
              ["Sales orders", c.links.orders, "/sales-orders"],
            ] as const
          ).map(([label, rows, href]) => (
            <div key={label}>
              <h3 className="text-xs font-semibold uppercase text-zinc-500">{label}</h3>
              {rows === null ? (
                <p className="text-xs text-zinc-400">No access.</p>
              ) : rows.length === 0 ? (
                <p className="text-xs text-zinc-400">None yet.</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`${href}/${r.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {r.number}
                      </Link>{" "}
                      {r.name} <span className="text-xs text-zinc-500">· {r.date} · {r.status.toLowerCase().replace(/_/g, " ")}{r.value !== undefined ? ` · ${inr(r.value)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Set the campaign on a lead, enquiry, quotation or order from that record&apos;s page. Quotations made from an enquiry, and orders from a quotation, take its campaign.</p>
      </Section>

      <Section title="History">
        {c.history.length === 0 ? (
          <p className="text-zinc-500">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {c.history.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{CAMPAIGN_EVENT_LABELS[e.type] ?? e.type}</span>
                {eventText(e) && <span className="text-zinc-600 dark:text-zinc-300"> · {eventText(e)}</span>}
                {e.comment && <span className="text-zinc-600 dark:text-zinc-300"> — {e.comment}</span>}
                <div className="text-xs text-zinc-500">
                  {e.by} · {formatDateTime(e.at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dialog && <TextDialog spec={dialog} busy={busy} error={error} onClose={() => (setDialog(null), setError(null))} onSubmit={(body) => run(() => send(`${base}/${dialog.action}`, "POST", body), () => setDialog(null))} />}
      {revDialog && (
        <TextDialog spec={revDialog.spec} busy={busy} error={error} onClose={() => (setRevDialog(null), setError(null))} onSubmit={(body) => run(() => send(`${base}/plan-changes/${revDialog.id}/${revDialog.spec.action}`, "POST", body), () => setRevDialog(null))} />
      )}
      {dateDialog && <DateDialog kind={dateDialog} c={c} busy={busy} error={error} onClose={() => (setDateDialog(null), setError(null))} onSubmit={(body) => run(() => send(`${base}/${dateDialog}`, "POST", body), () => setDateDialog(null))} />}
      {planDialog && <PlanDialog c={c} busy={busy} error={error} onClose={() => (setPlanDialog(false), setError(null))} onSubmit={(body) => run(() => send(`${base}/plan-changes`, "POST", body), () => setPlanDialog(false))} />}
      {metricDialog && (
        <MetricDialog
          metric={metricDialog === "add" ? null : metricDialog}
          used={c.metrics.map((m) => m.systemKey).filter((k): k is string => Boolean(k))}
          busy={busy}
          error={error}
          onClose={() => (setMetricDialog(null), setError(null))}
          onSubmit={(body) => run(() => (metricDialog === "add" ? send(`${base}/metrics`, "POST", body) : send(`${base}/metrics/${metricDialog.id}`, "PATCH", body)), () => setMetricDialog(null))}
        />
      )}
      {resultDialog && <ResultDialog m={resultDialog} busy={busy} error={error} onClose={() => (setResultDialog(null), setError(null))} onSubmit={(body) => run(() => send(`${base}/metrics/${resultDialog.id}/result`, "POST", body), () => setResultDialog(null))} />}
      {expenseDialog && <ExpenseDialog base={base} busy={busy} error={error} onClose={() => (setExpenseDialog(false), setError(null))} onSubmit={(expenseId) => run(() => send(`${base}/expenses`, "POST", { expenseId }), () => setExpenseDialog(false))} />}
      {unlinkDialog && (
        <TextDialog
          spec={{ action: "unlink", title: "Unlink expense", help: "The expense stays in Accounts; it just stops counting for this campaign.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Unlink", danger: true }}
          busy={busy}
          error={error}
          onClose={() => (setUnlinkDialog(null), setError(null))}
          onSubmit={(body) => run(() => send(`${base}/expenses/${unlinkDialog}/unlink`, "POST", body), () => setUnlinkDialog(null))}
        />
      )}
      {milestoneDialog && <MilestoneDialog c={c} busy={busy} error={error} onClose={() => (setMilestoneDialog(false), setError(null))} onSubmit={(body) => run(async () => (await send(`${base}/milestones`, "POST", body), (await fetch(base, { headers: { "x-toast": "off" } }).then((r) => r.json())).data), () => setMilestoneDialog(false))} />}
    </div>
  );
}

type DialogProps<T> = { busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: T) => void };

function Footer({ busy, onClose, label, error }: { busy: boolean; onClose: () => void; label: string; error: string | null }) {
  return (
    <>
      <ERR e={error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button type="submit" isLoading={busy}>
          {label}
        </Button>
      </div>
    </>
  );
}

function DateDialog({ kind, c, busy, error, onClose, onSubmit }: { kind: "activate" | "complete"; c: CampaignView } & DialogProps<Record<string, string>>) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [comment, setComment] = useState("");
  return (
    <Modal open onClose={onClose} title={kind === "activate" ? "Activate campaign" : "Complete campaign"}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), onSubmit({ [kind === "activate" ? "actualStartDate" : "actualEndDate"]: date, comment }))}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{kind === "activate" ? `Planned start ${c.plannedStartDate}. Activating only records that it is running — nothing is sent or published.` : `Planned end ${c.plannedEndDate}. Started ${c.actualStartDate}.`}</p>
        <FormField label={kind === "activate" ? "Actual start" : "Actual end"} htmlFor="d-date" required>
          <input id="d-date" type="date" required max={today} min={kind === "complete" ? (c.actualStartDate ?? undefined) : undefined} value={date} onChange={(e) => setDate(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Comment" htmlFor="d-comment">
          <textarea id="d-comment" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} className={textInputClass()} />
        </FormField>
        <Footer busy={busy} onClose={onClose} error={error} label={kind === "activate" ? "Activate" : "Complete"} />
      </form>
    </Modal>
  );
}

function PlanDialog({ c, busy, error, onClose, onSubmit }: { c: CampaignView } & DialogProps<Record<string, string>>) {
  const [v, setV] = useState({ plannedStartDate: c.plannedStartDate, plannedEndDate: c.plannedEndDate, plannedBudget: c.plannedBudget === null ? "" : String(c.plannedBudget), budgetNotes: c.budgetNotes ?? "", reason: "" });
  return (
    <Modal open onClose={onClose} title="Request plan change">
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), onSubmit(v))}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">The campaign keeps its approved dates and budget until someone else approves the change.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Planned start" htmlFor="p-start" required>
            <input id="p-start" type="date" required value={v.plannedStartDate} onChange={(e) => setV({ ...v, plannedStartDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Planned end" htmlFor="p-end" required>
            <input id="p-end" type="date" required min={v.plannedStartDate} value={v.plannedEndDate} onChange={(e) => setV({ ...v, plannedEndDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Planned budget (₹)" htmlFor="p-budget">
            <input id="p-budget" type="number" min={0} step="0.01" value={v.plannedBudget} onChange={(e) => setV({ ...v, plannedBudget: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Budget notes" htmlFor="p-notes">
            <input id="p-notes" maxLength={2000} value={v.budgetNotes} onChange={(e) => setV({ ...v, budgetNotes: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <FormField label="Why" htmlFor="p-reason" required>
          <textarea id="p-reason" rows={2} required minLength={3} maxLength={1000} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} className={textInputClass()} />
        </FormField>
        <Footer busy={busy} onClose={onClose} error={error} label="Request change" />
      </form>
    </Modal>
  );
}

function MetricDialog({ metric, used, busy, error, onClose, onSubmit }: { metric: Metric | null; used: string[] } & DialogProps<Record<string, string>>) {
  const free = SYSTEM_METRIC_KEYS.filter((k) => !used.includes(k));
  const [v, setV] = useState<{ source: "SYSTEM" | "MANUAL"; systemKey: string; label: string; unit: MetricUnitKey; targetValue: string; notes: string }>({ source: metric?.source ?? (free.length ? "SYSTEM" : "MANUAL"), systemKey: free[0] ?? "", label: metric?.label ?? "", unit: metric?.unit ?? "COUNT", targetValue: metric?.target === null || metric?.target === undefined ? "" : String(metric.target), notes: metric?.notes ?? "" });
  return (
    <Modal open onClose={onClose} title={metric ? `Target for ${metric.label}` : "Add success metric"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (metric) onSubmit({ targetValue: v.targetValue, notes: v.notes, ...(metric.source === "MANUAL" ? { label: v.label } : {}) });
          else onSubmit(v.source === "SYSTEM" ? { source: "SYSTEM", systemKey: v.systemKey, targetValue: v.targetValue, notes: v.notes } : { source: "MANUAL", label: v.label, unit: v.unit, targetValue: v.targetValue, notes: v.notes });
        }}
      >
        {!metric && (
          <fieldset className="space-y-1 text-sm">
            <label className={`flex items-center gap-2 ${free.length ? "" : "text-zinc-400"}`}>
              <input type="radio" name="m-src" disabled={!free.length} checked={v.source === "SYSTEM"} onChange={() => setV({ ...v, source: "SYSTEM" })} /> Measured from ERP records
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="m-src" checked={v.source === "MANUAL"} onChange={() => setV({ ...v, source: "MANUAL" })} /> Entered by hand (e.g. visitors, responses)
            </label>
          </fieldset>
        )}
        {!metric && v.source === "SYSTEM" && (
          <FormField label="What to measure" htmlFor="m-key" required>
            <select id="m-key" value={v.systemKey} onChange={(e) => setV({ ...v, systemKey: e.target.value })} className={textInputClass()}>
              {free.map((k) => (
                <option key={k} value={k}>
                  {SYSTEM_METRICS[k].label}
                </option>
              ))}
            </select>
            {v.systemKey && <span className="mt-1 block text-xs text-zinc-500">{SYSTEM_METRICS[v.systemKey as keyof typeof SYSTEM_METRICS]?.source}</span>}
          </FormField>
        )}
        {(v.source === "MANUAL" && !metric) || metric?.source === "MANUAL" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name" htmlFor="m-label" required>
              <input id="m-label" required maxLength={120} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} className={textInputClass()} />
            </FormField>
            {!metric && (
              <FormField label="Unit" htmlFor="m-unit">
                <select id="m-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as MetricUnitKey })} className={textInputClass()}>
                  {(Object.keys(METRIC_UNITS) as MetricUnitKey[]).map((u) => (
                    <option key={u} value={u}>
                      {METRIC_UNITS[u]}
                    </option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
        ) : null}
        <FormField label="Target (optional)" htmlFor="m-target">
          <input id="m-target" type="number" min={0} step="0.01" value={v.targetValue} onChange={(e) => setV({ ...v, targetValue: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Notes" htmlFor="m-notes">
          <input id="m-notes" maxLength={1000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} className={textInputClass()} />
        </FormField>
        <Footer busy={busy} onClose={onClose} error={error} label={metric ? "Save" : "Add"} />
      </form>
    </Modal>
  );
}

function ResultDialog({ m, busy, error, onClose, onSubmit }: { m: Metric } & DialogProps<Record<string, string>>) {
  const [v, setV] = useState({ actual: m.actual === null ? "" : String(m.actual), asOf: new Date().toISOString().slice(0, 10) });
  return (
    <Modal open onClose={onClose} title={`Result for ${m.label}`}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), onSubmit(v))}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Shown as manually entered, with your name and the date. Every change is kept in the history.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={`Actual (${METRIC_UNITS[m.unit]})`} htmlFor="r-actual" required>
            <input id="r-actual" type="number" min={0} step="0.01" required value={v.actual} onChange={(e) => setV({ ...v, actual: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="As of" htmlFor="r-asof" required>
            <input id="r-asof" type="date" required max={new Date().toISOString().slice(0, 10)} value={v.asOf} onChange={(e) => setV({ ...v, asOf: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <Footer busy={busy} onClose={onClose} error={error} label="Save result" />
      </form>
    </Modal>
  );
}

function ExpenseDialog({ base, busy, error, onClose, onSubmit }: { base: string } & DialogProps<string>) {
  const [options, setOptions] = useState<{ id: string; label: string; sublabel?: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${base}/expenses`, { headers: { "x-toast": "off" } })
      .then(async (r) => (r.ok ? setOptions((await r.json()).data) : setLoadError("You need access to Expenses to link them.")))
      .catch(() => setLoadError("Couldn't load expenses."));
  }, [base]);
  return (
    <Modal open onClose={onClose} title="Link an expense">
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), pick && onSubmit(pick))}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Choose an existing expense (recorded in Accounts → Expenses) that was spent on this campaign. Only expenses not linked to a campaign are listed.</p>
        {loadError ? (
          <ERR e={loadError} />
        ) : (
          <FormField label="Expense" htmlFor="x-pick" required>
            <SearchableSelect id="x-pick" required value={pick} onChange={setPick} options={options ?? []} placeholder={options ? "Search expenses…" : "Loading…"} />
          </FormField>
        )}
        <Footer busy={busy} onClose={onClose} error={error} label="Link" />
      </form>
    </Modal>
  );
}

function MilestoneDialog({ c, busy, error, onClose, onSubmit }: { c: CampaignView } & DialogProps<Record<string, string>>) {
  const { reps } = usePerformanceOptions();
  const [v, setV] = useState({ subject: "", dueDate: c.plannedStartDate, assignedToUserId: c.owner.id, description: "" });
  return (
    <Modal open onClose={onClose} title="Add milestone">
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), onSubmit(v))}>
        <FormField label="Milestone" htmlFor="ms-subject" required>
          <input id="ms-subject" required maxLength={200} placeholder="e.g. Catalogue approved" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} className={textInputClass()} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Due" htmlFor="ms-due" required>
            <input id="ms-due" type="date" required value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Responsible" htmlFor="ms-who">
            <SearchableSelect id="ms-who" value={v.assignedToUserId} onChange={(assignedToUserId) => setV({ ...v, assignedToUserId })} options={reps.length ? reps : [{ id: c.owner.id, label: c.owner.fullName }]} placeholder="Search people…" />
          </FormField>
        </div>
        <FormField label="Details" htmlFor="ms-desc">
          <textarea id="ms-desc" rows={2} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={textInputClass()} />
        </FormField>
        <p className="text-xs text-zinc-500">Saved as a high-priority CRM task on this campaign, assigned to the responsible person (who needs CRM access).</p>
        <Footer busy={busy} onClose={onClose} error={error} label="Add milestone" />
      </form>
    </Modal>
  );
}
