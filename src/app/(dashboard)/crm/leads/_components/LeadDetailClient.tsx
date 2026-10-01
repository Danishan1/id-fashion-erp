"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmCustomFieldValues } from "@/components/crm/CrmCustomFields";
import { CrmNotesPanel } from "@/components/crm/CrmNotesPanel";
import { CrmRecordHeader } from "@/components/crm/CrmRecordHeader";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { crmRequest } from "@/components/crm/crm-api";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatCurrency } from "@/lib/currency";
import { ConvertLeadDrawer } from "./ConvertLeadDrawer";
import { LeadStatusBadge, LeadTemperatureBadge, OwnerName } from "./LeadBadges";
import { AssignLeadModal, ChangeStatusModal, CreateOpportunityModal, LeadTagsModal } from "./LeadDialogs";
import type { LeadDetailDto, LeadPermissions } from "./lead-types";
import { useLeadLookups } from "./useLeadLookups";

type Dialog = null | "assign" | "status" | "tags" | "opportunity" | "convert" | "archive" | "restore";

const CAPTURE_LABELS: Record<string, string> = {
  MANUAL: "Manual entry",
  CSV: "CSV import",
  XLSX: "Excel import",
  WEBSITE_FORM: "Website form",
  API: "API",
  WEBHOOK: "Webhook",
  INTEGRATION: "Integration",
};


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

