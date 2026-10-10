"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmCustomFieldValues } from "@/components/crm/CrmCustomFields";
import { CrmDocumentsPanel } from "@/components/crm/CrmDocumentsPanel";
import { CrmNotesPanel } from "@/components/crm/CrmNotesPanel";
import { ActivityPanel } from "@/components/crm/activities/ActivityPanel";
import { AppointmentPanel } from "@/components/crm/appointments/AppointmentPanel";
import { ConversationsPanel } from "@/components/crm/conversations/ConversationsPanel";
import { AssignOwnerModal, RecordTagsModal } from "@/components/crm/CrmRecordDialogs";
import { CrmRecordHeader } from "@/components/crm/CrmRecordHeader";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { crmRequest } from "@/components/crm/crm-api";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { isClosedStatus, OPPORTUNITY_STATUSES, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CompanyStatusBadge } from "../../companies/_components/CompaniesListClient";
import { CloseDate, OpportunityStatusBadge, opportunityValue } from "./OpportunityBadges";
import { ChangeOpportunityStatusModal, ChangeStageModal, ConvertToCustomerModal, LinkErpDocumentModal, TransferPipelineModal } from "./OpportunityDialogs";
import { OpportunityErpDocuments, OpportunityStageHistory, OpportunityUpcomingSections } from "./OpportunityRelatedPanels";
import type { OpportunityDetailDto, OpportunityPermissions } from "./opportunity-types";
import { useOpportunityLookups } from "./useOpportunityLookups";

const API = "/api/v1/crm/opportunities";

type Dialog =
  | null
  | { kind: "assign" | "tags" | "stage" | "transfer" | "archive" | "restore" | "linkErp" | "convertCustomer" }
  | { kind: "status"; status: OpportunityStatus }
  | { kind: "unlinkErp"; linkId: string; docNumber: string };

const dash = <span className="text-zinc-400">—</span>;
const linkClass = "text-indigo-600 hover:underline dark:text-indigo-400";
const smallButton = "text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400";
const mailto = (v: string | null) => (v ? <a href={`mailto:${v}`} className={linkClass}>{v}</a> : null);
const tel = (v: string | null) => (v ? <a href={`tel:${v}`} className={linkClass}>{v}</a> : null);

