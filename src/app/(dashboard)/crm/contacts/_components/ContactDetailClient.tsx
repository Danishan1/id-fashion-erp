"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmCustomFieldValues } from "@/components/crm/CrmCustomFields";
import { CrmDocumentsPanel } from "@/components/crm/CrmDocumentsPanel";
import { CrmNotesPanel } from "@/components/crm/CrmNotesPanel";
import { ActivityPanel } from "@/components/crm/activities/ActivityPanel";
import { AppointmentPanel } from "@/components/crm/appointments/AppointmentPanel";
import { ConversationsPanel } from "@/components/crm/conversations/ConversationsPanel";
import { CrmRecordHeader } from "@/components/crm/CrmRecordHeader";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { crmRequest } from "@/components/crm/crm-api";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ADDRESS_TYPES, CONTACT_CHANNEL_TYPES, CONTACTABILITY_CHANNELS, CONTACTABILITY_SOURCES, CONTACTABILITY_STATUSES, type ContactabilityChannel } from "@/modules/crm/contacts/contact-registry";
import { OwnerName } from "../../leads/_components/LeadBadges";
import { AddressModal, AssignContactModal, ChannelModal, ContactabilityModal, ContactTagsModal } from "./ContactDialogs";
import { ContactErpReferences, ContactRelatedRecords, ContactUpcomingSections } from "./ContactRelatedPanels";
import type { AddressDto, ContactDetailDto, ContactPermissions } from "./contact-types";
import { useContactLookups } from "./useContactLookups";

type Dialog =
  | null
  | { kind: "assign" | "tags" | "archive" | "restore" | "channel" | "dismiss" }
  | { kind: "address"; address: AddressDto | null }
  | { kind: "deleteAddress"; address: AddressDto }
  | { kind: "consent"; channel: ContactabilityChannel };

const dash = <span className="text-zinc-400">—</span>;

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

const linkClass = "text-indigo-600 hover:underline dark:text-indigo-400";
const mailto = (v: string | null) => (v ? <a href={`mailto:${v}`} className={linkClass}>{v}</a> : null);
const tel = (v: string | null) => (v ? <a href={`tel:${v}`} className={linkClass}>{v}</a> : null);
const smallButton = "text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400";