const money = (amount: string | null, currency: string | null) => (amount ? `${currency ?? ""} ${formatCurrency(amount)}`.trim() : null);
const mailto = (v: string | null) =>
  v ? (
    <a href={`mailto:${v}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
      {v}
    </a>
  ) : null;
const tel = (v: string | null) =>
  v ? (
    <a href={`tel:${v}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
      {v}
    </a>
  ) : null;

export function LeadDetailClient({ initialLead, permissions, openConvert = false }: { initialLead: LeadDetailDto; permissions: LeadPermissions; openConvert?: boolean }) {
  const router = useRouter();
  const { meta, users } = useLeadLookups();
  const [lead, setLead] = useState(initialLead);
  const [busy, setBusy] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);

  const archived = Boolean(lead.archivedAt);
  const converted = Boolean(lead.convertedAt);
  const canEdit = permissions.edit && !archived;
  const canConvert = canEdit && permissions.create && !converted;
  const [dialog, setDialog] = useState<Dialog>(openConvert && canConvert ? "convert" : null);

  const reload = useCallback(async () => {
    const res = await crmRequest<LeadDetailDto>(`/api/v1/crm/leads/${lead.id}`);
    if (res.ok) setLead(res.data);
    setTimelineKey((k) => k + 1);
  }, [lead.id]);

  const done = () => {
    setDialog(null);
    void reload();
  };

  // List-page shortcuts: ?convert=1 (read on the server) opened the drawer; drop it from the URL. #notes scrolls to notes.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("convert")) {
      url.searchParams.delete("convert");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    if (url.hash === "#notes") document.getElementById("notes")?.scrollIntoView();
  }, []);

  const archiveOrRestore = async (action: "archive" | "restore") => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/leads/${lead.id}/${action}`, {
      method: "POST",
      successMessage: action === "archive" ? "Lead archived." : "Lead restored.",
    });
    setBusy(false);
    if (res.ok) done();
  };

  const menu: ActionMenuItem[] = [];
  if (canEdit) {
    menu.push({ label: "Assign", onClick: () => setDialog("assign") });
    if (!converted) menu.push({ label: "Change status", onClick: () => setDialog("status") });
    menu.push({ label: "Edit tags", onClick: () => setDialog("tags") });
    if (permissions.create)
      menu.push({
        label: "Create opportunity",
        onClick: () => setDialog("opportunity"),
      });
    menu.push({
      label: "Add note",
      onClick: () => document.getElementById("crm-note-new")?.focus(),
    });
    menu.push({
      label: "Archive",
      onClick: () => setDialog("archive"),
      danger: true,
    });
  }

  const actions = (
    <>
      {archived && permissions.edit && (
        <Button variant="secondary" onClick={() => setDialog("restore")}>
          Restore
        </Button>
      )}
      {canEdit && (
        <Link href={`/crm/leads/${lead.id}/edit`} className={buttonClasses("secondary")}>
          Edit
        </Link>
      )}
      {canConvert && <Button onClick={() => setDialog("convert")}>Convert</Button>}
      {menu.length > 0 && <ActionMenu items={menu} />}
    </>
  );

  const badges: {
    label: string;
    tone?: "neutral" | "indigo" | "green" | "amber" | "red";
  }[] = [];
  if (archived) badges.push({ label: "Archived", tone: "neutral" });
  if (converted) badges.push({ label: "Converted", tone: "green" });

  const location = [lead.city, lead.state, lead.country].filter(Boolean).join(", ");
  const attribution: [string, ReactNode][] = [
    ["UTM source", lead.utmSource],
    ["UTM medium", lead.utmMedium],
    ["UTM campaign", lead.utmCampaign],
    ["UTM term", lead.utmTerm],
    ["UTM content", lead.utmContent],
    ["Campaign", lead.campaignSource],
    ["Referral", lead.referralSource],
  ];
  const hasAttribution = attribution.some(([, v]) => v);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <CrmRecordHeader
          title={lead.fullName}
          subtitle={[lead.leadNumber, lead.designation, lead.companyName].filter(Boolean).join(" · ")}
          badges={badges}
          actions={actions}
          meta={[
            {
              label: "Status",
              value: <LeadStatusBadge status={lead.status} />,
            },
            {
              label: "Owner",
              value: <OwnerName owner={lead.owner} inactive={lead.ownerInactive} />,
            },
            { label: "Score", value: lead.score },
            {
              label: "Temperature",
              value: <LeadTemperatureBadge temperature={lead.temperature} />,
            },
            { label: "Source", value: lead.source?.name ?? dash },
            {
              label: "Estimated value",
              value: money(lead.estimatedValue, lead.currencyCode) ?? dash,
            },
            {
              label: "Next follow-up",
              value: lead.nextFollowUpAt ? <ClientDateTime value={lead.nextFollowUpAt} /> : dash,
            },
            {
              label: "Last contacted",
              value: lead.lastContactedAt ? <ClientDateTime value={lead.lastContactedAt} /> : dash,
            },
          ]}
        />
        {lead.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lead.tags.map((t) => (
              <CrmBadge key={t.id} label={t.name} tone="indigo" />
            ))}
          </div>
        )}
        {archived && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
            Archived {lead.archivedByName ? `by ${lead.archivedByName} ` : ""}on <ClientDateTime value={lead.archivedAt as string} />. Restore it to make changes.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Contact">
            <Facts
              rows={[
                ["Email", mailto(lead.email)],
                ["Alternate email", mailto(lead.alternateEmail)],
                ["Phone", tel(lead.phone)],
                ["Mobile", tel(lead.mobile)],
                ["WhatsApp", lead.whatsapp],
                ["Designation", lead.designation],
              ]}
            />
          </Section>

          <Section title="Company & requirement">
            <Facts
              rows={[
                ["Company", lead.companyName],
                ["Industry", lead.industry],
                ["Location", location],
                ["Linked CRM company", lead.crmCompany?.name],
              ]}
            />
            <div className="mt-3">
              <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Requirement</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{lead.requirement || dash}</p>
            </div>
          </Section>

          <Section title="Custom fields">
            {meta ? (
              <CrmCustomFieldValues definitions={meta.customFields} values={lead.customFields ?? {}} />
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
            )}
          </Section>

          {hasAttribution && (
            <Section title="Attribution">
              <Facts rows={attribution.filter(([, v]) => v)} />
            </Section>
          )}

          <Section title="Notes" id="notes">
            <CrmNotesPanel listUrl={`/api/v1/crm/leads/${lead.id}/notes`} canAdd={permissions.create && !archived} onChanged={() => setTimelineKey((k) => k + 1)} />
          </Section>

          <Section title="Timeline">
            <CrmTimeline entityType="LEAD" entityId={lead.id} refreshKey={timelineKey} emptyDescription="Changes to this lead will appear here." />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Related records">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Contact</p>
                {lead.crmContact ? (
                  <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">
                    {lead.crmContact.fullName}
                    {(lead.crmContact.email || lead.crmContact.phone) && (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{[lead.crmContact.email, lead.crmContact.phone].filter(Boolean).join(" · ")}</span>
                    )}
                  </p>
                ) : (
                  <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
                    Not linked yet
                    {converted ? "" : " — created or linked on conversion"}.
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Company</p>
                <p className="mt-0.5 text-zinc-900 dark:text-zinc-100">{lead.crmCompany?.name ?? <span className="text-zinc-500 dark:text-zinc-400">Not linked yet.</span>}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Opportunities</p>
                {lead.opportunities.length === 0 ? (
                  <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">None yet.</p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    {lead.opportunities.map((o) => (
                      <li key={o.id}>
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{o.opportunityNumber}</span> · {o.name}
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {[o.status, money(o.amount, o.currencyCode)].filter(Boolean).join(" · ")}
                          {lead.convertedOpportunityId === o.id && " · from conversion"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Contact, company and opportunity pages are added in the next CRM phases.</p>
            </div>
          </Section>

          <Section title="Record">
            <Facts
              rows={[
                [
                  "Captured via",
                  <span key="cv">
                    {CAPTURE_LABELS[lead.captureChannel] ?? lead.captureChannel}
                    {lead.importJob ? (
                      <>
                        {" · "}
                        <Link href={`/crm/leads/imports/${lead.importJob.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                          {lead.importJob.fileName}
                        </Link>
                      </>
                    ) : null}
                    {lead.externalRefs.length > 0 && <span className="block text-xs text-zinc-500 dark:text-zinc-400">External id: {lead.externalRefs.map((r) => `${r.externalId} (${r.provider})`).join(", ")}</span>}
                  </span>,
                ],
                [
                  "Created",

                  <span key="c">
                    <ClientDateTime value={lead.createdAt} /> by {lead.createdBy.fullName}
                  </span>,
                ],
                [
                  "Last updated",
                  <span key="u">
                    <ClientDateTime value={lead.updatedAt} />
                    {lead.updatedByName ? ` by ${lead.updatedByName}` : ""}
                  </span>,
                ],
                [
                  "Converted",
                  lead.convertedAt ? (
                    <span key="v">
                      <ClientDateTime value={lead.convertedAt} />
                      {lead.convertedByName ? ` by ${lead.convertedByName}` : ""}
                    </span>
                  ) : null,
                ],
              ]}
            />
          </Section>
        </div>
      </div>

      {dialog === "assign" && (
        <AssignLeadModal open onClose={() => setDialog(null)} users={users} target={{ leadId: lead.id, version: lead.version }} currentOwnerId={lead.ownerUserId} onDone={done} />
      )}
      {dialog === "status" && meta && (
        <ChangeStatusModal
          open
          onClose={() => setDialog(null)}
          statuses={meta.statuses}
          target={{ leadId: lead.id, version: lead.version }}
          currentStatusId={lead.status.id}
          onDone={done}
        />
      )}
      {dialog === "tags" && <LeadTagsModal open onClose={() => setDialog(null)} target={{ leadId: lead.id }} currentTags={lead.tags} onDone={done} />}
      {dialog === "opportunity" && <CreateOpportunityModal open onClose={() => setDialog(null)} lead={lead} onDone={done} />}
      {dialog === "convert" && (
        <ConvertLeadDrawer
          open
          onClose={() => setDialog(null)}
          lead={lead}
          onDone={() => {
            done();
            router.refresh();
          }}
        />
      )}
      <ConfirmModal
        open={dialog === "archive"}
        title="Archive lead?"
        message={`${lead.fullName} will be hidden from the lead list. You can restore it later from the Archived filter.`}
        confirmLabel="Archive"
        isDangerous
        isBusy={busy}
        onConfirm={() => archiveOrRestore("archive")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmModal
        open={dialog === "restore"}
        title="Restore lead?"
        message={`${lead.fullName} will be back in the lead list and can be edited again.`}
        confirmLabel="Restore"
        isBusy={busy}
        onConfirm={() => archiveOrRestore("restore")}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
