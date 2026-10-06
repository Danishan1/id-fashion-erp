"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmCustomFieldValues } from "@/components/crm/CrmCustomFields";
import { CrmDocumentsPanel } from "@/components/crm/CrmDocumentsPanel";
import { CrmErpReferencesPanel } from "@/components/crm/CrmErpReferencesPanel";
import { CrmNotesPanel } from "@/components/crm/CrmNotesPanel";
import { AddressModal, AssignOwnerModal, RecordTagsModal } from "@/components/crm/CrmRecordDialogs";
import { CrmRecordHeader } from "@/components/crm/CrmRecordHeader";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { crmRequest } from "@/components/crm/crm-api";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { humanizeStatus } from "@/lib/humanize-status";
import { ADDRESS_TYPES } from "@/modules/crm/contacts/contact-registry";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { CompanyStatusBadge } from "./CompaniesListClient";
import { AddCompanyContactModal, AssociateLeadModal, ChangeCompanyStatusModal, LinkErpCustomerModal } from "./CompanyDialogs";
import { CompanyContactsList, CompanyLeadsList, CompanyOpportunitiesList, CompanyUpcomingSections, type CompanyContactRow, type CompanyLeadRow } from "./CompanyRelatedPanels";
import type { AddressDto, CompanyDetailDto, CompanyPermissions } from "./company-types";
import { useCompanyLookups } from "./useCompanyLookups";

const API = "/api/v1/crm/companies";

type Dialog =
  | null
  | { kind: "assign" | "tags" | "status" | "archive" | "restore" | "dismiss" | "linkCustomer" | "unlinkCustomer" | "addContact" | "addLead" }
  | { kind: "address"; address: AddressDto | null }
  | { kind: "deleteAddress"; address: AddressDto }
  | { kind: "removeContact"; contact: CompanyContactRow }
  | { kind: "unlinkLead"; lead: CompanyLeadRow };

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

