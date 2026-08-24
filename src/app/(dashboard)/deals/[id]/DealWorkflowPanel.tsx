"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { STAGE_LABELS, NEXT_STAGES } from "../statusLabels";

interface DealDetail {
  id: string;
  dealNumber: string;
  title: string;
  stage: keyof typeof STAGE_LABELS;
  value: string;
  weightedValue: number;
  probabilityPercent: string;
  lostReason: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
  lead: { id: string; leadNumber: string; name: string } | null;
  customer: { id: string; name: string; code: string } | null;
  assignedTo: { fullName: string } | null;
  salesAgent: { name: string } | null;
  resultingSalesOrders: Array<{ id: string; orderNumber: string; status: string }>;
}

interface Activity {
  id: string;
  activityType: string;
  subject: string | null;
  body: string | null;
  activityAt: string;
  performedBy: { fullName: string };
}

interface Followup {
  id: string;
  followupDate: string;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  notes: string | null;
}

interface CustomerOption {
  id: string;
  name: string;
  code: string;
}

const INTERACTION_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "NOTE"] as const;
const FOLLOWUP_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const PRIORITY_BADGE_CLASS: Record<(typeof FOLLOWUP_PRIORITIES)[number], string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export function DealWorkflowPanel({ deal }: { deal: DealDetail }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [activityType, setActivityType] = useState<(typeof INTERACTION_TYPES)[number]>("NOTE");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [followupDate, setFollowupDate] = useState("");
  const [followupType, setFollowupType] = useState<(typeof INTERACTION_TYPES)[number]>("CALL");
  const [followupPriority, setFollowupPriority] = useState<(typeof FOLLOWUP_PRIORITIES)[number]>("MEDIUM");
  const [followupNotes, setFollowupNotes] = useState("");

  // Deal → Customer conversion — only reachable once WON and not already
  // linked (mirrored server-side, this is just the matching UI gate).
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertMode, setConvertMode] = useState<"CREATE" | "LINK">("CREATE");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerCode, setNewCustomerCode] = useState("");
  const [newCustomerCountry, setNewCustomerCountry] = useState("");
  const [existingCustomers, setExistingCustomers] = useState<CustomerOption[]>([]);
  const [linkCustomerId, setLinkCustomerId] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{ name: string; code: string; id: string } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const openConvertModal = () => {
    setConvertMode("CREATE");
    setNewCustomerName(deal.lead?.name ?? deal.title);
    setNewCustomerCountry("");
    setDuplicateWarning(null);
    setConvertError(null);
    fetch("/api/v1/customers/next-code")
      .then((res) => res.json())
      .then((body) => setNewCustomerCode(body.data?.code ?? ""));
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setExistingCustomers(body.data ?? []));
    setShowConvertModal(true);
  };

  const submitConvert = async (overrideDuplicateCheck = false) => {
    setIsConverting(true);
    setConvertError(null);
    const payload =
      convertMode === "CREATE"
        ? { mode: "CREATE", name: newCustomerName, code: newCustomerCode, country: newCustomerCountry || undefined, overrideDuplicateCheck }
        : { mode: "LINK", customerId: linkCustomerId };
    const res = await fetch(`/api/v1/deals/${deal.id}/convert-to-customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setIsConverting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === "DUPLICATE_CUSTOMER_EXISTS") {
        setDuplicateWarning(body.error.details);
        return;
      }
      setConvertError(body?.error?.message ?? "Failed to convert this deal to a customer.");
      return;
    }
    window.location.reload();
  };

  const loadActivities = () =>
    fetch(`/api/v1/crm-activities?relatedModule=DEAL&relatedRecordId=${deal.id}`)
      .then((res) => res.json())
      .then((body) => setActivities(body.data ?? []));

  const loadFollowups = () =>
    fetch(`/api/v1/crm-followups?relatedModule=DEAL&relatedRecordId=${deal.id}`)
      .then((res) => res.json())
      .then((body) => setFollowups(body.data ?? []));

  useEffect(() => {
    loadActivities();
    loadFollowups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  const changeStage = async (stage: keyof typeof STAGE_LABELS, reason?: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/deals/${deal.id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, lostReason: reason }),
    });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to change stage.");
      return;
    }
    window.location.reload();
  };

  const submitActivity = async () => {
    setError(null);
    const res = await fetch("/api/v1/crm-activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relatedModule: "DEAL", relatedRecordId: deal.id, activityType, subject: activitySubject || undefined, body: activityBody || undefined }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to log activity.");
      return;
    }
    setActivitySubject("");
    setActivityBody("");
    setShowActivityModal(false);
    loadActivities();
  };

  const submitFollowup = async () => {
    setError(null);
    const res = await fetch("/api/v1/crm-followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relatedModule: "DEAL",
        relatedRecordId: deal.id,
        followupDate,
        type: followupType,
        priority: followupPriority,
        notes: followupNotes || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to schedule follow-up.");
      return;
    }
    setFollowupDate("");
    setFollowupNotes("");
    setFollowupPriority("MEDIUM");
    setShowFollowupModal(false);
    loadFollowups();
  };

  const changeFollowupStatus = async (id: string, status: "COMPLETED" | "CANCELLED") => {
    const res = await fetch(`/api/v1/crm-followups/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) loadFollowups();
  };

  const canEdit = deal.stage !== "WON" && deal.stage !== "LOST";
  const nextStages = NEXT_STAGES[deal.stage] ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {STAGE_LABELS[deal.stage]}
        </span>
        {canEdit && (
          <Link href={`/deals/${deal.id}/edit`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Edit
          </Link>
        )}
        {nextStages
          .filter((s) => s !== "LOST")
          .map((s) => (
            <button
              key={s}
              type="button"
              disabled={isBusy}
              onClick={() => changeStage(s)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Move to {STAGE_LABELS[s]}
            </button>
          ))}
        {nextStages.includes("LOST") && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setShowLostModal(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            Mark Lost
          </button>
        )}
        {deal.stage === "WON" && !deal.customer && (
          <button
            type="button"
            onClick={openConvertModal}
            className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
          >
            Convert to Customer
          </button>
        )}
        {deal.customer && (
          <a
            href={`/sales-orders/new?customerId=${deal.customer.id}&originatingDealId=${deal.id}&originatingDealNumber=${encodeURIComponent(deal.dealNumber)}`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Create Sales Order
          </a>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Lead</dt>
          <dd className="mt-0.5">
            {deal.lead ? (
              <a href={`/leads/${deal.lead.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {deal.lead.name} ({deal.lead.leadNumber})
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Customer</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
            {deal.customer ? (
              <a href={`/masters/customers/${deal.customer.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {deal.customer.name} ({deal.customer.code})
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Value / Weighted</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">
            ₹{Number(deal.value).toLocaleString()} / ₹{Number(deal.weightedValue).toLocaleString()} ({Number(deal.probabilityPercent)}%)
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Owner</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{deal.assignedTo?.fullName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Sales Agent</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{deal.salesAgent?.name ?? "—"}</dd>
        </div>
        {deal.lostReason && (
          <div className="col-span-full">
            <dt className="text-xs font-medium uppercase text-zinc-500">Lost Reason</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{deal.lostReason}</dd>
          </div>
        )}
        {deal.notes && (
          <div className="col-span-full">
            <dt className="text-xs font-medium uppercase text-zinc-500">Notes</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{deal.notes}</dd>
          </div>
        )}
      </dl>

      {deal.resultingSalesOrders.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Resulting Sales Orders</h2>
          <ul className="space-y-1 text-sm">
            {deal.resultingSalesOrders.map((o) => (
              <li key={o.id}>
                <a href={`/sales-orders/${o.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {o.orderNumber}
                </a>{" "}
                ({o.status})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Follow-ups</h2>
          <button type="button" onClick={() => setShowFollowupModal(true)} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Schedule Follow-up
          </button>
        </div>
        {followups.length === 0 ? (
          <p className="text-sm text-zinc-500">No follow-ups scheduled.</p>
        ) : (
          <ul className="space-y-2">
            {followups.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div>
                  {new Date(f.followupDate).toLocaleString()} · {f.type} · {f.status}{" "}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_BADGE_CLASS[f.priority]}`}>{f.priority}</span>
                  {f.notes && <p className="text-xs text-zinc-500">{f.notes}</p>}
                </div>
                {f.status === "PENDING" && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => changeFollowupStatus(f.id, "COMPLETED")} className="text-xs font-medium text-green-600 hover:underline">
                      Complete
                    </button>
                    <button type="button" onClick={() => changeFollowupStatus(f.id, "CANCELLED")} className="text-xs font-medium text-red-600 hover:underline">
                      Cancel
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Activity Timeline</h2>
          <button type="button" onClick={() => setShowActivityModal(true)} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Log Activity
          </button>
        </div>
        {activities.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity logged yet.</p>
        ) : (
          <ul className="space-y-2">
            {activities.map((a) => (
              <li key={a.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>{a.activityType}</span>
                  <span>
                    {new Date(a.activityAt).toLocaleString()} · {a.performedBy.fullName}
                  </span>
                </div>
                {a.subject && <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">{a.subject}</p>}
                {a.body && <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{a.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={showActivityModal} onClose={() => setShowActivityModal(false)} title="Log Activity">
        <div className="space-y-3">
          <FormField label="Type" htmlFor="activityType">
            <select id="activityType" value={activityType} onChange={(e) => setActivityType(e.target.value as typeof activityType)} className={textInputClass()}>
              {INTERACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Subject" htmlFor="activitySubject">
            <input id="activitySubject" value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Details" htmlFor="activityBody">
            <textarea id="activityBody" value={activityBody} onChange={(e) => setActivityBody(e.target.value)} className={textInputClass()} rows={3} />
          </FormField>
          <button type="button" onClick={submitActivity} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
            Save Activity
          </button>
        </div>
      </Modal>

      <Modal open={showFollowupModal} onClose={() => setShowFollowupModal(false)} title="Schedule Follow-up">
        <div className="space-y-3">
          <FormField label="Date & Time" htmlFor="followupDate" required>
            <input id="followupDate" type="datetime-local" required value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Type" htmlFor="followupType">
            <select id="followupType" value={followupType} onChange={(e) => setFollowupType(e.target.value as typeof followupType)} className={textInputClass()}>
              {INTERACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority" htmlFor="followupPriority">
            <select id="followupPriority" value={followupPriority} onChange={(e) => setFollowupPriority(e.target.value as typeof followupPriority)} className={textInputClass()}>
              {FOLLOWUP_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Notes" htmlFor="followupNotes">
            <textarea id="followupNotes" value={followupNotes} onChange={(e) => setFollowupNotes(e.target.value)} className={textInputClass()} rows={2} />
          </FormField>
          <button
            type="button"
            onClick={submitFollowup}
            disabled={!followupDate}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Save Follow-up
          </button>
        </div>
      </Modal>

      <Modal open={showLostModal} onClose={() => setShowLostModal(false)} title="Mark Deal as Lost">
        <div className="space-y-3">
          <FormField label="Reason" htmlFor="lostReason" required>
            <textarea id="lostReason" required value={lostReason} onChange={(e) => setLostReason(e.target.value)} className={textInputClass()} rows={3} />
          </FormField>
          <button
            type="button"
            disabled={!lostReason}
            onClick={() => changeStage("LOST", lostReason)}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            Mark Lost
          </button>
        </div>
      </Modal>

      <Modal open={showConvertModal} onClose={() => setShowConvertModal(false)} title="Convert Deal to Customer">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConvertMode("CREATE");
                setDuplicateWarning(null);
                setConvertError(null);
              }}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${convertMode === "CREATE" ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              Create New Customer
            </button>
            <button
              type="button"
              onClick={() => {
                setConvertMode("LINK");
                setDuplicateWarning(null);
                setConvertError(null);
              }}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${convertMode === "LINK" ? "border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              Link Existing Customer
            </button>
          </div>

          {convertMode === "CREATE" ? (
            <>
              <FormField label="Customer Name" htmlFor="newCustomerName" required>
                <input
                  id="newCustomerName"
                  required
                  value={newCustomerName}
                  onChange={(e) => {
                    setNewCustomerName(e.target.value);
                    setDuplicateWarning(null);
                  }}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Code" htmlFor="newCustomerCode" required>
                <input id="newCustomerCode" required value={newCustomerCode} onChange={(e) => setNewCustomerCode(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Country" htmlFor="newCustomerCountry">
                <input id="newCustomerCountry" value={newCustomerCountry} onChange={(e) => setNewCustomerCountry(e.target.value)} className={textInputClass()} />
              </FormField>

              {duplicateWarning && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  <p>
                    A customer named <strong>{duplicateWarning.name}</strong> ({duplicateWarning.code}) already exists.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConvertMode("LINK");
                        setLinkCustomerId(duplicateWarning.id);
                        setDuplicateWarning(null);
                      }}
                      className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
                    >
                      Link to it instead
                    </button>
                    <button
                      type="button"
                      onClick={() => submitConvert(true)}
                      disabled={isConverting}
                      className="rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:text-amber-300"
                    >
                      Create separate customer anyway
                    </button>
                  </div>
                </div>
              )}

              {convertError && <p className="text-sm text-red-600 dark:text-red-400">{convertError}</p>}

              {!duplicateWarning && (
                <button
                  type="button"
                  onClick={() => submitConvert(false)}
                  disabled={isConverting || !newCustomerName || !newCustomerCode}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isConverting ? "Converting…" : "Create Customer & Link"}
                </button>
              )}
            </>
          ) : (
            <>
              <FormField label="Customer" htmlFor="linkCustomerId" required>
                <select id="linkCustomerId" required value={linkCustomerId} onChange={(e) => setLinkCustomerId(e.target.value)} className={textInputClass()}>
                  <option value="">— Select —</option>
                  {existingCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </FormField>

              {convertError && <p className="text-sm text-red-600 dark:text-red-400">{convertError}</p>}

              <button
                type="button"
                onClick={() => submitConvert()}
                disabled={isConverting || !linkCustomerId}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isConverting ? "Linking…" : "Link Customer"}
              </button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
