"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { humanizeStatus } from "@/lib/humanize-status";
import { formatNumber } from "@/lib/currency";
import { hasCountryCode, mailtoUrl, telUrl, whatsAppUrl } from "@/lib/communication";
import {
  BUSINESS_TYPE_LABELS,
  LEAD_PRIORITY_BADGE_CLASS,
  LEAD_PRIORITY_LABELS,
  QUALITY_BADGE_CLASS,
  QUALITY_LABELS,
  STAGE_KIND_BADGE_CLASS,
  type StageKind,
} from "../statusLabels";
import { LeadStagePanel } from "./LeadStagePanel";
import { LeadTimelineTab } from "./LeadTimelineTab";
import { LeadContactsTab } from "./LeadContactsTab";
import { LeadFilesTab } from "./LeadFilesTab";

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
  address: string | null;
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
  buyerEnquiry: {
    id: string;
    enquiryNumber: string;
    lines: Array<{
      id: string;
      styleNameFreeText: string | null;
      sampleRequest: { id: string; requestNumber: string; styleName: string | null; status: string } | null;
    }>;
  } | null;
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
type InteractionType = (typeof INTERACTION_TYPES)[number];
const FOLLOWUP_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
const PRIORITY_BADGE_CLASS: Record<(typeof FOLLOWUP_PRIORITIES)[number], string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const TABS = [
  "Overview",
  "Timeline",
  "Contacts",
  "Activities",
  "Follow-ups",
  "Requirements",
  "Samples",
  "Quotations",
  "Opportunities",
  "Files",
  "Notes",
] as const;
type Tab = (typeof TABS)[number];

const actionBtn =
  "inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="mt-0.5 break-words text-zinc-900 dark:text-zinc-50">{value || "—"}</dd>
    </div>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}