/** The organisation 360: CRM details plus read-only references to the linked ERP customer. */
export function CompanyDetailClient({ initialCompany, permissions, currentUserId }: { initialCompany: CompanyDetailDto; permissions: CompanyPermissions; currentUserId: string }) {
  const router = useRouter();
  const { meta, users } = useCompanyLookups();
  const [company, setCompany] = useState(initialCompany);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [includeRelated, setIncludeRelated] = useState(false);

  const merged = Boolean(company.mergedIntoId);
  const archived = Boolean(company.archivedAt);
  const canEdit = permissions.edit && !archived && !merged;

  const reload = useCallback(async () => {
    const res = await crmRequest<CompanyDetailDto>(`${API}/${company.id}`);
    if (res.ok) setCompany(res.data);
    setRefreshKey((k) => k + 1);
  }, [company.id]);
  const done = () => {
    setDialog(null);
    void reload();
  };

  useEffect(() => {
    if (window.location.hash === "#notes") document.getElementById("notes")?.scrollIntoView();
  }, []);

  const call = async (path: string, successMessage: string, method = "POST", body?: unknown) => {
    setBusy(true);
    const res = await crmRequest(`${API}/${company.id}/${path}`, { method, body, successMessage });
    setBusy(false);
    if (res.ok) done();
  };

  const menu: ActionMenuItem[] = [];
  if (canEdit) {
    menu.push({ label: "Assign", onClick: () => setDialog({ kind: "assign" }) });
    menu.push({ label: "Change status", onClick: () => setDialog({ kind: "status" }) });
    menu.push({ label: "Edit tags", onClick: () => setDialog({ kind: "tags" }) });
    menu.push({ label: "Add contact", onClick: () => setDialog({ kind: "addContact" }) });
    menu.push({ label: "Associate lead", onClick: () => setDialog({ kind: "addLead" }) });
    menu.push({ label: "Add note", onClick: () => document.getElementById("crm-note-new")?.focus() });
    if (!company.customer && meta?.canPickCustomer) menu.push({ label: "Link ERP customer", onClick: () => setDialog({ kind: "linkCustomer" }) });
    menu.push({ label: "Merge with another company", onClick: () => router.push(`/crm/companies/merge?ids=${company.id}`) });
    menu.push({ label: "Archive", onClick: () => setDialog({ kind: "archive" }), danger: true });
  }

  const actions = (
    <>
      {archived && !merged && permissions.edit && (
        <Button variant="secondary" onClick={() => setDialog({ kind: "restore" })}>
          Restore
        </Button>
      )}
      {canEdit && (
        <Link href={`/crm/companies/${company.id}/edit`} className={buttonClasses("secondary")}>
          Edit
        </Link>
      )}
      {menu.length > 0 && <ActionMenu items={menu} />}
    </>
  );

  const badges: { label: string; tone?: "neutral" | "indigo" | "green" | "amber" | "red" }[] = [];
  if (merged) badges.push({ label: "Merged", tone: "neutral" });
  else if (archived) badges.push({ label: "Archived", tone: "neutral" });
  if (company.customer) badges.push({ label: "ERP customer", tone: "green" });
  if (company.duplicateFlaggedAt && !merged) badges.push({ label: "Possible duplicate", tone: "amber" });
  const location = [company.city, company.state, company.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      {merged && company.mergedInto && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          This company was merged into{" "}
          <Link href={`/crm/companies/${company.mergedInto.id}`} className="font-medium underline">
            {company.mergedInto.name}
          </Link>
          {company.mergedAt && (
            <>
              {" "}
              on <ClientDateTime value={company.mergedAt} />
            </>
          )}
          {company.mergedByName ? ` by ${company.mergedByName}` : ""}. It is kept read-only for history; its contacts, leads, opportunities, notes, documents and tags moved to that company.
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <CrmRecordHeader
          title={company.displayName || company.name}
          subtitle={[company.displayName && company.displayName !== company.name ? company.name : null, company.industry, company.companyType, location].filter(Boolean).join(" · ") || undefined}
          badges={badges}
          actions={actions}
          meta={[
            { label: "Status", value: <CompanyStatusBadge status={company.status} /> },
            { label: "Owner", value: <OwnerName owner={company.owner} inactive={company.ownerInactive} /> },
            {
              label: "Primary contact",
              value: company.primaryContact ? (
                <Link href={`/crm/contacts/${company.primaryContact.id}`} className={linkClass}>
                  {company.primaryContact.fullName}
                </Link>
              ) : (
                dash
              ),
            },
            { label: "Contacts", value: company.counts.contacts },
            { label: "Open opportunities", value: company.counts.openOpportunities },
            { label: "Source", value: company.source?.name ?? dash },
            { label: "Last activity", value: company.lastActivityAt ? <ClientDateTime value={company.lastActivityAt} /> : dash },
            { label: "Created", value: <ClientDateTime value={company.createdAt} mode="date" /> },
          ]}
        />
        {company.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {company.tags.map((t) => (
              <CrmBadge key={t.id} label={t.name} tone="indigo" />
            ))}
          </div>
        )}
        {archived && !merged && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Archived {company.archivedByName ? `by ${company.archivedByName} ` : ""}on <ClientDateTime value={company.archivedAt as string} />. Restore it to make changes. The ERP customer (if linked) is not affected.
          </p>
        )}
      </div>

      {company.flaggedDuplicates.length > 0 && !merged && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-medium text-amber-900 dark:text-amber-200">Flagged by a duplicate rule — these companies look similar:</p>
          <ul className="mt-2 space-y-1.5">
            {company.flaggedDuplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-zinc-800 dark:text-zinc-100">
                  <Link href={`/crm/companies/${d.id}`} className="font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400"> {[d.website, d.city, d.customerCode ? `ERP ${d.customerCode}` : null, d.archived ? "archived" : null].filter(Boolean).join(" · ")}</span>
                </span>
                {canEdit && (
                  <Link href={`/crm/companies/merge?ids=${d.id},${company.id}`} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                    Review & merge
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {permissions.edit && (
            <button type="button" className="mt-2 text-xs text-amber-800 underline dark:text-amber-300" onClick={() => setDialog({ kind: "dismiss" })}>
              Not a duplicate — clear the flag
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Company information">
            <Facts
              rows={[
                ["Name", company.name],
                ["Legal name", company.legalName],
                ["Display name", company.displayName],
                ["Company type", company.companyType],
                ["Industry", company.industry],
                ["Website", company.website ? <a href={company.website} target="_blank" rel="noopener noreferrer" className={linkClass}>{company.website}</a> : null],
                ["Email", mailto(company.email)],
                ["Phone", tel(company.phone)],
                ["Mobile", tel(company.mobile)],
                ["Location", [company.city, company.state, company.postalCode, company.country].filter(Boolean).join(", ")],
              ]}
            />
          </Section>

          <Section
            title={`Contacts (${company.counts.contacts})`}
            action={
              canEdit ? (
                <span className="flex gap-3">
                  <button type="button" className={smallButton} onClick={() => setDialog({ kind: "addContact" })}>
                    + Add existing
                  </button>
                  <Link href={`/crm/contacts/new?companyId=${company.id}`} className={smallButton}>
                    + New contact
                  </Link>
                </span>
              ) : undefined
            }
          >
            <CompanyContactsList
              companyId={company.id}
              refreshKey={refreshKey}
              canEdit={canEdit}
              onSetPrimary={(c) => call("primary-contact", `${c.fullName} is now the primary contact.`, "PUT", { contactId: c.id })}
              onRemove={(c) => setDialog({ kind: "removeContact", contact: c })}
            />
          </Section>

          <Section
            title={`Leads (${company.counts.leads})`}
            action={
              canEdit ? (
                <button type="button" className={smallButton} onClick={() => setDialog({ kind: "addLead" })}>
                  + Associate lead
                </button>
              ) : undefined
            }
          >
            <CompanyLeadsList companyId={company.id} refreshKey={refreshKey} canEdit={canEdit} onUnlink={(l) => setDialog({ kind: "unlinkLead", lead: l })} />
          </Section>

          <Section
            title={`Opportunities (${company.counts.openOpportunities} open)`}
            action={
              canEdit && permissions.create ? (
                <Link href={`/crm/opportunities/new?companyId=${company.id}${company.primaryContact ? `&contactId=${company.primaryContact.id}` : ""}`} className={smallButton}>
                  + New opportunity
                </Link>
              ) : undefined
            }
          >
            <CompanyOpportunitiesList companyId={company.id} refreshKey={refreshKey} />
          </Section>

          <Section
            title="Addresses"
            action={
              canEdit ? (
                <button type="button" className={smallButton} onClick={() => setDialog({ kind: "address", address: null })}>
                  + Add address
                </button>
              ) : undefined
            }
          >
            {company.addresses.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No addresses yet.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {company.addresses.map((a) => (
                  <li key={a.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{ADDRESS_TYPES[a.addressType as keyof typeof ADDRESS_TYPES] ?? a.addressType}</span>
                      {a.label && <span className="text-xs text-zinc-500">· {a.label}</span>}
                      {a.isPrimary && <CrmBadge label="Primary" tone="green" />}
                    </div>
                    <p className="whitespace-pre-line text-zinc-900 dark:text-zinc-100">{[a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", "), a.country].filter(Boolean).join("\n")}</p>
                    {canEdit && (
                      <div className="mt-2 flex gap-3">
                        <button type="button" className={smallButton} onClick={() => setDialog({ kind: "address", address: a })}>
                          Edit
                        </button>
                        <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setDialog({ kind: "deleteAddress", address: a })}>
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Custom fields">
            {meta ? <CrmCustomFieldValues definitions={meta.customFields} values={company.customFields ?? {}} noun="companies" /> : <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
          </Section>

          <Section title="Notes" id="notes">
            <CrmNotesPanel listUrl={`${API}/${company.id}/notes`} canAdd={permissions.create && !archived && !merged} onChanged={() => setRefreshKey((k) => k + 1)} />
          </Section>

          <Section
            title="Timeline"
            action={
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={includeRelated} onChange={(e) => setIncludeRelated(e.target.checked)} /> Include contacts & leads
              </label>
            }
          >
            <CrmTimeline
              key={includeRelated ? "related" : "own"}
              entityType="COMPANY"
              entityId={company.id}
              refreshKey={refreshKey}
              extraParams={includeRelated ? { includeRelated: "true" } : undefined}
              emptyDescription="Changes to this company will appear here."
            />
            {company.mergedFrom.length > 0 && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Includes the history of {company.mergedFrom.map((m) => m.name).join(", ")} (merged into this company).</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section
            title="ERP customer"
            action={
              canEdit && meta?.canPickCustomer ? (
                company.customer ? (
                  <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => setDialog({ kind: "unlinkCustomer" })}>
                    Unlink
                  </button>
                ) : (
                  <button type="button" className={smallButton} onClick={() => setDialog({ kind: "linkCustomer" })}>
                    Link customer
                  </button>
                )
              ) : undefined
            }
          >
            {company.customer ? (
              <div className="space-y-1 text-sm">
                <p>
                  <span className="font-medium">{company.customer.name}</span> <span className="text-xs text-zinc-500">({[company.customer.code, humanizeStatus(company.customer.type), humanizeStatus(company.customer.status)].join(" · ")})</span>
                </p>
                {meta?.canPickCustomer && (
                  <Link href={`/masters/customers/${company.customer.id}`} className={smallButton}>
                    Open ERP customer ↗
                  </Link>
                )}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Billing, balances, orders and invoices are managed in the ERP. The CRM only links to them.</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Not linked. Link an existing ERP customer when this company starts buying — the CRM never creates customers.</p>
            )}
          </Section>

          <Section title="Quotations, orders, invoices & tickets">
            <CrmErpReferencesPanel url={`${API}/${company.id}/erp-references`} refreshKey={refreshKey} />
          </Section>

          <Section title="Documents">
            <CrmDocumentsPanel baseUrl={`${API}/${company.id}`} canUpload={permissions.create && !archived && !merged} canEdit={canEdit} viewAll={permissions.viewAll} currentUserId={currentUserId} onChanged={() => setRefreshKey((k) => k + 1)} />
          </Section>

          <Section title="Coming in later phases">
            <CompanyUpcomingSections />
          </Section>

          <Section title="Record">
            <Facts
              rows={[
                [
                  "Origin",
                  company.sourceLead ? (
                    <span key="o">
                      From lead{" "}
                      <Link href={`/crm/leads/${company.sourceLead.id}`} className={linkClass}>
                        {company.sourceLead.leadNumber}
                      </Link>
                    </span>
                  ) : (
                    "Created directly"
                  ),
                ],
                [
                  "Created",
                  <span key="c">
                    <ClientDateTime value={company.createdAt} /> by {company.createdBy.fullName}
                  </span>,
                ],
                [
                  "Last updated",
                  <span key="u">
                    <ClientDateTime value={company.updatedAt} />
                    {company.updatedByName ? ` by ${company.updatedByName}` : ""}
                  </span>,
                ],
                ["Merged in", company.mergedFrom.length ? company.mergedFrom.map((m) => m.name).join(", ") : null],
              ]}
            />
          </Section>
        </div>
      </div>

      {dialog?.kind === "assign" && <AssignOwnerModal apiBase={API} noun="company" onClose={() => setDialog(null)} users={users} target={{ recordId: company.id, version: company.version }} currentOwnerId={company.ownerUserId} onDone={done} />}
      {dialog?.kind === "tags" && <RecordTagsModal apiBase={API} noun="company" onClose={() => setDialog(null)} target={{ recordId: company.id }} currentTags={company.tags} onDone={done} />}
      {dialog?.kind === "status" && meta && <ChangeCompanyStatusModal statuses={meta.statuses} target={{ recordId: company.id, version: company.version }} currentStatusId={company.statusId} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "linkCustomer" && <LinkErpCustomerModal companyId={company.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "addContact" && <AddCompanyContactModal companyId={company.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "addLead" && <AssociateLeadModal companyId={company.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "address" && <AddressModal baseUrl={`${API}/${company.id}`} address={dialog.address} onClose={() => setDialog(null)} onDone={done} />}
      <ConfirmModal
        open={dialog?.kind === "deleteAddress"}
        title="Remove address?"
        message={dialog?.kind === "deleteAddress" ? `${dialog.address.line1} will be removed from this company. The change is kept in the timeline and audit log.` : ""}
        confirmLabel="Remove"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "deleteAddress" && call(`addresses/${dialog.address.id}`, "Address removed.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "removeContact"}
        title="Remove contact from company?"
        message={dialog?.kind === "removeContact" ? `${dialog.contact.fullName} will no longer be linked to ${company.name}. The contact itself is kept.` : ""}
        confirmLabel="Remove"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "removeContact" && call(`contacts/${dialog.contact.id}`, "Contact removed from company.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "unlinkLead"}
        title="Unlink lead?"
        message={dialog?.kind === "unlinkLead" ? `${dialog.lead.leadNumber} will no longer be associated with ${company.name}. The lead itself is kept.` : ""}
        confirmLabel="Unlink"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "unlinkLead" && call(`leads/${dialog.lead.id}`, "Lead unlinked.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "unlinkCustomer"}
        title="Unlink ERP customer?"
        message={`${company.customer?.name ?? "The customer"} stays in the ERP unchanged; this company just stops showing its ERP documents. You can link it again later.`}
        confirmLabel="Unlink"
        isDangerous
        isBusy={busy}
        onConfirm={() => call("erp-customer", "ERP customer unlinked.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive company?"
        message={`${company.name} will be hidden from the company list. Contacts, leads, history, notes and documents are kept, and the ERP customer is not touched. You can restore it later.`}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => call("archive", "Company archived.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore company?"
        message={`${company.name} will be back in the company list and can be edited again.`}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => call("restore", "Company restored.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "dismiss"}
        title="Not a duplicate?"
        message="The possible-duplicate flag is cleared. The other companies are not changed."
        confirmLabel="Clear flag"
        isBusy={busy}
        onConfirm={() => call("dismiss-duplicate", "Duplicate flag cleared.")}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