export function ContactDetailClient({ initialContact, permissions, currentUserId }: { initialContact: ContactDetailDto; permissions: ContactPermissions; currentUserId: string }) {
  const router = useRouter();
  const { meta, users } = useContactLookups();
  const [contact, setContact] = useState(initialContact);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);

  const merged = Boolean(contact.mergedIntoId);
  const archived = Boolean(contact.archivedAt);
  const canEdit = permissions.edit && !archived && !merged;
  const restricted = contact.contactability.filter((c) => !c.allowed);

  const reload = useCallback(async () => {
    const res = await crmRequest<ContactDetailDto>(`/api/v1/crm/contacts/${contact.id}`);
    if (res.ok) setContact(res.data);
    setTimelineKey((k) => k + 1);
  }, [contact.id]);
  const done = () => {
    setDialog(null);
    void reload();
  };

  useEffect(() => {
    if (window.location.hash === "#notes") document.getElementById("notes")?.scrollIntoView();
  }, []);

  const post = async (path: string, successMessage: string, method = "POST") => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/contacts/${contact.id}/${path}`, { method, successMessage });
    setBusy(false);
    if (res.ok) done();
  };

  const removeChannel = async (channelId: string) => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/contacts/${contact.id}/channels/${channelId}`, { method: "DELETE", successMessage: "Contact detail removed." });
    setBusy(false);
    if (res.ok) done();
  };

  const menu: ActionMenuItem[] = [];
  if (canEdit) {
    menu.push({ label: "Assign", onClick: () => setDialog({ kind: "assign" }) });
    menu.push({ label: "Edit tags", onClick: () => setDialog({ kind: "tags" }) });
    menu.push({ label: "Add note", onClick: () => document.getElementById("crm-note-new")?.focus() });
    menu.push({ label: "Merge with another contact", onClick: () => router.push(`/crm/contacts/merge?ids=${contact.id}`) });
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
        <Link href={`/crm/contacts/${contact.id}/edit`} className={buttonClasses("secondary")}>
          Edit
        </Link>
      )}
      {menu.length > 0 && <ActionMenu items={menu} />}
    </>
  );

  const badges: { label: string; tone?: "neutral" | "indigo" | "green" | "amber" | "red" }[] = [];
  if (merged) badges.push({ label: "Merged", tone: "neutral" });
  else if (archived) badges.push({ label: "Archived", tone: "neutral" });
  if (restricted.some((r) => r.channel === "ALL")) badges.push({ label: "Do not contact", tone: "red" });
  else if (restricted.length) badges.push({ label: `DND: ${restricted.map((r) => CONTACTABILITY_CHANNELS[r.channel]).join(", ")}`, tone: "amber" });
  if (contact.duplicateFlaggedAt && !merged) badges.push({ label: "Possible duplicate", tone: "amber" });

  const company = contact.crmCompany;

  return (
    <div className="space-y-4">
      {merged && contact.mergedInto && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          This contact was merged into{" "}
          <Link href={`/crm/contacts/${contact.mergedInto.id}`} className="font-medium underline">
            {contact.mergedInto.fullName}
          </Link>
          {contact.mergedAt && (
            <>
              {" "}
              on <ClientDateTime value={contact.mergedAt} />
            </>
          )}
          {contact.mergedByName ? ` by ${contact.mergedByName}` : ""}. It is kept read-only for history; its notes, documents, tags, leads and opportunities moved to that contact.
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <CrmRecordHeader
          title={contact.fullName}
          subtitle={[contact.designation, contact.department, company?.name].filter(Boolean).join(" · ") || undefined}
          badges={badges}
          actions={actions}
          meta={[
            { label: "Owner", value: <OwnerName owner={contact.owner} inactive={contact.ownerInactive} /> },
            { label: "Email", value: mailto(contact.email) ?? dash },
            { label: "Mobile", value: tel(contact.mobile ?? contact.phone) ?? dash },
            { label: "Source", value: contact.source?.name ?? dash },
            { label: "Company", value: company ? <Link href={`/crm/companies/${company.id}`} className={linkClass}>{company.name}</Link> : dash },
            { label: "Role", value: contact.relationshipRole ?? dash },
            { label: "Last activity", value: contact.lastActivityAt ? <ClientDateTime value={contact.lastActivityAt} /> : dash },
            { label: "Created", value: <ClientDateTime value={contact.createdAt} mode="date" /> },
          ]}
        />
        {contact.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {contact.tags.map((t) => (
              <CrmBadge key={t.id} label={t.name} tone="indigo" />
            ))}
          </div>
        )}
        {archived && !merged && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Archived {contact.archivedByName ? `by ${contact.archivedByName} ` : ""}on <ClientDateTime value={contact.archivedAt as string} />. Restore it to make changes.
          </p>
        )}
      </div>

      {contact.flaggedDuplicates.length > 0 && !merged && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-medium text-amber-900 dark:text-amber-200">Flagged by a duplicate rule — these contacts look similar:</p>
          <ul className="mt-2 space-y-1.5">
            {contact.flaggedDuplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-zinc-800 dark:text-zinc-100">
                  <Link href={`/crm/contacts/${d.id}`} className="font-medium hover:underline">
                    {d.fullName}
                  </Link>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400"> {[d.companyName, d.email, d.phone, d.archived ? "archived" : null].filter(Boolean).join(" · ")}</span>
                </span>
                {canEdit && (
                  <Link href={`/crm/contacts/merge?ids=${d.id},${contact.id}`} className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
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
          <Section
            title="Contact information"
            action={
              canEdit ? (
                <button type="button" className={smallButton} onClick={() => setDialog({ kind: "channel" })}>
                  + Add detail
                </button>
              ) : undefined
            }
          >
            <Facts
              rows={[
                ["First name", contact.firstName],
                ["Middle name", contact.middleName],
                ["Last name", contact.lastName],
                ["Designation", contact.designation],
                ["Department", contact.department],
                ["Relationship role", contact.relationshipRole],
                ["Email", mailto(contact.email)],
                ["Alternate email", mailto(contact.alternateEmail)],
                ["Mobile", tel(contact.mobile)],
                ["Phone", tel(contact.phone)],
                ["WhatsApp", contact.whatsapp],
              ]}
            />
            {contact.channels.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">More ways to reach them</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {contact.channels.map((ch) => {
                    const kind = CONTACT_CHANNEL_TYPES[ch.channelType as keyof typeof CONTACT_CHANNEL_TYPES]?.kind;
                    return (
                      <li key={ch.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <span className="text-zinc-500 dark:text-zinc-400">{CONTACT_CHANNEL_TYPES[ch.channelType as keyof typeof CONTACT_CHANNEL_TYPES]?.label ?? ch.channelType}: </span>
                          {kind === "email" ? mailto(ch.value) : kind === "phone" ? tel(ch.value) : kind === "url" ? <a href={ch.value} target="_blank" rel="noopener noreferrer" className={linkClass}>{ch.value}</a> : ch.value}
                          {ch.label && <span className="text-xs text-zinc-500"> ({ch.label})</span>}
                        </span>
                        {canEdit && (
                          <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" disabled={busy} onClick={() => removeChannel(ch.id)}>
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Company">
            {company ? (
              <Facts
                rows={[
                  [
                    "Company",
                    <Link key="co" href={`/crm/companies/${company.id}`} className={linkClass}>
                      {company.name}
                    </Link>,
                  ],
                  ["Industry", company.industry],
                  ["Location", [company.city, company.country].filter(Boolean).join(", ")],
                  ["Website", company.website ? <a href={company.website} target="_blank" rel="noopener noreferrer" className={linkClass}>{company.website}</a> : null],
                  ["ERP customer", company.customer ? `${company.customer.name} (${company.customer.code})` : "Not linked"],
                ]}
              />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No company. Edit the contact to pick a CRM company or an ERP customer.</p>
            )}
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
            {contact.addresses.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No addresses yet.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {contact.addresses.map((a) => (
                  <li key={a.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{ADDRESS_TYPES[a.addressType as keyof typeof ADDRESS_TYPES] ?? a.addressType}</span>
                      {a.label && <span className="text-xs text-zinc-500">· {a.label}</span>}
                      {a.isPrimary && <CrmBadge label="Primary" tone="green" />}
                    </div>
                    <p className="whitespace-pre-line text-zinc-900 dark:text-zinc-100">
                      {[a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(", "), a.country].filter(Boolean).join("\n")}
                    </p>
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
            {meta ? <CrmCustomFieldValues definitions={meta.customFields} values={contact.customFields ?? {}} noun="contacts" /> : <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
          </Section>

          <Section title="Appointments" id="appointments">
            <AppointmentPanel
              parent={{ entityType: "CONTACT", entityId: contact.id, label: contact.fullName }}
              canCreate={permissions.create && !archived && !merged}
              canEdit={permissions.edit}
              currentUserId={currentUserId}
              onChanged={() => setTimelineKey((k) => k + 1)}
            />
          </Section>

          <Section title="Conversations" id="conversations">
            <ConversationsPanel parent={{ entityType: "CONTACT", entityId: contact.id }} />
          </Section>

          <Section title="Activities & tasks" id="activities">
            <ActivityPanel
              parent={{ entityType: "CONTACT", entityId: contact.id, label: contact.fullName }}
              canCreate={permissions.create && !archived && !merged}
              canEdit={permissions.edit}
              currentUserId={currentUserId}
              onAddNote={() => document.getElementById("notes")?.scrollIntoView({ behavior: "smooth" })}
              onChanged={() => setTimelineKey((k) => k + 1)}
            />
          </Section>

          <Section title="Notes" id="notes">
            <CrmNotesPanel listUrl={`/api/v1/crm/contacts/${contact.id}/notes`} canAdd={permissions.create && !archived && !merged} onChanged={() => setTimelineKey((k) => k + 1)} />
          </Section>

          <Section title="Timeline">
            <CrmTimeline entityType="CONTACT" entityId={contact.id} refreshKey={timelineKey} emptyDescription="Changes to this contact will appear here." />
            {contact.mergedFrom.length > 0 && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Includes the history of {contact.mergedFrom.map((m) => m.fullName).join(", ")} (merged into this contact).</p>}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Contactability">
            <ul className="space-y-2 text-sm">
              {contact.contactability.map((c) => (
                <li key={c.channel} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-800 dark:text-zinc-100">{CONTACTABILITY_CHANNELS[c.channel]}</span>{" "}
                    {c.allowed ? (
                      <span className="text-xs text-green-700 dark:text-green-400">Allowed</span>
                    ) : (
                      <span className="text-xs text-red-700 dark:text-red-400">{c.row && c.row.status !== "ALLOWED" ? CONTACTABILITY_STATUSES[c.row.status] : "Blocked by “All channels”"}</span>
                    )}
                    {c.row && c.row.status !== "ALLOWED" && (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {c.row.reason} · {CONTACTABILITY_SOURCES[c.row.source as keyof typeof CONTACTABILITY_SOURCES] ?? c.row.source} · <ClientDateTime value={c.row.changedAt} />
                        {c.row.changedByName ? ` · ${c.row.changedByName}` : ""}
                      </span>
                    )}
                  </div>
                  {permissions.edit && !merged && (
                    <button type="button" className={smallButton} onClick={() => setDialog({ kind: "consent", channel: c.channel })}>
                      Change
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Campaigns, sequences and messaging (later phases) check this before contacting anyone.</p>
          </Section>

          <Section
            title="Related records"
            action={
              canEdit && permissions.create ? (
                <Link href={`/crm/opportunities/new?contactId=${contact.id}${contact.crmCompany ? `&companyId=${contact.crmCompany.id}` : ""}`} className={smallButton}>
                  + New opportunity
                </Link>
              ) : undefined
            }
          >
            <ContactRelatedRecords contactId={contact.id} refreshKey={timelineKey} />
          </Section>

          <Section title="Documents">
            <CrmDocumentsPanel baseUrl={`/api/v1/crm/contacts/${contact.id}`} canUpload={permissions.create && !archived && !merged} canEdit={canEdit} viewAll={permissions.viewAll} currentUserId={currentUserId} onChanged={() => setTimelineKey((k) => k + 1)} />
          </Section>

          <Section title="ERP references">
            <ContactErpReferences contactId={contact.id} />
          </Section>

          <Section title="Coming in later phases">
            <ContactUpcomingSections />
          </Section>

          <Section title="Record">
            <Facts
              rows={[
                [
                  "Origin",
                  contact.sourceLead ? (
                    <span key="o">
                      Converted from lead{" "}
                      <Link href={`/crm/leads/${contact.sourceLead.id}`} className={linkClass}>
                        {contact.sourceLead.leadNumber}
                      </Link>
                    </span>
                  ) : (
                    "Created directly"
                  ),
                ],
                [
                  "Created",
                  <span key="c">
                    <ClientDateTime value={contact.createdAt} /> by {contact.createdBy.fullName}
                  </span>,
                ],
                [
                  "Last updated",
                  <span key="u">
                    <ClientDateTime value={contact.updatedAt} />
                    {contact.updatedByName ? ` by ${contact.updatedByName}` : ""}
                  </span>,
                ],
                ["Merged in", contact.mergedFrom.length ? contact.mergedFrom.map((m) => m.fullName).join(", ") : null],
              ]}
            />
          </Section>
        </div>
      </div>

      {dialog?.kind === "assign" && <AssignContactModal onClose={() => setDialog(null)} users={users} target={{ recordId: contact.id, version: contact.version }} currentOwnerId={contact.ownerUserId} onDone={done} />}
      {dialog?.kind === "tags" && <ContactTagsModal onClose={() => setDialog(null)} target={{ recordId: contact.id }} currentTags={contact.tags} onDone={done} />}
      {dialog?.kind === "channel" && <ChannelModal contactId={contact.id} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "address" && <AddressModal baseUrl={`/api/v1/crm/contacts/${contact.id}`} address={dialog.address} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "consent" && (
        <ContactabilityModal contactId={contact.id} channel={dialog.channel} current={contact.consents.find((c) => c.channel === dialog.channel) ?? null} onClose={() => setDialog(null)} onDone={done} />
      )}
      <ConfirmModal
        open={dialog?.kind === "deleteAddress"}
        title="Remove address?"
        message={dialog?.kind === "deleteAddress" ? `${dialog.address.line1} will be removed from this contact. The change is kept in the timeline and audit log.` : ""}
        confirmLabel="Remove"
        isDangerous
        isBusy={busy}
        onConfirm={() => dialog?.kind === "deleteAddress" && post(`addresses/${dialog.address.id}`, "Address removed.", "DELETE")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "archive"}
        title="Archive contact?"
        message={`${contact.fullName} will be hidden from the contact list. History, notes, documents and tags are kept; you can restore it later.`}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => post("archive", "Contact archived.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "restore"}
        title="Restore contact?"
        message={`${contact.fullName} will be back in the contact list and can be edited again.`}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => post("restore", "Contact restored.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog?.kind === "dismiss"}
        title="Not a duplicate?"
        message="The possible-duplicate flag is cleared. The other contacts are not changed."
        confirmLabel="Clear flag"
        isBusy={busy}
        onConfirm={() => post("dismiss-duplicate", "Duplicate flag cleared.")}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
