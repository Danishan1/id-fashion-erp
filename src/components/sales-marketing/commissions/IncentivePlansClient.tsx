"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatDateTime } from "@/lib/date-format";
import { incentiveTierProblems } from "@/modules/sales-marketing/commissions/commission-engine";
import { SALES_TARGET_METRICS } from "@/modules/sales-marketing/performance/performance-registry";
import { selectClass, usePerformanceOptions } from "../performance/performance-ui";
import { Badge, CARD, TextDialog, VERSION_STATUS, inr, send, useApi, type TextDialogSpec } from "./commission-ui";

const PERIOD_LABELS = { MONTH: "Monthly", QUARTER: "Quarterly", YEAR: "Yearly" } as const;
type Status = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "RETIRED";
interface Tier {
  attainment: number;
  reward: number;
}
interface Row {
  id: string;
  code: string;
  name: string;
  metricLabel: string;
  periodType: keyof typeof PERIOD_LABELS;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: Status;
  tiers: Tier[];
  reps: number;
}
export interface IncentiveView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  metric: string;
  metricLabel: string;
  periodType: keyof typeof PERIOD_LABELS;
  effectiveFrom: string;
  effectiveTo: string | null;
  tiers: Tier[];
  users: { id: string; label: string }[];
  status: Status;
  version: number;
  createdBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionComment: string | null;
  awardedLines: number;
  viewerCanApprove: boolean;
}

const tiersText = (tiers: Tier[]) => tiers.map((t) => `${t.attainment}% → ${inr(t.reward)}`).join(" · ");