export function LeadWorkflowPanel({ lead }: { lead: LeadDetail }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Overview");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  // Lazy useState initializer — runs exactly once at mount, the one place
  // React's purity rule accepts Date.now(). Only used for "is this overdue".
  const [now] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [timelineSignal, setTimelineSignal] = useState(0);
  const [filePickerSignal, setFilePickerSignal] = useState(0);
  const [stageIntent, setStageIntent] = useState<{ kind: StageKind; n: number } | null>(null);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityType, setActivityType] = useState<InteractionType>("NOTE");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [activityNextFollowup, setActivityNextFollowup] = useState("");

  const [showFollowupModal, setShowFollowupModal] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [followupType, setFollowupType] = useState<InteractionType>("CALL");
  const [followupPriority, setFollowupPriority] = useState<(typeof FOLLOWUP_PRIORITIES)[number]>("MEDIUM");
  const [followupNotes, setFollowupNotes] = useState("");

  const loadActivities = () =>
    fetch(`/api/v1/crm-activities?relatedModule=LEAD&relatedRecordId=${lead.id}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setActivities(body.data ?? []));

  const loadFollowups = () =>
    fetch(`/api/v1/crm-followups?relatedModule=LEAD&relatedRecordId=${lead.id}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setFollowups(body.data ?? []));

  useEffect(() => {
    loadActivities();
    loadFollowups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  /** Anything logged changes the timeline and the "last activity" header. */
  const afterChange = () => {
    loadActivities();
    loadFollowups();
    setTimelineSignal((n) => n + 1);
    router.refresh();
  };

  const openActivity = (type: InteractionType) => {
    setError(null);
    setActivityType(type);
    setActivitySubject("");
    setActivityBody("");
    setActivityNextFollowup("");
    setShowActivityModal(true);
  };

  const postFollowup = (payload: { followupDate: string; type: InteractionType; priority?: string; notes?: string }) =>
    fetch("/api/v1/crm-followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relatedModule: "LEAD", relatedRecordId: lead.id, assignedToUserId: lead.assignedTo?.id, priority: "MEDIUM", ...payload }),
    });

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
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to log activity.");
      return;
    }
    // Quick "log the call and set the next step" in one save (spec §38).
    if (activityNextFollowup) {
      const fu = await postFollowup({ followupDate: activityNextFollowup, type: activityType === "NOTE" ? "CALL" : activityType }).catch(() => null);
      if (!fu || !fu.ok) {
        setError("The activity was saved, but the next follow-up could not be scheduled.");
        afterChange();
        return;
      }
    }
    setShowActivityModal(false);
    afterChange();
  };

  const submitFollowup = async () => {
    setError(null);
    const res = await postFollowup({ followupDate, type: followupType, priority: followupPriority, notes: followupNotes || undefined }).catch(() => null);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to schedule follow-up.");
      return;
    }
    setFollowupDate("");
    setFollowupNotes("");
    setFollowupPriority("MEDIUM");
    setShowFollowupModal(false);
    afterChange();
  };

  const changeFollowupStatus = async (id: string, status: "COMPLETED" | "CANCELLED") => {
    const res = await fetch(`/api/v1/crm-followups/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) afterChange();
  };

  const isOverdue = (f: Followup) => f.status === "PENDING" && new Date(f.followupDate).getTime() < now;
  const nextFollowup = followups
    .filter((f) => f.status === "PENDING")
    .sort((a, b) => new Date(a.followupDate).getTime() - new Date(b.followupDate).getTime())[0];

  const callHref = telUrl(lead.phone ?? lead.alternativePhone);
  const mailHref = mailtoUrl(lead.email, lead.companyName ? `${lead.companyName} — enquiry` : undefined);
  const waNumber = lead.whatsappNumber ?? lead.phone;
  const waHref = whatsAppUrl(waNumber);
  const waMissingCountryCode = !!waHref && !hasCountryCode(waNumber);

  const samples = (lead.buyerEnquiry?.lines ?? []).filter((l) => l.sampleRequest);
  const noteActivities = activities.filter((a) => a.activityType === "NOTE");
  const interactionActivities = activities.filter((a) => !(a.activityType === "NOTE" && a.subject?.startsWith("Stage changed:")));

  const activityList = (list: Activity[], empty: string) =>
    list.length === 0 ? (
      <p className="text-sm text-zinc-500">{empty}</p>
    ) : (
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
              <span className="font-medium uppercase">{humanizeStatus(a.activityType)}</span>
              <span>
                {new Date(a.activityAt).toLocaleString()} · {a.performedBy.fullName}
              </span>
            </div>
            {a.subject && <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-50">{a.subject}</p>}
            {a.body && <p className="mt-0.5 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{a.body}</p>}
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      {/* Header: status + owner + value + next follow-up */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STAGE_KIND_BADGE_CLASS[lead.stage.kind]}`}>{lead.stage.name}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${QUALITY_BADGE_CLASS[lead.quality]}`}>
          {QUALITY_LABELS[lead.quality]} · Score {Number(lead.leadScore).toFixed(0)}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${LEAD_PRIORITY_BADGE_CLASS[lead.priority]}`}>{LEAD_PRIORITY_LABELS[lead.priority]} priority</span>
        <Link href={`/leads/${lead.id}/edit`} className="ml-auto text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Edit
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Detail label="Owner" value={lead.assignedTo?.fullName ?? "Unassigned"} />
        <Detail label="Expected Value" value={`₹${formatNumber(lead.value)}`} />
        <Detail
          label="Next Follow-up"
          value={
            nextFollowup ? (
              <span className={isOverdue(nextFollowup) ? "font-medium text-red-600 dark:text-red-400" : ""}>
                {new Date(nextFollowup.followupDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {isOverdue(nextFollowup) ? " (overdue)" : ""}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">None scheduled</span>
            )
          }
        />
        <Detail
          label="Last Contact"
          value={
            lead.daysSinceLastActivity === null ? (
              <span className="font-medium text-red-600 dark:text-red-400">Never contacted</span>
            ) : (
              `${lead.daysSinceLastActivity}d ago · ${lead.daysInCurrentStage}d in stage`
            )
          }
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {callHref && (
          <a href={callHref} className={actionBtn}>
            Call
          </a>
        )}
        {mailHref && (
          <a href={mailHref} className={actionBtn}>
            Email
          </a>
        )}
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noreferrer"
            className={`${actionBtn} border-green-400 text-green-800 dark:border-green-800 dark:text-green-300`}
            title={waMissingCountryCode ? "This number has no country code — WhatsApp may not find it. Edit the lead to add +<country code>." : undefined}
          >
            WhatsApp{waMissingCountryCode ? " ⚠" : ""}
          </a>
        )}
        <button type="button" onClick={() => openActivity("CALL")} className={actionBtn}>
          Log Call
        </button>
        <button type="button" onClick={() => openActivity("NOTE")} className={actionBtn}>
          Add Note
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowFollowupModal(true);
          }}
          className={actionBtn}
        >
          Schedule Follow-up
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("Files");
            setFilePickerSignal((n) => n + 1);
          }}
          className={actionBtn}
        >
          Upload File
        </button>
        <Link href={`/deals/new?leadId=${lead.id}`} className={actionBtn}>
          Create Opportunity
        </Link>
        {lead.stage.kind !== "WON" && (
          <button
            type="button"
            onClick={() => {
              setTab("Overview");
              setStageIntent((p) => ({ kind: "WON", n: (p?.n ?? 0) + 1 }));
            }}
            className={`${actionBtn} border-green-500 text-green-700 dark:text-green-300`}
          >
            Mark Won
          </button>
        )}
        {lead.stage.kind !== "LOST" && (
          <button
            type="button"
            onClick={() => {
              setTab("Overview");
              setStageIntent((p) => ({ kind: "LOST", n: (p?.n ?? 0) + 1 }));
            }}
            className={`${actionBtn} border-red-400 text-red-700 dark:text-red-300`}
          >
            Mark Lost
          </button>
        )}
      </div>
      {waMissingCountryCode && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The WhatsApp number has no country code (+91, +44…). Add it on the lead so the WhatsApp button reaches the right person.
        </p>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Tabs */}
      <div className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-zinc-200 px-1 dark:border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
                tab === t ? "border-b-2 border-indigo-600 text-indigo-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {t}
              {t === "Follow-ups" && followups.some(isOverdue) ? <span className="ml-1 text-red-600">•</span> : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "Overview" && (
        <div className="space-y-4">
          <LeadStagePanel
            key={`${lead.stage.id}-${stageIntent?.n ?? 0}`}
            leadId={lead.id}
            currentStage={lead.stage}
            lostReason={lead.lostReason}
            lostCompetitor={lead.lostCompetitor}
            lostComment={lead.lostComment}
            intentKind={stageIntent?.kind}
          />
          <DetailGrid>
            <Detail label="Company" value={lead.companyName} />
            <Detail label="Contact Person" value={[lead.name, lead.designation].filter(Boolean).join(" · ")} />
            <Detail label="Business Type" value={lead.businessType ? BUSINESS_TYPE_LABELS[lead.businessType] : null} />
            <Detail label="Email" value={lead.email} />
            <Detail label="Mobile" value={lead.phone} />
            <Detail label="WhatsApp" value={lead.whatsappNumber} />
            <Detail label="Location" value={[lead.city, lead.state, lead.country].filter(Boolean).join(", ")} />
            <Detail label="Website" value={lead.website} />
            <Detail label="Source" value={lead.source?.name} />
            <Detail
              label="Campaign"
              value={
                lead.campaign ? (
                  <a href={`/campaigns/${lead.campaign.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {lead.campaign.name}
                  </a>
                ) : null
              }
            />
            <Detail label="Created by" value={`${lead.createdBy.fullName} · ${lead.daysSinceCreated}d ago`} />
            <Detail
              label="Buyer Enquiry"
              value={
                lead.buyerEnquiry ? (
                  <a href={`/buyer-enquiries/${lead.buyerEnquiry.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {lead.buyerEnquiry.enquiryNumber}
                  </a>
                ) : null
              }
            />
          </DetailGrid>
        </div>
      )}

      {tab === "Timeline" && <LeadTimelineTab leadId={lead.id} refreshSignal={timelineSignal} />}

      {tab === "Contacts" && (
        <LeadContactsTab
          leadId={lead.id}
          primary={{ name: lead.name, designation: lead.designation, email: lead.email, phone: lead.phone, whatsappNumber: lead.whatsappNumber }}
        />
      )}

      {tab === "Activities" && (
        <div className="space-y-3">
          <button type="button" onClick={() => openActivity("CALL")} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Log Activity
          </button>
          {activityList(interactionActivities, "No activity logged yet.")}
        </div>
      )}

      {tab === "Follow-ups" && (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowFollowupModal(true)} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Schedule Follow-up
          </button>
          {followups.length === 0 ? (
            <p className="text-sm text-zinc-500">No follow-ups scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {followups.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div>
                    <span className={isOverdue(f) ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}>
                      {new Date(f.followupDate).toLocaleString()}
                      {isOverdue(f) ? " · OVERDUE" : ""}
                    </span>{" "}
                    · {humanizeStatus(f.type)} · {humanizeStatus(f.status)}{" "}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_BADGE_CLASS[f.priority]}`}>{f.priority}</span>
                    {f.assignedTo && <span className="text-xs text-zinc-500"> · {f.assignedTo.fullName}</span>}
                    {f.notes && <p className="text-xs text-zinc-500">{f.notes}</p>}
                  </div>
                  {f.status === "PENDING" && (
                    <div className="flex gap-3">
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
      )}

      {tab === "Requirements" && (
        <DetailGrid>
          <Detail label="Product Category" value={lead.productCategory?.name} />
          <Detail label="Product Interest" value={lead.productInterests.map((p) => p.productType.name).join(", ")} />
          <Detail label="Season" value={lead.season?.name} />
          <Detail label="Market" value={lead.market} />
          <Detail label="Expected Quantity" value={lead.expectedQuantity != null ? `${lead.expectedQuantity.toLocaleString()} pcs` : null} />
          <Detail label="Target Price" value={lead.targetPrice != null ? `${lead.currencyCode ?? ""} ${formatNumber(lead.targetPrice)}`.trim() : null} />
          <Detail label="Expected Order Value" value={`₹${formatNumber(lead.value)}`} />
          <Detail label="MOQ Requirement" value={lead.moqRequirement} />
          <Detail label="Required Delivery" value={lead.requiredDeliveryDate ? new Date(lead.requiredDeliveryDate).toLocaleDateString() : null} />
          <Detail label="Expected Close" value={lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toLocaleDateString() : null} />
          <Detail label="Sampling Required" value={lead.samplingRequired ? "Yes" : "No"} />
          <Detail label="Tech Pack Available" value={lead.techPackAvailable ? "Yes" : "No"} />
          <Detail label="Reference Image Available" value={lead.referenceImageAvailable ? "Yes" : "No"} />
        </DetailGrid>
      )}

      {tab === "Samples" &&
        (samples.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No sample requests are linked to this lead yet.{" "}
            {lead.buyerEnquiry
              ? `Buyer enquiry ${lead.buyerEnquiry.enquiryNumber} has no converted lines yet.`
              : "Creating a sample request from a lead arrives with the Sampling integration."}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {samples.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 p-3">
                <a href={`/sampling/${l.sampleRequest!.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {l.sampleRequest!.requestNumber} — {l.sampleRequest!.styleName ?? l.styleNameFreeText ?? "Untitled"}
                </a>
                <span className="text-xs text-zinc-500">{humanizeStatus(l.sampleRequest!.status)}</span>
              </li>
            ))}
          </ul>
        ))}

      {tab === "Quotations" && <p className="text-sm text-zinc-500">CRM quotations arrive with the Quotation integration — none can be linked yet.</p>}

      {tab === "Opportunities" && (
        <div className="space-y-3">
          <Link href={`/deals/new?leadId=${lead.id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Create Opportunity
          </Link>
          {lead.deals.length === 0 ? (
            <p className="text-sm text-zinc-500">No opportunities from this lead yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
              {lead.deals.map((d) => (
                <li key={d.id} className="flex justify-between gap-2 p-3">
                  <a href={`/deals/${d.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {d.dealNumber} — {d.title}
                  </a>
                  <span className="text-xs text-zinc-500">
                    {humanizeStatus(d.stage)} · ₹{formatNumber(d.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "Files" && <LeadFilesTab leadId={lead.id} openPickerSignal={filePickerSignal} onChanged={() => setTimelineSignal((n) => n + 1)} />}

      {tab === "Notes" && (
        <div className="space-y-3">
          {lead.notes && (
            <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="text-xs font-medium uppercase text-zinc-500">Lead notes</div>
              <p className="mt-1 whitespace-pre-line text-zinc-800 dark:text-zinc-200">{lead.notes}</p>
            </div>
          )}
          <button type="button" onClick={() => openActivity("NOTE")} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            + Add Note
          </button>
          {activityList(noteActivities, "No notes yet.")}
        </div>
      )}

      <Modal open={showActivityModal} onClose={() => setShowActivityModal(false)} title={activityType === "CALL" ? "Log Call" : activityType === "NOTE" ? "Add Note" : "Log Activity"}>
        <div className="space-y-3">
          <FormField label="Type" htmlFor="activityType">
            <select id="activityType" value={activityType} onChange={(e) => setActivityType(e.target.value as InteractionType)} className={textInputClass()}>
              {INTERACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanizeStatus(t)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label={activityType === "NOTE" ? "Title" : "Outcome / Subject"} htmlFor="activitySubject">
            <input id="activitySubject" value={activitySubject} onChange={(e) => setActivitySubject(e.target.value)} className={textInputClass()} placeholder={activityType === "CALL" ? "e.g. Interested — wants summer knitwear catalogue" : undefined} />
          </FormField>
          <FormField label="Notes" htmlFor="activityBody">
            <textarea id="activityBody" value={activityBody} onChange={(e) => setActivityBody(e.target.value)} className={textInputClass()} rows={3} />
          </FormField>
          {activityType !== "NOTE" && (
            <FormField label="Next follow-up (optional)" htmlFor="activityNextFollowup">
              <input id="activityNextFollowup" type="datetime-local" value={activityNextFollowup} onChange={(e) => setActivityNextFollowup(e.target.value)} className={textInputClass()} />
            </FormField>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowActivityModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitActivity}
              disabled={!activitySubject.trim() && !activityBody.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Save
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
            <select id="followupType" value={followupType} onChange={(e) => setFollowupType(e.target.value as InteractionType)} className={textInputClass()}>
              {INTERACTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanizeStatus(t)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority" htmlFor="followupPriority">
            <select id="followupPriority" value={followupPriority} onChange={(e) => setFollowupPriority(e.target.value as typeof followupPriority)} className={textInputClass()}>
              {FOLLOWUP_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanizeStatus(p)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Notes" htmlFor="followupNotes">
            <textarea id="followupNotes" value={followupNotes} onChange={(e) => setFollowupNotes(e.target.value)} className={textInputClass()} rows={2} />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
