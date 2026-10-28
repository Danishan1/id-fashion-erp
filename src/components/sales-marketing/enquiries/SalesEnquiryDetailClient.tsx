"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AttachmentsPanel } from "@/components/ui/AttachmentsPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { LINE_STATUS_BADGE_CLASS, LINE_STATUS_LABELS } from "@/app/(dashboard)/buyer-enquiries/statusLabels";
import {
  ENQUIRY_SOURCES,
  MANUAL_ACTIVITY_TYPES,
  REOPENABLE_STAGES,
  SALES_ENQUIRY_ACTIVITY_TYPES,
  SALES_ENQUIRY_STAGES,
  SALES_ENQUIRY_TRANSITIONS,
  SAMPLING_STATUS_LABELS,
  STAGES_REQUIRING_REASON,
  type EnquirySourceKey,
  type ManualStageTarget,
  type SalesEnquiryActivityType,
  type SalesEnquiryPriority,
  type SalesEnquiryStage,
} from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";
import type { SalesMarketingPagePermissions } from "@/modules/sales-marketing/sales-marketing-page";
import { CrmLinkFields, PrioritySelect, useEnquiryOwners } from "./SalesEnquiryFields";
import { QuotationStatusBadge, formatInr } from "@/components/sales-marketing/quotations/QuotationStatusBadge";
import type { QuotationStatus } from "@/modules/sales-marketing/quotations/quotation-registry";
import { PriorityBadge, StageBadge } from "./SalesEnquiryBadges";

interface Activity {
  id: string;
  type: SalesEnquiryActivityType;
  body: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdBy: { id: string; fullName: string } | null;
}

interface EnquiryLine {
  id: string;
  styleNameFreeText: string | null;
  description: string | null;
  colorRemarks: string | null;
  targetQuantity: string | null;
  targetUnitPrice: string | null;
  targetDeliveryDate: string | null;
  remarks: string | null;
  lineStatus: keyof typeof LINE_STATUS_LABELS;
  product: { id: string; styleName: string; styleCode: string } | null;
  size: { id: string; name: string } | null;
  sampleRequest: { id: string; requestNumber: string; status: string } | null;
}

interface LinkedOpportunity {
  linkId: string;
  linkedAt: string;
  opportunity: { id: string; opportunityNumber: string; name: string; status: string; amount: string | null; currencyCode: string | null; archived: boolean };
}

export interface SalesEnquiryDetail {
  id: string;
  enquiryNumber: string;
  subject: string | null;
  enquiryDate: string;
  createdAt: string;
  source: EnquirySourceKey;
  status: keyof typeof SAMPLING_STATUS_LABELS;
  salesStage: SalesEnquiryStage;
  stageBeforeHold: SalesEnquiryStage | null;
  priority: SalesEnquiryPriority;
  nextFollowUpDate: string | null;
  isOverdue: boolean;
  remarks: string | null;
  estimatedValue: string | null;
  expectedDecisionDate: string | null;
  nextAction: string | null;
  qualificationNotes: string | null;
  closureReason: string | null;
  closedAt: string | null;
  prospectName: string | null;
  prospectContactPerson: string | null;
  prospectEmail: string | null;
  prospectPhone: string | null;
  prospectCountry: string | null;
  customer: { id: string; name: string; code: string } | null;
  buyer: { id: string; name: string } | null;
  requestedBy: { id: string; fullName: string };
  owner: { id: string; fullName: string } | null;
  crmCompany: { id: string; name: string; archivedAt: string | null; mergedIntoId: string | null } | null;
  crmContact: { id: string; fullName: string; archivedAt: string | null; mergedIntoId: string | null } | null;
  lines: EnquiryLine[];
  activities: Activity[];
  opportunities: { visible: LinkedOpportunity[]; hiddenCount: number };
}

const CARD = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const money = (v: string | null) => (v === null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const dateInput = (v: string | null) => (v ? v.slice(0, 10) : "");

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "x-toast": "off" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, message: await getApiErrorMessage(res) };
  const json = await res.json().catch(() => ({}));
  return { ok: true, data: json.data };
}

export interface EnquiryQuotationRow {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  owner: { fullName: string } | null;
  current: { revisionNumber: number; title: string; validUntil: string; grandTotal: string } | null;
}

