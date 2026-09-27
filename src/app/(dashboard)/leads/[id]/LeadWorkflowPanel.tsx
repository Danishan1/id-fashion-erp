"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import {
  BUSINESS_TYPE_LABELS,
  LEAD_PRIORITY_BADGE_CLASS,
  LEAD_PRIORITY_LABELS,
  QUALITY_BADGE_CLASS,
  QUALITY_LABELS,
  STAGE_KIND_BADGE_CLASS,
  type StageKind,
} from "../statusLabels";
import { formatNumber } from "@/lib/currency";
import { LeadStagePanel } from "./LeadStagePanel";

interface LeadDetail {
  id: string;
  leadNumber: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  alternativePhone: string | null;
  designation: string | null;
  website: string | null;
  companyName: string | null;
  businessType: keyof typeof BUSINESS_TYPE_LABELS | null;
  country: string | null;
  state: string | null;
  city: string | null;
  productCategory: { name: string } | null;
  season: { name: string } | null;
  productInterests: Array<{ productType: { id: string; name: string } }>;
  market: string | null;
  expectedQuantity: number | null;
  targetPrice: string | null;
  currencyCode: string | null;
  moqRequirement: string | null;
  requiredDeliveryDate: string | null;
  samplingRequired: boolean;
  techPackAvailable: boolean;
  referenceImageAvailable: boolean;
  source: { name: string } | null;
  stage: { id: string; name: string; kind: StageKind };
  lostReason: { name: string } | null;
  lostCompetitor: string | null;
  lostComment: string | null;
  leadScore: string;
  quality: keyof typeof QUALITY_LABELS;
  priority: keyof typeof LEAD_PRIORITY_LABELS;
  daysSinceCreated: number;
  daysInCurrentStage: number;
  daysSinceLastActivity: number | null;
  value: string;
  expectedCloseDate: string | null;
  notes: string | null;
  assignedTo: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string };
  buyerEnquiry: { id: string; enquiryNumber: string } | null;
  campaign: { id: string; campaignNumber: string; name: string } | null;
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
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  notes: string | null;
  assignedTo: { fullName: string } | null;
}

const INTERACTION_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "NOTE"] as const;
const FOLLOWUP_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const PRIORITY_BADGE_CLASS: Record<(typeof FOLLOWUP_PRIORITIES)[number], string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

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
  const [followupPriority, setFollowupPriority] = useState<(typeof FOLLOWUP_PRIORITIES)[number]>("MEDIUM");
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

  const isOverdue = (f: Followup) => f.status === "PENDING" && new Date(f.followupDate).getTime() < now;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STAGE_KIND_BADGE_CLASS[lead.stage.kind]}`}>{lead.stage.name}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${QUALITY_BADGE_CLASS[lead.quality]}`}>
          {QUALITY_LABELS[lead.quality]} · Score {Number(lead.leadScore).toFixed(0)}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${LEAD_PRIORITY_BADGE_CLASS[lead.priority]}`}>
          {LEAD_PRIORITY_LABELS[lead.priority]} priority
        </span>
        <span className="text-xs text-zinc-500">
          {lead.daysInCurrentStage}d in stage · created {lead.daysSinceCreated}d ago ·{" "}
          {lead.daysSinceLastActivity === null ? (
            <span className="font-medium text-red-600 dark:text-red-400">never contacted</span>
          ) : (
            `last activity ${lead.daysSinceLastActivity}d ago`
          )}
        </span>
        <Link href={`/leads/${lead.id}/edit`} className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Edit
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <LeadStagePanel leadId={lead.id} currentStage={lead.stage} lostReason={lead.lostReason} lostCompetitor={lead.lostCompetitor} lostComment={lead.lostComment} />

      <dl className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Company" value={lead.companyName} />
        <Detail label="Contact Person" value={[lead.name, lead.designation].filter(Boolean).join(" · ")} />
        <Detail label="Business Type" value={lead.businessType ? BUSINESS_TYPE_LABELS[lead.businessType] : null} />
        <Detail label="Email" value={lead.email} />
        <Detail label="Mobile" value={lead.phone} />
        <Detail label="WhatsApp" value={lead.whatsappNumber} />
        <Detail label="Location" value={[lead.city, lead.state, lead.country].filter(Boolean).join(", ")} />
        <Detail label="Website" value={lead.website} />
        <Detail label="Source" value={lead.source?.name} />
        <Detail label="Product Category" value={lead.productCategory?.name} />
        <Detail label="Product Interest" value={lead.productInterests.map((p) => p.productType.name).join(", ")} />
        <Detail label="Season / Market" value={[lead.season?.name, lead.market].filter(Boolean).join(" · ")} />
        <Detail label="Expected Quantity" value={lead.expectedQuantity != null ? `${lead.expectedQuantity.toLocaleString()} pcs` : null} />
        <Detail
          label="Target Price"
          value={lead.targetPrice != null ? `${lead.currencyCode ?? ""} ${formatNumber(lead.targetPrice)}`.trim() : null}
        />
        <Detail label="Expected Order Value" value={`₹${formatNumber(lead.value)}`} />
        <Detail label="MOQ Requirement" value={lead.moqRequirement} />
        <Detail label="Required Delivery" value={lead.requiredDeliveryDate ? new Date(lead.requiredDeliveryDate).toLocaleDateString() : null} />
        <Detail
          label="Sampling / Tech Pack / Reference"
          value={[lead.samplingRequired && "Sampling required", lead.techPackAvailable && "Tech pack available", lead.referenceImageAvailable && "Reference image available"]
            .filter(Boolean)
            .join(" · ")}
        />
        <Detail label="Assigned Salesperson" value={lead.assignedTo?.fullName ?? "Unassigned"} />
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
        {lead.campaign && (
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">Campaign</dt>
            <dd className="mt-0.5">
              <a href={`/campaigns/${lead.campaign.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                {lead.campaign.name} ({lead.campaign.campaignNumber})
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
                — {d.title} ({d.stage}, ₹{formatNumber(d.value)})
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
                  · {f.type} · {f.status}{" "}
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
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowActivityModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button type="button" onClick={submitActivity} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Save Activity
            </button>
          </div>
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
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowFollowupModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitFollowup}
              disabled={!followupDate}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Save Follow-up
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="mt-0.5 break-words text-zinc-900 dark:text-zinc-50">{value || "—"}</dd>
    </div>
  );
}
