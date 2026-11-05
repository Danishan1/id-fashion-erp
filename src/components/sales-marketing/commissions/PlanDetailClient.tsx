"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatDateTime } from "@/lib/date-format";
import { usePerformanceOptions } from "../performance/performance-ui";
import { BASIS_HINTS, BASIS_LABELS, Badge, CARD, PAYEE_LABELS, TextDialog, VERSION_STATUS, send, type TextDialogSpec } from "./commission-ui";
import { RuleEditor, rulePayload, toRuleDraft, type RuleDraft, type VersionView } from "./PlanRuleEditor";

interface Version extends VersionView {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "WITHDRAWN";
  version: number;
  summary: string;
  createdBy: string;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionComment: string | null;
}
export interface PlanView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  payeeType: "REP" | "AGENT";
  basis: "INVOICED" | "COLLECTED";
  active: boolean;
  createdBy: string;
  viewerCanApprove: boolean;
  versions: Version[];
  assignments: { id: string; payee: string; startDate: string; endDate: string | null; state: "UPCOMING" | "CURRENT" | "ENDED" }[];
}

const ACTIONS: Record<string, TextDialogSpec> = {
  submit: { action: "submit", title: "Submit for approval", help: "Someone else with approval rights must approve it.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Submit" },
  approve: { action: "approve", title: "Approve version", help: "It values commission from its start date. It can't be edited afterwards.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" },
  "send-back": { action: "send-back", title: "Send back", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Send back", danger: true },
  "return-to-draft": { action: "return-to-draft", title: "Return to draft", help: "Withdraws it from approval so you can edit it.", submitLabel: "Return to draft" },
  withdraw: { action: "withdraw", title: "Withdraw approved version", help: "Only a version that hasn't started yet can be withdrawn.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Withdraw", danger: true },
  discard: { action: "discard", title: "Discard draft", help: "Deletes this draft. If it is the plan's only version, the plan is deleted too.", submitLabel: "Discard", danger: true },
};

/** Commission plan detail (Phase 07): versions with approval, and who is on the plan when. */
export function PlanDetailClient({ initial, canEdit, canApprove, canReject, today }: { initial: PlanView; canEdit: boolean; canApprove: boolean; canReject: boolean; today: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState(initial);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [dialog, setDialog] = useState<{ spec: TextDialogSpec; versionId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<{ id: string; endDate: string } | null>(null);
  const [header, setHeader] = useState<{ name: string; description: string } | null>(null);
  const base = `/api/v1/sales-marketing/commissions/plans/${plan.id}`;

  const draftVersion = plan.versions.find((v) => v.status === "DRAFT");
  const openVersion = plan.versions.find((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL");
  const run = async (fn: () => Promise<PlanView | { deleted: true }>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if ("deleted" in next) return router.push("/sales-marketing/commissions/plans");
      setPlan(next);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="text-sm">
            <p>
              Paid to <strong>{PAYEE_LABELS[plan.payeeType].toLowerCase()}s</strong> on <strong>{BASIS_LABELS[plan.basis].toLowerCase()}</strong> · {plan.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{BASIS_HINTS[plan.basis]}</p>
            {plan.description && <p className="mt-2 text-zinc-600 dark:text-zinc-300">{plan.description}</p>}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <Button size="xs" variant="secondary" onClick={() => setHeader({ name: plan.name, description: plan.description ?? "" })}>
                Edit details
              </Button>
              <Button size="xs" variant="secondary" isLoading={busy} onClick={() => run(() => send(`${base}/status`, "PATCH", { isActive: !plan.active }))}>
                {plan.active ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          )}
        </div>
      </section>

      {error && !dialog && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <section className={CARD} aria-labelledby="versions-h">
        <div className="flex items-center justify-between">
          <h2 id="versions-h" className="font-semibold">
            Versions
          </h2>
          {canEdit && !openVersion && (
            <Button size="xs" variant="secondary" isLoading={busy} onClick={() => run(() => send(`${base}/versions`, "POST"))}>
              Start new version
            </Button>
          )}
        </div>
        <ul className="mt-3 space-y-3">
          {plan.versions.map((v) => {
            const st = VERSION_STATUS[v.status];
            const editingThis = draft && draftVersion?.id === v.id;
            return (
              <li key={v.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">Version {v.versionNumber}</span> <Badge tone={st.tone}>{st.label}</Badge>{" "}
                    <span className="text-zinc-500">
                      {v.effectiveFrom}
                      {v.effectiveTo ? ` → ${v.effectiveTo}` : " onwards"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {v.status === "DRAFT" && canEdit && !editingThis && (
                      <>
                        <Button size="xs" variant="secondary" onClick={() => setDraft(toRuleDraft(v))}>
                          Edit
                        </Button>
                        <Button size="xs" onClick={() => setDialog({ spec: ACTIONS.submit, versionId: v.id })}>
                          Submit
                        </Button>
                        <Button size="xs" variant="secondary" onClick={() => setDialog({ spec: ACTIONS.discard, versionId: v.id })}>
                          Discard
                        </Button>
                      </>
                    )}
                    {v.status === "PENDING_APPROVAL" && (
                      <>
                        {canApprove && plan.viewerCanApprove && (
                          <Button size="xs" variant="success" onClick={() => setDialog({ spec: ACTIONS.approve, versionId: v.id })}>
                            Approve
                          </Button>
                        )}
                        {canReject && (
                          <Button size="xs" variant="secondary" onClick={() => setDialog({ spec: ACTIONS["send-back"], versionId: v.id })}>
                            Send back
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="xs" variant="secondary" onClick={() => setDialog({ spec: ACTIONS["return-to-draft"], versionId: v.id })}>
                            Return to draft
                          </Button>
                        )}
                      </>
                    )}
                    {v.status === "APPROVED" && canEdit && v.effectiveFrom > today && (
                      <Button size="xs" variant="secondary" onClick={() => setDialog({ spec: ACTIONS.withdraw, versionId: v.id })}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>
                {editingThis ? (
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run(() => send(`${base}/versions/${v.id}`, "PATCH", { ...rulePayload(draft), version: v.version }))) setDraft(null);
                    }}
                  >
                    <RuleEditor value={draft} onChange={setDraft} basis={plan.basis} />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" isLoading={busy}>
                        Save draft
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="mt-1">{v.summary}</p>
                    {v.notes && <p className="mt-1 text-xs text-zinc-500">{v.notes}</p>}
                    <p className="mt-1 text-xs text-zinc-500">
                      Prepared by {v.createdBy}
                      {v.submittedBy ? ` · submitted by ${v.submittedBy}` : ""}
                      {v.approvedBy ? ` · approved by ${v.approvedBy}${v.approvedAt ? ` ${formatDateTime(v.approvedAt)}` : ""}` : ""}
                      {v.decisionComment ? ` — “${v.decisionComment}”` : ""}
                    </p>
                    {v.status === "PENDING_APPROVAL" && canApprove && !plan.viewerCanApprove && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">You prepared or submitted this version, so someone else must approve it.</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={CARD} aria-labelledby="assign-h">
        <div className="flex items-center justify-between">
          <h2 id="assign-h" className="font-semibold">
            Who is on this plan
          </h2>
          {canEdit && plan.active && (
            <Button size="xs" variant="secondary" onClick={() => (setError(null), setAssigning(true))}>
              Assign {plan.payeeType === "REP" ? "a rep" : "a sales agent"}
            </Button>
          )}
        </div>
        {plan.assignments.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Nobody yet. Commission is only worked out for people assigned to a plan, from their start date.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-3">{PAYEE_LABELS[plan.payeeType]}</th>
                <th className="py-2 pr-3">From</th>
                <th className="py-2 pr-3">Until</th>
                <th className="py-2 pr-3">State</th>
                {canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {plan.assignments.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-3">{a.payee}</td>
                  <td className="py-2 pr-3">{a.startDate}</td>
                  <td className="py-2 pr-3">{a.endDate ?? "—"}</td>
                  <td className="py-2 pr-3">{a.state === "CURRENT" ? <Badge tone="green">Current</Badge> : a.state === "UPCOMING" ? <Badge tone="indigo">Upcoming</Badge> : <Badge>Ended</Badge>}</td>
                  {canEdit && (
                    <td className="py-2 text-right whitespace-nowrap">
                      {a.state !== "ENDED" && (
                        <Button size="xs" variant="secondary" onClick={() => setEnding({ id: a.id, endDate: a.endDate ?? today })}>
                          End
                        </Button>
                      )}{" "}
                      {a.state === "UPCOMING" && (
                        <Button size="xs" variant="secondary" isLoading={busy} onClick={() => run(() => send(`${base}/assignments/${a.id}`, "DELETE"))}>
                          Remove
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {dialog && (
        <TextDialog
          spec={dialog.spec}
          busy={busy}
          error={error}
          onClose={() => (setDialog(null), setError(null))}
          onSubmit={async (body) => {
            if (await run(() => send(`${base}/versions/${dialog.versionId}/${dialog.spec.action}`, "POST", body))) setDialog(null);
          }}
        />
      )}
      {assigning && <AssignDialog plan={plan} today={today} onClose={() => setAssigning(false)} onSaved={(p) => (setPlan(p), setAssigning(false))} />}
      {ending && (
        <Modal open onClose={() => setEnding(null)} title="End assignment">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => send(`${base}/assignments/${ending.id}`, "PATCH", { endDate: ending.endDate }))) setEnding(null);
            }}
          >
            <FormField label="Last day on this plan" htmlFor="as-end" required>
              <input id="as-end" type="date" required value={ending.endDate} onChange={(e) => setEnding({ ...ending, endDate: e.target.value })} className={textInputClass()} />
            </FormField>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEnding(null)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {header && (
        <Modal open onClose={() => setHeader(null)} title="Edit plan details">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => send(base, "PATCH", header))) setHeader(null);
            }}
          >
            <FormField label="Name" htmlFor="ph-name" required>
              <input id="ph-name" required maxLength={200} value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Description" htmlFor="ph-desc">
              <textarea id="ph-desc" rows={2} maxLength={1000} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} className={textInputClass()} />
            </FormField>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setHeader(null)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function AssignDialog({ plan, today, onClose, onSaved }: { plan: PlanView; today: string; onClose: () => void; onSaved: (p: PlanView) => void }) {
  const { reps } = usePerformanceOptions(plan.payeeType === "REP");
  const [agents, setAgents] = useState<{ id: string; label: string; sublabel?: string }[]>([]);
  const [form, setForm] = useState({ payee: "", startDate: today, endDate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (plan.payeeType !== "AGENT") return;
    fetch("/api/v1/sales-marketing/channels/options", { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : { data: { agents: [] } }))
      .then((b) => setAgents((b.data.agents ?? []).map((a: { id: string; name: string; code: string }) => ({ id: a.id, label: a.name, sublabel: a.code }))))
      .catch(() => undefined);
  }, [plan.payeeType]);
  return (
    <Modal open onClose={onClose} title={plan.payeeType === "REP" ? "Assign a sales rep" : "Assign a sales agent"}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const body = { ...(plan.payeeType === "REP" ? { userId: form.payee } : { salesAgentId: form.payee }), startDate: form.startDate, endDate: form.endDate };
            onSaved(await send<PlanView>(`/api/v1/sales-marketing/commissions/plans/${plan.id}/assignments`, "POST", body));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <FormField label={PAYEE_LABELS[plan.payeeType]} htmlFor="as-payee" required>
          <SearchableSelect id="as-payee" required value={form.payee} onChange={(payee) => setForm({ ...form, payee })} options={plan.payeeType === "REP" ? reps : agents} placeholder="Search…" />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="From" htmlFor="as-start" required>
            <input id="as-start" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Until (optional)" htmlFor="as-until">
            <input id="as-until" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500">One plan at a time per person: dates overlapping another plan are refused.</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" isLoading={busy}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