/** Stages from which a quotation can be started (mirrors QUOTABLE_STAGES in the service). */
const QUOTABLE: readonly SalesEnquiryStage[] = ["NEW", "UNDER_REVIEW", "QUALIFIED", "QUOTATION_IN_PROGRESS", "QUOTED"];

export function SalesEnquiryDetailClient({
  initialEnquiry,
  quotations = null,
  permissions,
  currentUserId,
}: {
  initialEnquiry: SalesEnquiryDetail;
  /** null = the viewer can't see quotations. */
  quotations?: EnquiryQuotationRow[] | null;
  permissions: SalesMarketingPagePermissions;
  currentUserId: string;
}) {
  const router = useRouter();
  const [enquiry, setEnquiry] = useState(initialEnquiry);
  const [modal, setModal] = useState<null | "stage" | "reopen" | "edit" | "assign" | "opportunity">(null);
  const [stageTarget, setStageTarget] = useState<ManualStageTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const base = `/api/v1/sales-marketing/enquiries/${enquiry.id}`;
  const cancelled = enquiry.status === "CANCELLED";
  const stageMeta = SALES_ENQUIRY_STAGES[enquiry.salesStage];
  const canAct = permissions.edit && !cancelled;
  const isOpen = !stageMeta.closed;
  const targets = canAct ? SALES_ENQUIRY_TRANSITIONS[enquiry.salesStage] : [];

  const apply = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setActionError(null);
    const result = await send(url, method, body);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.message);
      return false;
    }
    if ((result.data as { visible?: boolean })?.visible === false) {
      // Reassigned to someone outside the caller's own scope.
      toast.success("Enquiry reassigned. It is no longer in your list.");
      router.push("/sales-marketing/enquiries");
      return true;
    }
    setEnquiry(result.data as SalesEnquiryDetail);
    return true;
  };

  const openStage = (target: ManualStageTarget) => {
    setStageTarget(target);
    setActionError(null);
    setModal("stage");
  };
  const close = () => {
    setModal(null);
    setActionError(null);
  };

  return (
    <div className="space-y-4">
      {cancelled && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          This enquiry was cancelled in Merchandising. Its sales details are read-only.
        </p>
      )}

      {/* Status bar */}
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <StageBadge stage={enquiry.salesStage} />
            {enquiry.salesStage === "ON_HOLD" && enquiry.stageBeforeHold && (
              <span className="text-xs text-zinc-500">from {SALES_ENQUIRY_STAGES[enquiry.stageBeforeHold].label}</span>
            )}
          </div>
          <PriorityBadge priority={enquiry.priority} />
          <span className="text-zinc-600 dark:text-zinc-300">
            Owner: <strong className="font-medium">{enquiry.owner?.fullName ?? "Unassigned"}</strong>
          </span>
          <span className={enquiry.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}>
            Follow-up: {enquiry.nextFollowUpDate ? formatDate(enquiry.nextFollowUpDate) : "not set"}
            {enquiry.isOverdue && " · overdue"}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Sampling: {SAMPLING_STATUS_LABELS[enquiry.status] ?? enquiry.status}</span>
        </div>
        {canAct && (
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((t) => (
              <Button key={t} size="xs" variant={t === "LOST" ? "danger" : "secondary"} onClick={() => openStage(t)} disabled={busy}>
                {t === "ON_HOLD" ? "Put on hold" : t === "QUALIFIED" ? "Mark qualified" : t === "UNDER_REVIEW" ? "Start review" : `Mark ${SALES_ENQUIRY_STAGES[t].label.toLowerCase()}`}
              </Button>
            ))}
            {enquiry.salesStage === "ON_HOLD" && (
              <Button size="xs" onClick={() => apply(`${base}/resume`, "POST")} isLoading={busy}>
                Resume
              </Button>
            )}
            {REOPENABLE_STAGES.includes(enquiry.salesStage) && (
              <Button size="xs" onClick={() => (setActionError(null), setModal("reopen"))}>
                Reopen
              </Button>
            )}
            {isOpen && (
              <>
                <Button size="xs" variant="secondary" onClick={() => (setActionError(null), setModal("assign"))}>
                  {enquiry.owner ? "Reassign" : "Assign"}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => (setActionError(null), setModal("edit"))}>
                  Edit details
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {actionError && !modal && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
      {stageMeta.closed && enquiry.closureReason && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {stageMeta.label}
          {enquiry.closedAt ? ` on ${formatDate(enquiry.closedAt)}` : ""}: {enquiry.closureReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Enquiry">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Field label="Customer / prospect">
                {enquiry.customer ? (
                  enquiry.customer.name
                ) : (
                  <>
                    {enquiry.prospectName ?? "—"} <span className="text-xs text-amber-600 dark:text-amber-400">(prospect)</span>
                  </>
                )}
              </Field>
              <Field label="Buyer">{enquiry.buyer?.name ?? "—"}</Field>
              <Field label="Source">{ENQUIRY_SOURCES[enquiry.source] ?? enquiry.source}</Field>
              {!enquiry.customer && (
                <>
                  <Field label="Contact person">{enquiry.prospectContactPerson ?? "—"}</Field>
                  <Field label="Email / phone">{[enquiry.prospectEmail, enquiry.prospectPhone].filter(Boolean).join(" · ") || "—"}</Field>
                  <Field label="Country">{enquiry.prospectCountry ?? "—"}</Field>
                </>
              )}
              <Field label="Received">{formatDate(enquiry.enquiryDate)}</Field>
              <Field label="Logged by">{enquiry.requestedBy.fullName}</Field>
              <Field label="Remarks">{enquiry.remarks ?? "—"}</Field>
            </dl>
          </Section>

          <Section title="Qualification">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Field label="Estimated value">{money(enquiry.estimatedValue)}</Field>
              <Field label="Expected decision">{enquiry.expectedDecisionDate ? formatDate(enquiry.expectedDecisionDate) : "—"}</Field>
              <Field label="Next action">{enquiry.nextAction ?? "—"}</Field>
              <div className="sm:col-span-3">
                <Field label="Notes">
                  <span className="whitespace-pre-wrap">{enquiry.qualificationNotes ?? "—"}</span>
                </Field>
              </div>
            </dl>
          </Section>

          <Section
            title={`Requested items (${enquiry.lines.length})`}
            actions={
              permissions.merchandisingView ? (
                <Link href={`/buyer-enquiries/${enquiry.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
                  Line review & sampling in Merchandising →
                </Link>
              ) : undefined
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="py-2 pr-3 font-medium">Style</th>
                    <th className="py-2 pr-3 font-medium">Colour / size</th>
                    <th className="py-2 pr-3 text-right font-medium">Qty</th>
                    <th className="py-2 pr-3 text-right font-medium">Target price</th>
                    <th className="py-2 pr-3 font-medium">Delivery</th>
                    <th className="py-2 font-medium">Line status</th>
                  </tr>
                </thead>
                <tbody>
                  {enquiry.lines.map((line) => (
                    <tr key={line.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{line.product ? `${line.product.styleName} (${line.product.styleCode})` : line.styleNameFreeText ?? "—"}</div>
                        {!line.product && <div className="text-xs text-amber-600 dark:text-amber-400">New style</div>}
                        {line.description && <div className="text-xs text-zinc-500 dark:text-zinc-400">{line.description}</div>}
                      </td>
                      <td className="py-2 pr-3">{[line.colorRemarks, line.size?.name].filter(Boolean).join(" / ") || "—"}</td>
                      <td className="py-2 pr-3 text-right">{line.targetQuantity !== null ? Number(line.targetQuantity).toLocaleString("en-IN") : "—"}</td>
                      <td className="py-2 pr-3 text-right">{money(line.targetUnitPrice)}</td>
                      <td className="py-2 pr-3">{line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "—"}</td>
                      <td className="py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LINE_STATUS_BADGE_CLASS[line.lineStatus]}`}>{LINE_STATUS_LABELS[line.lineStatus]}</span>
                        {line.sampleRequest && <div className="mt-1 text-xs text-zinc-500">Sample {line.sampleRequest.requestNumber}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {quotations && (
            <Section
              title={`Quotations (${quotations.length})`}
              actions={
                permissions.quotations.create && !cancelled && QUOTABLE.includes(enquiry.salesStage) ? (
                  <Link href={`/sales-marketing/quotations/new?enquiryId=${enquiry.id}`} className={buttonClasses("primary", "xs")}>
                    Create quotation
                  </Link>
                ) : undefined
              }
            >
              {quotations.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No quotations yet.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {quotations.map((q) => (
                    <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/sales-marketing/quotations/${q.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {q.quotationNumber}
                        {q.current && q.current.revisionNumber > 1 && ` rev ${q.current.revisionNumber}`}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300">{q.current?.title}</span>
                      <QuotationStatusBadge status={q.status} />
                      <span className="tabular-nums">{formatInr(q.current?.grandTotal)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <ActivityTimeline enquiryId={enquiry.id} activities={enquiry.activities} createdAt={enquiry.createdAt} createdBy={enquiry.requestedBy.fullName} canAdd={canAct} onAdded={(a) => setEnquiry((e) => ({ ...e, activities: [a, ...e.activities] }))} />
        </div>

        <div className="space-y-4">
          <Section title="CRM">
            <dl className="space-y-3">
              <Field label="Company">
                {enquiry.crmCompany ? (
                  permissions.crmView ? (
                    <Link href={`/crm/companies/${enquiry.crmCompany.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {enquiry.crmCompany.name}
                    </Link>
                  ) : (
                    enquiry.crmCompany.name
                  )
                ) : (
                  "—"
                )}
                {enquiry.crmCompany?.mergedIntoId && <span className="ml-1 text-xs text-amber-600">(merged — relink)</span>}
                {enquiry.crmCompany?.archivedAt && <span className="ml-1 text-xs text-zinc-500">(archived)</span>}
              </Field>
              <Field label="Contact">
                {enquiry.crmContact ? (
                  permissions.crmView ? (
                    <Link href={`/crm/contacts/${enquiry.crmContact.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {enquiry.crmContact.fullName}
                    </Link>
                  ) : (
                    enquiry.crmContact.fullName
                  )
                ) : (
                  "—"
                )}
                {enquiry.crmContact?.mergedIntoId && <span className="ml-1 text-xs text-amber-600">(merged — relink)</span>}
              </Field>
              <Field label="Opportunities">
                {enquiry.opportunities.visible.length === 0 && enquiry.opportunities.hiddenCount === 0 && "—"}
                <ul className="space-y-1">
                  {enquiry.opportunities.visible.map((o) => (
                    <li key={o.linkId} className="flex items-start justify-between gap-2">
                      <Link href={`/crm/opportunities/${o.opportunity.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {o.opportunity.opportunityNumber} · {o.opportunity.name}
                        <span className="ml-1 text-xs text-zinc-500">({o.opportunity.status.toLowerCase()})</span>
                      </Link>
                      {canAct && permissions.crmEdit && (
                        <button
                          type="button"
                          className="text-xs text-red-600 hover:text-red-500"
                          disabled={busy}
                          onClick={() => apply(`${base}/opportunities/${o.linkId}`, "DELETE")}
                        >
                          Unlink
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {enquiry.opportunities.hiddenCount > 0 && (
                  <p className="text-xs text-zinc-500">
                    {enquiry.opportunities.hiddenCount} more linked opportunit{enquiry.opportunities.hiddenCount === 1 ? "y" : "ies"} you can&apos;t see in the CRM.
                  </p>
                )}
              </Field>
            </dl>
            {canAct && permissions.crmEdit && (
              <Button size="xs" variant="secondary" className="mt-3" onClick={() => (setActionError(null), setModal("opportunity"))}>
                Link opportunity
              </Button>
            )}
          </Section>

          <AttachmentsPanel
            module="buyer-enquiry"
            recordId={enquiry.id}
            canEdit={canAct}
            title="Attachments"
            labelForContext={(c) => SALES_ENQUIRY_STAGES[c as SalesEnquiryStage]?.label ?? c}
          />
        </div>
      </div>

      {modal === "stage" && stageTarget && (
        <StageModal
          target={stageTarget}
          error={actionError}
          busy={busy}
          onClose={close}
          onSubmit={async (reason) => (await apply(`${base}/stage`, "POST", { stage: stageTarget, reason })) && close()}
        />
      )}
      {modal === "reopen" && (
        <ReasonModal
          title="Reopen enquiry"
          help="It goes back to Under review. The reason is kept in the timeline and audit log."
          label="Why is it being reopened?"
          submitLabel="Reopen"
          error={actionError}
          busy={busy}
          onClose={close}
          onSubmit={async (reason) => (await apply(`${base}/reopen`, "POST", { reason })) && close()}
        />
      )}
      {modal === "assign" && (
        <AssignModal
          current={enquiry.owner?.id ?? ""}
          currentUserId={currentUserId}
          error={actionError}
          busy={busy}
          onClose={close}
          onSubmit={async (ownerUserId) => (await apply(`${base}/assign`, "POST", { ownerUserId: ownerUserId || null })) && close()}
        />
      )}
      {modal === "edit" && (
        <EditDetailsModal
          enquiry={enquiry}
          canUseCrm={permissions.crmView}
          error={actionError}
          busy={busy}
          onClose={close}
          onSubmit={async (patch) => (await apply(base, "PATCH", patch)) && close()}
        />
      )}
      {modal === "opportunity" && (
        <OpportunityModal
          linkedIds={enquiry.opportunities.visible.map((o) => o.opportunity.id)}
          error={actionError}
          busy={busy}
          onClose={close}
          onSubmit={async (opportunityId) => (await apply(`${base}/opportunities`, "POST", { opportunityId })) && close()}
        />
      )}
    </div>
  );
}

// ── Timeline ─────────────────────────────────────────────────────

function describe(a: Activity): string {
  const m = a.metadata ?? {};
  const stage = (k: unknown) => SALES_ENQUIRY_STAGES[k as SalesEnquiryStage]?.label ?? String(k ?? "—");
  switch (a.type) {
    case "STAGE_CHANGED":
      return m.reopened ? `Reopened (was ${stage(m.from)})` : m.resumed ? `Resumed — back to ${stage(m.to)}` : `${stage(m.from)} → ${stage(m.to)}`;
    case "OWNER_CHANGED":
      return `Owner: ${(m.fromName as string) ?? "unassigned"} → ${(m.toName as string) ?? "unassigned"}`;
    case "FOLLOW_UP_CHANGED":
      return `Follow-up: ${m.from ? formatDate(String(m.from)) : "none"} → ${m.to ? formatDate(String(m.to)) : "none"}`;
    case "DETAILS_UPDATED":
      return `Updated ${a.body ?? "details"}`;
    default:
      return SALES_ENQUIRY_ACTIVITY_TYPES[a.type]?.label ?? a.type;
  }
}

function ActivityTimeline({
  enquiryId,
  activities,
  createdAt,
  createdBy,
  canAdd,
  onAdded,
}: {
  enquiryId: string;
  activities: Activity[];
  createdAt: string;
  createdBy: string;
  canAdd: boolean;
  onAdded: (a: Activity) => void;
}) {
  const [type, setType] = useState<(typeof MANUAL_ACTIVITY_TYPES)[number]>("NOTE");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const result = await send(`/api/v1/sales-marketing/enquiries/${enquiryId}/activities`, "POST", { type, body });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onAdded(result.data as Activity);
    setBody("");
  };

  return (
    <Section title="Activity">
      {canAdd && (
        <form onSubmit={submit} className="mb-4 space-y-2">
          <div className="flex gap-2">
            <select aria-label="Activity type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={`${textInputClass()} !w-36`}>
              {MANUAL_ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SALES_ENQUIRY_ACTIVITY_TYPES[t].label}
                </option>
              ))}
            </select>
            <input
              aria-label="Activity text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              placeholder={type === "NOTE" ? "Add an internal note…" : "What was discussed?"}
              className={textInputClass()}
            />
            <Button type="submit" size="sm" isLoading={busy} loadingLabel="Saving…" disabled={!body.trim()}>
              Add
            </Button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}
      <ol className="space-y-3">
        {activities.map((a) => {
          const manual = SALES_ENQUIRY_ACTIVITY_TYPES[a.type]?.manual;
          return (
            <li key={a.id} className="flex gap-3 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${manual ? "bg-indigo-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
              <div className="min-w-0">
                <div className="text-zinc-900 dark:text-zinc-100">
                  <span className="font-medium">{manual ? SALES_ENQUIRY_ACTIVITY_TYPES[a.type].label : describe(a)}</span>
                  {(manual || (a.type === "STAGE_CHANGED" && a.body) || a.type.startsWith("OPPORTUNITY")) && a.body && (
                    <span className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{manual ? `: ${a.body}` : ` — ${a.body}`}</span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {a.createdBy?.fullName ?? "—"} · {formatDateTime(a.occurredAt)}
                </div>
              </div>
            </li>
          );
        })}
        <li className="flex gap-3 text-sm">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          <div>
            <div className="font-medium text-zinc-900 dark:text-zinc-100">Enquiry logged</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {createdBy} · {formatDateTime(createdAt)}
            </div>
          </div>
        </li>
      </ol>
    </Section>
  );
}

// ── Modals ───────────────────────────────────────────────────────

function ModalActions({ busy, submitLabel, onClose, variant = "primary" }: { busy: boolean; submitLabel: string; onClose: () => void; variant?: "primary" | "danger" }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant={variant} isLoading={busy} loadingLabel="Saving…">
        {submitLabel}
      </Button>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null;
}

function StageModal({ target, error, busy, onClose, onSubmit }: { target: ManualStageTarget; error: string | null; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const required = STAGES_REQUIRING_REASON.includes(target);
  const label = SALES_ENQUIRY_STAGES[target].label;
  return (
    <Modal open onClose={onClose} title={target === "ON_HOLD" ? "Put on hold" : `Mark ${label.toLowerCase()}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason.trim());
        }}
      >
        <FormField label={required ? "Reason" : "Reason (optional)"} htmlFor="stage-reason" required={required}>
          <textarea id="stage-reason" rows={3} required={required} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} />
        </FormField>
        {target === "ON_HOLD" && <p className="text-xs text-zinc-500">Resume brings it back to its current stage.</p>}
        <ErrorLine error={error} />
        <ModalActions busy={busy} submitLabel="Confirm" onClose={onClose} variant={target === "LOST" ? "danger" : "primary"} />
      </form>
    </Modal>
  );
}

function ReasonModal({ title, help, label, submitLabel, error, busy, onClose, onSubmit }: { title: string; help: string; label: string; submitLabel: string; error: string | null; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason.trim());
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{help}</p>
        <FormField label={label} htmlFor="reason" required>
          <textarea id="reason" rows={3} required minLength={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} />
        </FormField>
        <ErrorLine error={error} />
        <ModalActions busy={busy} submitLabel={submitLabel} onClose={onClose} />
      </form>
    </Modal>
  );
}

function AssignModal({ current, currentUserId, error, busy, onClose, onSubmit }: { current: string; currentUserId: string; error: string | null; busy: boolean; onClose: () => void; onSubmit: (ownerUserId: string) => void }) {
  const owners = useEnquiryOwners();
  const [ownerUserId, setOwnerUserId] = useState(current);
  return (
    <Modal open onClose={onClose} title="Assign owner">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(ownerUserId);
        }}
      >
        <FormField label="Owner" htmlFor="owner">
          <SearchableSelect
            id="owner"
            value={ownerUserId}
            onChange={setOwnerUserId}
            options={owners.map((o) => ({ id: o.id, label: o.id === currentUserId ? `${o.fullName} (me)` : o.fullName }))}
            placeholder="Search user…"
            emptyOptionLabel="— Unassigned —"
          />
        </FormField>
        <p className="text-xs text-zinc-500">The new owner gets a notification.</p>
        <ErrorLine error={error} />
        <ModalActions busy={busy} submitLabel="Save" onClose={onClose} />
      </form>
    </Modal>
  );
}

function EditDetailsModal({
  enquiry,
  canUseCrm,
  error,
  busy,
  onClose,
  onSubmit,
}: {
  enquiry: SalesEnquiryDetail;
  canUseCrm: boolean;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (patch: Record<string, unknown>) => void;
}) {
  const [subject, setSubject] = useState(enquiry.subject ?? "");
  const [priority, setPriority] = useState<SalesEnquiryPriority>(enquiry.priority);
  const [nextFollowUpDate, setNextFollowUpDate] = useState(dateInput(enquiry.nextFollowUpDate));
  const [crm, setCrm] = useState({ crmCompanyId: enquiry.crmCompany?.id ?? "", crmContactId: enquiry.crmContact?.id ?? "" });
  const [estimatedValue, setEstimatedValue] = useState(enquiry.estimatedValue ?? "");
  const [expectedDecisionDate, setExpectedDecisionDate] = useState(dateInput(enquiry.expectedDecisionDate));
  const [nextAction, setNextAction] = useState(enquiry.nextAction ?? "");
  const [qualificationNotes, setQualificationNotes] = useState(enquiry.qualificationNotes ?? "");
  const [remarks, setRemarks] = useState(enquiry.remarks ?? "");

  return (
    <Modal open onClose={onClose} title="Edit enquiry details" maxWidthClass="max-w-2xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            subject,
            priority,
            nextFollowUpDate,
            ...(canUseCrm ? crm : {}),
            estimatedValue: estimatedValue === "" ? "" : Number(estimatedValue),
            expectedDecisionDate,
            nextAction,
            qualificationNotes,
            remarks,
          });
        }}
      >
        <FormField label="Subject" htmlFor="edit-subject">
          <input id="edit-subject" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={textInputClass()} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Priority" htmlFor="edit-priority">
            <PrioritySelect id="edit-priority" value={priority} onChange={setPriority} />
          </FormField>
          <FormField label="Next follow-up" htmlFor="edit-follow-up">
            <input id="edit-follow-up" type="date" value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className={textInputClass()} />
          </FormField>
        </div>
        {canUseCrm && (
          <CrmLinkFields
            crmCompanyId={crm.crmCompanyId}
            crmContactId={crm.crmContactId}
            onChange={setCrm}
            initialCompany={enquiry.crmCompany}
            initialContact={enquiry.crmContact}
          />
        )}
        <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Qualification</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Estimated value (₹)" htmlFor="edit-value">
            <input id="edit-value" type="number" min={0} step="0.01" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Expected decision" htmlFor="edit-decision">
            <input id="edit-decision" type="date" value={expectedDecisionDate} onChange={(e) => setExpectedDecisionDate(e.target.value)} className={textInputClass()} />
          </FormField>
        </div>
        <FormField label="Next action" htmlFor="edit-next-action">
          <input id="edit-next-action" maxLength={500} value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Qualification notes" htmlFor="edit-notes">
          <textarea id="edit-notes" rows={3} maxLength={4000} value={qualificationNotes} onChange={(e) => setQualificationNotes(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Remarks" htmlFor="edit-remarks">
          <input id="edit-remarks" maxLength={2000} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} />
        </FormField>
        <ErrorLine error={error} />
        <ModalActions busy={busy} submitLabel="Save" onClose={onClose} />
      </form>
    </Modal>
  );
}

interface OpportunityRow {
  id: string;
  opportunityNumber: string;
  name: string;
  status: string;
}

function OpportunityModal({ linkedIds, error, busy, onClose, onSubmit }: { linkedIds: string[]; error: string | null; busy: boolean; onClose: () => void; onSubmit: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<OpportunityRow[] | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ pageSize: "20", ...(search.trim() ? { search: search.trim() } : {}) });
      fetch(`/api/v1/crm/opportunities?${qs}`, { headers: { "x-toast": "off" } })
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => setRows(body.data ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <Modal open onClose={onClose} title="Link CRM opportunity" maxWidthClass="max-w-lg">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) onSubmit(selected);
        }}
      >
        <input aria-label="Search opportunities" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by number, name or company…" className={textInputClass()} />
        <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          {rows === null && <p className="p-3 text-sm text-zinc-500">Loading…</p>}
          {rows?.length === 0 && <p className="p-3 text-sm text-zinc-500">No opportunities found.</p>}
          {rows?.map((r) => {
            const linked = linkedIds.includes(r.id);
            return (
              <label key={r.id} className={`flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm last:border-0 dark:border-zinc-800 ${linked ? "opacity-50" : ""}`}>
                <input type="radio" name="opportunity" value={r.id} disabled={linked} checked={selected === r.id} onChange={() => setSelected(r.id)} />
                <span>
                  {r.opportunityNumber} · {r.name} <span className="text-xs text-zinc-500">({r.status.toLowerCase()}{linked ? ", already linked" : ""})</span>
                </span>
              </label>
            );
          })}
        </div>
        <ErrorLine error={error} />
        <ModalActions busy={busy} submitLabel="Link" onClose={onClose} />
      </form>
    </Modal>
  );
}