function Section({ title, id, children, action }: { title: string; id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{label}</dt>
          <dd className="mt-0.5 break-words text-sm text-zinc-900 dark:text-zinc-100">{value === null || value === undefined || value === "" ? dash : value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The deal-level CRM view: company, contact, pipeline, value, notes, documents, ERP references and timeline. */
export function OpportunityDetailClient({ initialOpportunity, permissions, currentUserId }: { initialOpportunity: OpportunityDetailDto; permissions: OpportunityPermissions; currentUserId: string }) {
  const { meta, users } = useOpportunityLookups();
  const [opp, setOpp] = useState(initialOpportunity);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const status = opp.status as OpportunityStatus;
  const archived = Boolean(opp.archivedAt);
  const closed = isClosedStatus(status);
  const canEdit = permissions.edit && !archived;
  const canEditDeal = canEdit && !closed;

  const reload = useCallback(async () => {
    const res = await crmRequest<OpportunityDetailDto>(`${API}/${opp.id}`);
    if (res.ok) setOpp(res.data);
    setRefreshKey((k) => k + 1);
  }, [opp.id]);
  const done = () => {
    setDialog(null);
    void reload();
  };

  useEffect(() => {
    if (window.location.hash === "#notes") document.getElementById("notes")?.scrollIntoView();
  }, []);

  const call = async (path: string, successMessage: string, method = "POST") => {
    setBusy(true);
    const res = await crmRequest(`${API}/${opp.id}/${path}`, { method, successMessage });
    setBusy(false);
    if (res.ok) done();
  };

  const menu: ActionMenuItem[] = [];
  if (canEdit) {
    if (!closed) {
      menu.push({ label: "Change stage", onClick: () => setDialog({ kind: "stage" }) });
      if ((meta?.pipelines.filter((p) => p.isActive).length ?? 0) > 1) menu.push({ label: "Move to another pipeline", onClick: () => setDialog({ kind: "transfer" }) });
      menu.push({ label: "Mark won", onClick: () => setDialog({ kind: "status", status: "WON" }) });
      menu.push({ label: "Mark lost", onClick: () => setDialog({ kind: "status", status: "LOST" }) });
      menu.push({ label: "Mark abandoned", onClick: () => setDialog({ kind: "status", status: "ABANDONED" }) });
    } else menu.push({ label: "Reopen", onClick: () => setDialog({ kind: "status", status: "OPEN" }) });
    if (status === "WON" && opp.crmCompanyId && !opp.crmCompany?.customer) menu.push({ label: "Convert to Customer", onClick: () => setDialog({ kind: "convertCustomer" }) });
    menu.push({ label: "Assign", onClick: () => setDialog({ kind: "assign" }) });
    menu.push({ label: "Edit tags", onClick: () => setDialog({ kind: "tags" }) });
    menu.push({ label: "Link ERP document", onClick: () => setDialog({ kind: "linkErp" }) });
    menu.push({ label: "Add note", onClick: () => document.getElementById("crm-note-new")?.focus() });
    menu.push({ label: "Archive", onClick: () => setDialog({ kind: "archive" }), danger: true });
  }

  const actions = (
    <>
      {archived && permissions.edit && (
        <Button variant="secondary" onClick={() => setDialog({ kind: "restore" })}>
          Restore
        </Button>
      )}
      {canEdit && closed && (
        <Button variant="secondary" onClick={() => setDialog({ kind: "status", status: "OPEN" })}>
          Reopen
        </Button>
      )}
      {canEditDeal && (
        <>
          <Button variant="secondary" onClick={() => setDialog({ kind: "status", status: "WON" })}>
            Mark won
          </Button>
          <Link href={`/crm/opportunities/${opp.id}/edit`} className={buttonClasses("secondary")}>
            Edit
          </Link>
        </>
      )}
      {menu.length > 0 && <ActionMenu items={menu} />}
    </>
  );

  const badges: { label: string; tone?: "neutral" | "indigo" | "green" | "amber" | "red" }[] = [{ label: OPPORTUNITY_STATUSES[status]?.label ?? status, tone: OPPORTUNITY_STATUSES[status]?.tone ?? "neutral" }];
  if (archived) badges.push({ label: "Archived", tone: "neutral" });
  const company = opp.crmCompany;
  const contact = opp.crmContact;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <CrmRecordHeader
          title={opp.name}
          subtitle={[opp.opportunityNumber, company?.name, contact?.fullName].filter(Boolean).join(" · ")}
          badges={badges}
          actions={actions}
          meta={[
            { label: "Value", value: opportunityValue(opp.amount, opp.currencyCode) ?? dash },
            { label: "Stage", value: opp.stage ? `${opp.stage.name}${opp.pipeline && (meta?.pipelines.length ?? 1) > 1 ? ` · ${opp.pipeline.name}` : ""}` : dash },
            { label: "Probability", value: opp.probability !== null ? `${opp.probability}%` : dash },
            { label: "Expected close", value: <CloseDate value={opp.expectedCloseDate} status={opp.status} /> },
            { label: "Owner", value: <OwnerName owner={opp.owner} inactive={opp.ownerInactive} /> },
            { label: "Source", value: opp.source?.name ?? dash },
            { label: "Last activity", value: opp.lastActivityAt ? <ClientDateTime value={opp.lastActivityAt} /> : dash },
            { label: "Created", value: <ClientDateTime value={opp.createdAt} mode="date" /> },
          ]}
        />
        {opp.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {opp.tags.map((t) => (
              <CrmBadge key={t.id} label={t.name} tone="indigo" />
            ))}
          </div>
        )}
        {closed && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            {OPPORTUNITY_STATUSES[status].label} on {opp.closedAt ? <ClientDateTime value={opp.closedAt} /> : "—"}
            {opp.closedByName ? ` by ${opp.closedByName}` : ""}
            {opp.closeReason ? ` — ${opp.closeReason}` : ""}. Reopen it to make changes.
          </p>
        )}
        {archived && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Archived {opp.archivedByName ? `by ${opp.archivedByName} ` : ""}on <ClientDateTime value={opp.archivedAt as string} />. Restore it to make changes; its history, documents and ERP references are kept.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Opportunity information">
            <Facts
              rows={[
                ["Pipeline", opp.pipeline?.name],
                ["Stage", opp.stage?.name],
                ["Stage since", opp.stageChangedAt ? <ClientDateTime key="s" value={opp.stageChangedAt} /> : null],
                ["Probability", opp.probability !== null ? `${opp.probability}%${opp.probabilitySource === "MANUAL" ? " (set by hand)" : opp.probabilitySource === "STAGE" ? " (stage default)" : ""}` : null],
                ["Estimated value", opportunityValue(opp.amount, opp.currencyCode)],
                ["Weighted value", opp.amount !== null && opp.probability !== null ? opportunityValue((Number(opp.amount) * opp.probability) / 100, opp.currencyCode) : null],
                ["Expected close", opp.expectedCloseDate ? opp.expectedCloseDate.slice(0, 10) : null],
                ["Status", <OpportunityStatusBadge key="st" status={opp.status} />],
              ]}
            />
          </Section>

          <Section title="Description">
            {opp.description ? <p className="whitespace-pre-line text-sm text-zinc-800 dark:text-zinc-100">{opp.description}</p> : <p className="text-sm text-zinc-500 dark:text-zinc-400">No description.</p>}
          </Section>

          <Section title="Custom fields">
            {meta ? <CrmCustomFieldValues definitions={meta.customFields} values={opp.customFields ?? {}} noun="opportunities" /> : <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
          </Section>

          <Section title="Appointments" id="appointments">
            <AppointmentPanel
              parent={{ entityType: "OPPORTUNITY", entityId: opp.id, label: opp.name }}
              canCreate={permissions.create && !archived}
              canEdit={permissions.edit}
              currentUserId={currentUserId}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </Section>

          <Section title="Conversations" id="conversations">
            <ConversationsPanel parent={{ entityType: "OPPORTUNITY", entityId: opp.id }} />
          </Section>

          <Section title="Activities & tasks" id="activities">
            <ActivityPanel
              parent={{ entityType: "OPPORTUNITY", entityId: opp.id, label: opp.name }}
              canCreate={permissions.create && !archived}
              canEdit={permissions.edit}
              currentUserId={currentUserId}
              onAddNote={() => document.getElementById("notes")?.scrollIntoView({ behavior: "smooth" })}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </Section>

          <Section title="Notes" id="notes">
            <CrmNotesPanel listUrl={`${API}/${opp.id}/notes`} canAdd={permissions.create && !archived} onChanged={() => setRefreshKey((k) => k + 1)} />
          </Section>

          <Section title="Stage history">
            <OpportunityStageHistory opportunityId={opp.id} refreshKey={refreshKey} />
          </Section>

          <Section title="Timeline">
            <CrmTimeline entityType="OPPORTUNITY" entityId={opp.id} refreshKey={refreshKey} emptyDescription="Changes to this opportunity will appear here." />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Company">
            {company ? (
              <Facts
                rows={[
                  ["Company", opp.companyVisible ? <Link key="c" href={`/crm/companies/${company.id}`} className={linkClass}>{company.name}</Link> : company.name],
                  ["Industry", company.industry],
                  ["Owner", company.owner?.fullName],
                  ["Status", company.status ? <CompanyStatusBadge key="s" status={company.status} /> : null],
                  ["Primary contact", company.primaryContact?.fullName],
                  ["ERP customer", company.customer?.code],
                ]}
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No company linked.</p>
            )}
            {company && (company.archivedAt || company.mergedIntoId) && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">This company is {company.mergedIntoId ? "merged" : "archived"}.</p>}
            {status === "WON" && company?.customer && (
              <Link
                href={`/sales-orders/new?customerId=${company.customer.id}&originatingOpportunityId=${opp.id}&originatingOpportunityNumber=${encodeURIComponent(opp.opportunityNumber)}`}
                className="mt-3 inline-block text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Create Sales Order →
              </Link>
            )}
          </Section>

          <Section title="Primary contact">
            {contact ? (
              <Facts
                rows={[
                  ["Name", opp.contactVisible ? <Link key="c" href={`/crm/contacts/${contact.id}`} className={linkClass}>{contact.fullName}</Link> : contact.fullName],
                  ["Designation", contact.designation],
                  ["Email", opp.contactVisible ? mailto(contact.email) : null],
                  ["Phone", opp.contactVisible ? tel(contact.mobile ?? contact.phone) : null],
                  ["Company", contact.crmCompany?.name],
                ]}
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No contact linked.</p>
            )}
          </Section>

          <Section
            title="Quotation & ERP documents"
            action={
              canEdit ? (
                <button type="button" className={smallButton} onClick={() => setDialog({ kind: "linkErp" })}>
                  + Link
                </button>
              ) : undefined
            }
          >
            <OpportunityErpDocuments opportunityId={opp.id} refreshKey={refreshKey} canEdit={canEdit} onUnlink={(r) => setDialog({ kind: "unlinkErp", ...r })} />
          </Section>

          <Section title="Attachments">
            <CrmDocumentsPanel baseUrl={`${API}/${opp.id}`} canUpload={permissions.create && !archived} canEdit={canEdit} viewAll={permissions.viewAll} currentUserId={currentUserId} onChanged={() => setRefreshKey((k) => k + 1)} />
          </Section>

          <Section title="Coming in later phases">
            <OpportunityUpcomingSections />
          </Section>

          <Section title="Record">
            <Facts
              rows={[
                [
                  "Origin",
                  opp.lead ? (
                    <span key="o">
                      From lead{" "}
                      <Link href={`/crm/leads/${opp.lead.id}`} className={linkClass}>
                        {opp.lead.leadNumber}
                      </Link>
                    </span>
                  ) : (
                    "Created directly"
                  ),
                ],
                [
                  "Created",
                  <span key="c">
                    <ClientDateTime value={opp.createdAt} /> by {opp.createdBy.fullName}
                  </span>,
                ],
                [
                  "Last updated",
                  <span key="u">
                    <ClientDateTime value={opp.updatedAt} />
                    {opp.updatedByName ? ` by ${opp.updatedByName}` : ""}
                  </span>,
                ],
              ]}
            />
          </Section>
        </div>
      </div>

      {dialog?.kind === "assign" && <AssignOwnerModal apiBase={API} noun="opportunity" onClose={() => setDialog(null)} users={users} target={{ recordId: opp.id, version: opp.version }} currentOwnerId={opp.ownerUserId} onDone={done} />}
      {dialog?.kind === "tags" && <RecordTagsModal apiBase={API} noun="opportunity" onClose={() => setDialog(null)} target={{ recordId: opp.id }} currentTags={opp.tags} onDone={done} />}
      {dialog?.kind === "stage" && meta && (
        <ChangeStageModal pipelines={meta.pipelines} target={{ recordId: opp.id, version: opp.version }} current={{ pipelineId: opp.pipelineId, stageId: opp.stageId, probability: opp.probability, probabilitySource: opp.probabilitySource }} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === "transfer" && meta && <TransferPipelineModal pipelines={meta.pipelines} target={{ recordId: opp.id, version: opp.version }} currentPipelineId={opp.pipelineId} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "status" && (
        <ChangeOpportunityStatusModal target={{ recordId: opp.id, version: opp.version }} current={status} initialStatus={dialog.status} reasons={meta?.suggestions.opportunity_close_reason ?? []} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === "linkErp" && <LinkErpDocumentModal opportunityId={opp.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "convertCustomer" && <ConvertToCustomerModal opportunityId={opp.id} onClose={() => setDialog(null)} onDone={done} />}
      <ConfirmModal
        open={dialog?.kind === "unlinkErp"}
        title="Unlink ERP document?"
        message={dialog?.kind === "unlinkErp" ? `${dialog.docNumber} will no longer be referenced by this opportunity. The ERP document itself is not changed.` : ""}
        confirmLabel="Unlink"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "unlinkErp" && call(`erp-documents/${dialog.linkId}`, "ERP document unlinked.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive opportunity?"
        message={`${opp.name} will be hidden from active lists. Its timeline, notes, documents, tags and ERP references are kept; nothing changes in the ERP. You can restore it later.`}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => call("archive", "Opportunity archived.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore opportunity?"
        message={`${opp.name} will be active again.`}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => call("restore", "Opportunity restored.")}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