/** Commissions → Incentive plans list (Phase 07). */
export function IncentivePlansClient() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<Row[]>(`/api/v1/sales-marketing/commissions/incentives?status=${status}`);
  return (
    <div className="space-y-3">
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
        <option value="">Any status</option>
        <option value="DRAFT">Draft</option>
        <option value="PENDING_APPROVAL">Waiting for approval</option>
        <option value="APPROVED">Approved</option>
        <option value="RETIRED">Retired</option>
      </select>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-zinc-500">No incentive plans. An incentive pays a fixed reward when a rep reaches a share of an approved target.</p>
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">Target</th>
                <th className="py-2 pr-3">Rewards</th>
                <th className="py-2 pr-3">In force</th>
                <th className="py-2 pr-3">Reps</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/commissions/incentives/${p.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {p.name}
                    </Link>
                    <div className="text-xs text-zinc-500">{p.code}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {PERIOD_LABELS[p.periodType]} · {p.metricLabel}
                  </td>
                  <td className="py-2 pr-3">{tiersText(p.tiers)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {p.effectiveFrom}
                    {p.effectiveTo ? ` → ${p.effectiveTo}` : " onwards"}
                  </td>
                  <td className="py-2 pr-3">{p.reps ? p.reps : "Everyone with a target"}</td>
                  <td className="py-2">
                    <Badge tone={VERSION_STATUS[p.status].tone}>{VERSION_STATUS[p.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface FormState {
  code: string;
  name: string;
  description: string;
  metric: string;
  periodType: keyof typeof PERIOD_LABELS;
  effectiveFrom: string;
  effectiveTo: string;
  tiers: { attainment: string; reward: string }[];
  userIds: string[];
}

/** Create (no `initial`) or edit a draft incentive plan. */
export function IncentivePlanForm({ today, initial, onSaved, onCancel }: { today: string; initial?: IncentiveView; onSaved?: (v: IncentiveView) => void; onCancel?: () => void }) {
  const router = useRouter();
  const { reps } = usePerformanceOptions();
  const [f, setF] = useState<FormState>(
    initial
      ? {
          code: initial.code,
          name: initial.name,
          description: initial.description ?? "",
          metric: initial.metric,
          periodType: initial.periodType,
          effectiveFrom: initial.effectiveFrom,
          effectiveTo: initial.effectiveTo ?? "",
          tiers: initial.tiers.map((t) => ({ attainment: String(t.attainment), reward: String(t.reward) })),
          userIds: initial.users.map((u) => u.id),
        }
      : { code: "", name: "", description: "", metric: "BOOKED_ORDER_VALUE", periodType: "MONTH", effectiveFrom: today, effectiveTo: "", tiers: [{ attainment: "100", reward: "" }], userIds: [] }
  );
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tiers = f.tiers.map((t) => ({ attainment: Number(t.attainment || 0), reward: Number(t.reward || 0) }));
  const problems = incentiveTierProblems(tiers);
  const repLabel = (id: string) => reps.find((r) => r.id === id)?.label ?? initial?.users.find((u) => u.id === id)?.label ?? "…";

  return (
    <form
      className={`${CARD} max-w-3xl space-y-3`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const body = { name: f.name, description: f.description, metric: f.metric, periodType: f.periodType, effectiveFrom: f.effectiveFrom, effectiveTo: f.effectiveTo, tiers, userIds: f.userIds };
        try {
          if (initial) onSaved?.(await send<IncentiveView>(`/api/v1/sales-marketing/commissions/incentives/${initial.id}`, "PATCH", { ...body, version: initial.version }));
          else {
            const created = await send<IncentiveView>("/api/v1/sales-marketing/commissions/incentives", "POST", { ...body, code: f.code });
            router.push(`/sales-marketing/commissions/incentives/${created.id}`);
          }
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Code" htmlFor="ip-code" required>
          <input id="ip-code" required disabled={Boolean(initial)} maxLength={40} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Name" htmlFor="ip-name" required>
          <input id="ip-name" required maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="ip-desc">
        <textarea id="ip-desc" rows={2} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={textInputClass()} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Target metric" htmlFor="ip-metric" required>
          <select id="ip-metric" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} className={textInputClass()}>
            {SALES_TARGET_METRICS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Target period" htmlFor="ip-period" required>
          <select id="ip-period" value={f.periodType} onChange={(e) => setF({ ...f, periodType: e.target.value as FormState["periodType"] })} className={textInputClass()}>
            <option value="MONTH">Month</option>
            <option value="QUARTER">Quarter</option>
            <option value="YEAR">Year</option>
          </select>
        </FormField>
        <FormField label="In force from" htmlFor="ip-from" required>
          <input id="ip-from" type="date" required value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} className={textInputClass()} />
        </FormField>
        <FormField label="Until (optional)" htmlFor="ip-to">
          <input id="ip-to" type="date" value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} className={textInputClass()} />
        </FormField>
      </div>
      <p className="text-xs text-zinc-500">A target period counts when it ends inside these dates. The rep needs an approved rep target for this metric and period.</p>
      <div>
        <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">Rewards (highest tier reached wins)</p>
        <table className="text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="pr-2 font-medium">Attainment ≥ %</th>
              <th className="pr-2 font-medium">Reward ₹</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {f.tiers.map((t, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <input aria-label={`Tier ${i + 1} attainment`} type="number" min={0} step="0.01" required value={t.attainment} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, k) => (k === i ? { ...x, attainment: e.target.value } : x)) })} className={`${textInputClass()} !w-28`} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Tier ${i + 1} reward`} type="number" min={0} step="0.01" required value={t.reward} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, k) => (k === i ? { ...x, reward: e.target.value } : x)) })} className={`${textInputClass()} !w-36`} />
                </td>
                <td className="py-1">
                  {f.tiers.length > 1 && (
                    <Button type="button" size="xs" variant="secondary" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, k) => k !== i) })}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {f.tiers.length < 10 && (
          <Button type="button" size="xs" variant="secondary" onClick={() => setF({ ...f, tiers: [...f.tiers, { attainment: "", reward: "" }] })}>
            Add tier
          </Button>
        )}
        {problems.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{problems.join(" ")}</p>}
      </div>
      <div>
        <FormField label="Only these reps (leave empty for every rep with an approved target)" htmlFor="ip-rep">
          <SearchableSelect
            id="ip-rep"
            value={pick}
            onChange={(id) => {
              if (id && !f.userIds.includes(id)) setF({ ...f, userIds: [...f.userIds, id] });
              setPick("");
            }}
            options={reps.filter((r) => !f.userIds.includes(r.id))}
            placeholder="Add a rep…"
          />
        </FormField>
        <div className="mt-1 flex flex-wrap gap-1">
          {f.userIds.map((id) => (
            <button key={id} type="button" onClick={() => setF({ ...f, userIds: f.userIds.filter((x) => x !== id) })} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800" aria-label={`Remove ${repLabel(id)}`}>
              {repLabel(id)} ×
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => (onCancel ? onCancel() : router.back())}>
          Cancel
        </Button>
        <Button type="submit" isLoading={busy}>
          {initial ? "Save draft" : "Create plan"}
        </Button>
      </div>
    </form>
  );
}

const ACTIONS: Record<string, TextDialogSpec> = {
  submit: { action: "submit", title: "Submit for approval", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Submit" },
  approve: { action: "approve", title: "Approve incentive plan", help: "Approved plans are never edited — retire it and make a new one to change it.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" },
  "send-back": { action: "send-back", title: "Send back", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Send back", danger: true },
  "return-to-draft": { action: "return-to-draft", title: "Return to draft", submitLabel: "Return to draft" },
  retire: { action: "retire", title: "Retire incentive plan", help: "No more rewards from target periods evaluated after now. Rewards already on statements stay.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Retire", danger: true },
  discard: { action: "discard", title: "Discard draft", submitLabel: "Discard", danger: true },
};

export function IncentiveDetailClient({ initial, canEdit, canApprove, canReject, today }: { initial: IncentiveView; canEdit: boolean; canApprove: boolean; canReject: boolean; today: string }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<TextDialogSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = VERSION_STATUS[p.status];
  if (editing) return <IncentivePlanForm today={today} initial={p} onSaved={(v) => (setP(v), setEditing(false))} onCancel={() => setEditing(false)} />;
  return (
    <div className="space-y-4">
      <section className={`${CARD} text-sm`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Badge tone={st.tone}>{st.label}</Badge>{" "}
            <span className="text-zinc-600 dark:text-zinc-300">
              {PERIOD_LABELS[p.periodType]} {p.metricLabel.toLowerCase()} target · {p.effectiveFrom}
              {p.effectiveTo ? ` → ${p.effectiveTo}` : " onwards"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.status === "DRAFT" && canEdit && (
              <>
                <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button size="xs" onClick={() => setDialog(ACTIONS.submit)}>
                  Submit
                </Button>
                {!p.approvedAt && (
                  <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS.discard)}>
                    Discard
                  </Button>
                )}
              </>
            )}
            {p.status === "PENDING_APPROVAL" && (
              <>
                {canApprove && p.viewerCanApprove && (
                  <Button size="xs" variant="success" onClick={() => setDialog(ACTIONS.approve)}>
                    Approve
                  </Button>
                )}
                {canReject && (
                  <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS["send-back"])}>
                    Send back
                  </Button>
                )}
                {canEdit && (
                  <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS["return-to-draft"])}>
                    Return to draft
                  </Button>
                )}
              </>
            )}
            {p.status === "APPROVED" && canEdit && (
              <Button size="xs" variant="secondary" onClick={() => setDialog(ACTIONS.retire)}>
                Retire
              </Button>
            )}
          </div>
        </div>
        {p.description && <p className="mt-2">{p.description}</p>}
        <h2 className="mt-4 font-semibold">Rewards</h2>
        <ul className="mt-1 list-disc pl-5">
          {p.tiers.map((t) => (
            <li key={t.attainment}>
              {t.attainment}% of target or more → {inr(t.reward)}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-zinc-500">Highest tier reached wins (not added up). Attainment = actual ÷ approved rep target, by the same rules as Targets; never the forecast.</p>
        <h2 className="mt-4 font-semibold">Reps</h2>
        <p>{p.users.length ? p.users.map((u) => u.label).join(", ") : "Every rep with an approved target for this metric and period."}</p>
        <p className="mt-4 text-xs text-zinc-500">
          Prepared by {p.createdBy}
          {p.submittedBy ? ` · submitted by ${p.submittedBy}` : ""}
          {p.approvedBy ? ` · approved by ${p.approvedBy}${p.approvedAt ? ` ${formatDateTime(p.approvedAt)}` : ""}` : ""}
          {p.decisionComment ? ` — “${p.decisionComment}”` : ""} · {p.awardedLines} reward{p.awardedLines === 1 ? "" : "s"} on statements so far.
        </p>
        {p.status === "PENDING_APPROVAL" && canApprove && !p.viewerCanApprove && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">You prepared or submitted this plan, so someone else must approve it.</p>}
      </section>
      {dialog && (
        <TextDialog
          spec={dialog}
          busy={busy}
          error={error}
          onClose={() => (setDialog(null), setError(null))}
          onSubmit={async (body) => {
            setBusy(true);
            setError(null);
            try {
              const next = await send<IncentiveView | { deleted: true }>(`/api/v1/sales-marketing/commissions/incentives/${p.id}/${dialog.action}`, "POST", body);
              if ("deleted" in next) return router.push("/sales-marketing/commissions/incentives");
              setP(next);
              setDialog(null);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
