"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { STATUS_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from "../statusLabels";

interface LeadDetail {
  id: string;
  leadNumber: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: keyof typeof SOURCE_LABELS;
  leadScore: string;
  priority: keyof typeof PRIORITY_LABELS;
  status: keyof typeof STATUS_LABELS;
  value: string;
  expectedCloseDate: string | null;
  notes: string | null;
  assignedTo: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string };
  buyerEnquiry: { id: string; enquiryNumber: string } | null;
  deals: Array<{ id: string; dealNumber: string; title: string; stage: string; value: string }>;
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
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  notes: string | null;
  assignedTo: { fullName: string } | null;
}

const INTERACTION_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "NOTE"] as const;

export function LeadWorkflowPanel({ lead }: { lead: LeadDetail }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  // Lazy useState initializer — the one place React's purity rule accepts
  // an impure call like Date.now(), since it runs exactly once at mount
  // rather than on every render. Only used for "is this overdue" display,
  // so a value fixed at mount-time (not re-ticking every second) is fine.
  const [now] = useState(() => Date.now());
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activityType, setActivityType] = useState<(typeof INTERACTION_TYPES)[number]>("NOTE");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");

  const [followupDate, setFollowupDate] = useState("");
  const [followupType, setFollowupType] = useState<(typeof INTERACTION_TYPES)[number]>("CALL");
  const [followupNotes, setFollowupNotes] = useState("");

  const loadActivities = () =>
    fetch(`/api/v1/crm-activities?relatedModule=LEAD&relatedRecordId=${lead.id}`)
      .then((res) => res.json())
      .then((body) => setActivities(body.data ?? []));

  const loadFollowups = () =>
    fetch(`/api/v1/crm-followups?relatedModule=LEAD&relatedRecordId=${lead.id}`)
      .then((res) => res.json())
      .then((body) => setFollowups(body.data ?? []));

  useEffect(() => {
    loadActivities();
    loadFollowups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const submitActivity = async () => {
    setError(null);
    const res = await fetch("/api/v1/crm-activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relatedModule: "LEAD",
        relatedRecordId: lead.id,
        activityType,
        subject: activitySubject || undefined,
        body: activityBody || undefined,
      }),
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
        relatedModule: "LEAD",
        relatedRecordId: lead.id,
        assignedToUserId: lead.assignedTo?.id,
        followupDate,
        type: followupType,
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

  const isOverdue = (f: Followup) => f.status === "PENDING" && new Date(f.followupDate).getTime() < now;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {STATUS_LABELS[lead.status]}
        </span>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          {PRIORITY_LABELS[lead.priority]} · Score {Number(lead.leadScore).toFixed(1)}
        </span>
        <Link href={`/leads/${lead.id}/edit`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Edit
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Company</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{lead.companyName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Email</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{lead.email ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Phone</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{lead.phone ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Source</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{SOURCE_LABELS[lead.source]}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Potential Value</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">₹{Number(lead.value).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase text-zinc-500">Assigned To</dt>
          <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{lead.assignedTo?.fullName ?? "Unassigned"}</dd>
        </div>
        {lead.buyerEnquiry && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">Linked Buyer Enquiry</dt>
            <dd className="mt-0.5">
              <a href={`/buyer-enquiries/${lead.buyerEnquiry.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {lead.buyerEnquiry.enquiryNumber}
              </a>
            </dd>
          </div>
        )}
        {lead.notes && (
          <div className="col-span-full">
            <dt className="text-xs font-medium uppercase text-zinc-500">Notes</dt>
            <dd className="mt-0.5 text-zinc-900 dark:text-zinc-50">{lead.notes}</dd>
          </div>
        )}
      </dl>

      {lead.deals.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Deals from this Lead</h2>
          <ul className="space-y-1 text-sm">
            {lead.deals.map((d) => (
              <li key={d.id}>
                <a href={`/deals/${d.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {d.dealNumber}
                </a>{" "}
                — {d.title} ({d.stage}, ₹{Number(d.value).toLocaleString()})
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
                  <span className={isOverdue(f) ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}>
                    {new Date(f.followupDate).toLocaleString()}
                  </span>{" "}
                  · {f.type} · {f.status}
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
    </div>
  );
}
