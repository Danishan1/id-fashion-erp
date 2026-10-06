"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmCustomFieldInputs } from "@/components/crm/CrmCustomFields";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTagInput, type CrmTagChip } from "@/components/crm/CrmTagInput";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import { opportunityValue } from "./OpportunityBadges";
import type { OpportunityDetailDto, OpportunityDuplicateMatchDto } from "./opportunity-types";
import { useOpportunityLookups } from "./useOpportunityLookups";

type Values = Record<string, string>;
const TEXT_KEYS = ["name", "pipelineId", "stageId", "amount", "currencyCode", "probability", "expectedCloseDate", "ownerUserId", "sourceId", "description"] as const;

export interface OpportunityPrefill {
  company?: CrmPickedRecord | null;
  contact?: CrmPickedRecord | null;
  lead?: { id: string; leadNumber: string; fullName: string; suggestedName: string; amount: string | null; currencyCode: string | null; sourceId: string | null; ownerUserId: string | null; description: string | null } | null;
}

interface CompanyLookupRow {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  customer: { code: string } | null;
}
interface ContactLookupRow {
  id: string;
  fullName: string;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  crmCompany: { id: string; name: string } | null;
}

const companyOption = (c: CompanyLookupRow): CrmPickedRecord => ({ id: c.id, label: c.name, sublabel: [c.customer ? `ERP ${c.customer.code}` : null, c.city, c.country].filter(Boolean).join(" · ") || null });
const contactOption = (c: ContactLookupRow): CrmPickedRecord => ({ id: c.id, label: c.fullName, sublabel: [c.crmCompany?.name, c.email, c.mobile ?? c.phone].filter(Boolean).join(" · ") || null });

function DuplicatePanel({ matches, mode, onConfirm, busy }: { matches: OpportunityDuplicateMatchDto[]; mode: "live" | "warn"; onConfirm?: () => void; busy?: boolean }) {
  if (!matches.length) return null;
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="font-medium text-amber-900 dark:text-amber-200">An open opportunity with this name already exists for this company and contact.</p>
      <p className="text-xs text-amber-800 dark:text-amber-300">A customer can have several deals — continue if this is a different one.</p>
      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-zinc-800 dark:text-zinc-100">
              <span className="font-medium">{m.opportunityNumber}</span> · {m.name}
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">{[m.stage, opportunityValue(m.amount, m.currencyCode), m.expectedCloseDate ? `Close ${m.expectedCloseDate.slice(0, 10)}` : null, m.owner && `Owner: ${m.owner}`].filter(Boolean).join(" · ")}</span>
            </span>
            {m.visible && (
              <Link href={`/crm/opportunities/${m.id}`} target="_blank" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                Open existing ↗
              </Link>
            )}
          </li>
        ))}
      </ul>
      {mode === "warn" && onConfirm && (
        <div className="mt-3">
          <Button variant="secondary" onClick={onConfirm} isLoading={busy} loadingLabel="Saving…">
            Save anyway
          </Button>
        </div>
      )}
    </div>
  );
}

function initialValues(o?: OpportunityDetailDto): Values {
  const v = Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])) as Values;
  if (!o) return v;
  for (const k of TEXT_KEYS) {
    const raw = (o as unknown as Record<string, unknown>)[k];
    v[k] = raw === null || raw === undefined ? "" : k === "expectedCloseDate" ? String(raw).slice(0, 10) : String(raw);
  }
  return v;
}

export function OpportunityForm({ opportunity, currentUserId, prefill }: { opportunity?: OpportunityDetailDto; currentUserId: string; prefill?: OpportunityPrefill }) {
  const router = useRouter();
  const { meta, users, error: lookupError, reload } = useOpportunityLookups();
  const [edited, setEdited] = useState<Values | null>(opportunity ? initialValues(opportunity) : null);
  const [company, setCompany] = useState<CrmPickedRecord | null>(
    opportunity?.crmCompany ? { id: opportunity.crmCompany.id, label: opportunity.crmCompany.name } : (prefill?.company ?? null)
  );
  const [contact, setContact] = useState<CrmPickedRecord | null>(opportunity?.crmContact ? { id: opportunity.crmContact.id, label: opportunity.crmContact.fullName } : (prefill?.contact ?? null));
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(opportunity?.customFields ?? {});
  const [tags, setTags] = useState<CrmTagChip[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMatches, setLiveMatches] = useState<OpportunityDuplicateMatchDto[]>([]);
  const [saveMatches, setSaveMatches] = useState<OpportunityDuplicateMatchDto[] | null>(null);
  const lead = opportunity ? null : (prefill?.lead ?? null);

  // New opportunity: defaults from meta (default pipeline + first stage) and the lead, if any — derived, not stored, until the user edits.
  const defaults = useMemo<Values | null>(() => {
    if (!meta) return null;
    const pipeline = meta.pipelines.find((p) => p.isDefault && p.isActive) ?? meta.pipelines.find((p) => p.isActive);
    const stage = pipeline?.stages.find((s) => s.isActive && s.isDefault) ?? pipeline?.stages.find((s) => s.isActive);
    const manual = meta.sources.find((s) => s.key === "manual" && s.isActive !== false);
    const owner = lead?.ownerUserId && users.some((u) => u.id === lead.ownerUserId) ? lead.ownerUserId : users.some((u) => u.id === currentUserId) ? currentUserId : "";
    return {
      ...initialValues(),
      name: lead?.suggestedName ?? "",
      pipelineId: pipeline?.id ?? "",
      stageId: stage?.id ?? "",
      amount: lead?.amount ?? "",
      currencyCode: lead?.currencyCode ?? meta.baseCurrencyCode,
      sourceId: lead?.sourceId ?? manual?.id ?? "",
      ownerUserId: owner,
      description: lead?.description ?? "",
    };
  }, [meta, users, currentUserId, lead]);
  const values = edited ?? defaults;
  const setValues = (update: (prev: Values) => Values) => setEdited((prev) => update((prev ?? defaults) as Values));

  const dupKey = values ? [values.name, company?.id ?? "", contact?.id ?? ""].join("|") : "";
  const hasName = Boolean(values?.name.trim());
  useEffect(() => {
    if (!values || !hasName) return;
    const t = setTimeout(async () => {
      const res = await crmRequest<{ matches: OpportunityDuplicateMatchDto[] }>("/api/v1/crm/opportunities/duplicate-check", {
        method: "POST",
        body: { name: values.name, crmCompanyId: company?.id ?? null, crmContactId: contact?.id ?? null, excludeOpportunityId: opportunity?.id ?? null },
        toast: "off",
      });
      if (res.ok) setLiveMatches(res.data.matches);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, opportunity?.id]);

  const pipelines = useMemo(() => (meta?.pipelines ?? []).filter((p) => p.isActive || p.id === opportunity?.pipelineId), [meta, opportunity?.pipelineId]);
  const sourceOptions = useMemo(() => (meta?.sources ?? []).filter((s) => s.isActive !== false || s.id === opportunity?.sourceId), [meta, opportunity?.sourceId]);
  const ownerOptions = users.map((u) => ({ id: u.id, label: u.fullName }));
  const currentOwner = opportunity?.owner;
  if (currentOwner && !ownerOptions.some((o) => o.id === currentOwner.id)) ownerOptions.unshift({ id: currentOwner.id, label: `${currentOwner.fullName} (inactive)` });

  if (lookupError) return <CrmErrorState message={lookupError} onRetry={reload} />;
  if (!meta || !values) return <CrmLoadingState />;

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const err = (k: string) => fieldErrors[k];
  const pipeline = pipelines.find((p) => p.id === values.pipelineId);
  const stages = (pipeline?.stages ?? []).filter((s) => s.isActive || s.id === opportunity?.stageId);
  const stage = stages.find((s) => s.id === values.stageId);

  // Entering a stage suggests its default probability unless the user typed their own.
  const changeStage = (stageId: string) => {
    const next = stages.find((s) => s.id === stageId);
    const followsStage = values.probability === "" || values.probability === String(stage?.probability ?? "");
    setValues((prev) => ({ ...prev, stageId, ...(followsStage && next?.probability !== null && next?.probability !== undefined ? { probability: String(next.probability) } : {}) }));
  };

  const save = async (confirmDuplicate = false) => {
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(false);
    const payload: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) payload[k] = values[k] === "" ? null : values[k];
    payload.name = values.name;
    payload.crmCompanyId = company?.id ?? null;
    payload.crmContactId = contact?.id ?? null;
    payload.customFields = customFields;
    if (confirmDuplicate) payload.confirmDuplicate = true;
    if (opportunity) payload.version = opportunity.version;
    else {
      if (lead) payload.leadId = lead.id;
      payload.tagIds = tags.filter((t) => t.id).map((t) => t.id);
      payload.tagNames = tags.filter((t) => !t.id).map((t) => t.name);
    }
    const res = await crmRequest<{ id: string }>(opportunity ? `/api/v1/crm/opportunities/${opportunity.id}` : "/api/v1/crm/opportunities", { method: opportunity ? "PATCH" : "POST", body: payload, toast: "off" });
    setBusy(false);
    if (res.ok) {
      toast.success(opportunity ? "Opportunity updated." : "Opportunity created.");
      router.push(`/crm/opportunities/${opportunity?.id ?? res.data.id}`);
      router.refresh();
      return;
    }
    const e = res.error;
    if (e.code === "CRM_POSSIBLE_DUPLICATE" && e.details?.entityType === "OPPORTUNITY") {
      setSaveMatches((e.details?.matches as OpportunityDuplicateMatchDto[]) ?? []);
      return;
    }
    if (e.code === "RECORD_VERSION_CONFLICT") setConflict(true);
    setFieldErrors(e.fieldErrors);
    setFormError(e.message);
    toast.error(e.message);
  };

  const section = "space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
  const heading = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.name.trim()) {
          setFieldErrors({ name: "Opportunity name is required" });
          return;
        }
        setSaveMatches(null);
        void save();
      }}
      className="max-w-4xl space-y-5"
    >
      {lead && (
        <p className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          Creating an opportunity from lead{" "}
          <Link href={`/crm/leads/${lead.id}`} className="font-medium underline">
            {lead.leadNumber} — {lead.fullName}
          </Link>
          . The lead link and source are kept for attribution.
        </p>
      )}

      <section className={section}>
        <h2 className={heading}>Opportunity</h2>
        <FormField label="Opportunity name" htmlFor="opp-name" required error={err("name")}>
          <input id="opp-name" className={textInputClass(Boolean(err("name")))} value={values.name} maxLength={200} autoFocus={!opportunity} onChange={(e) => set("name", e.target.value)} placeholder="e.g. AW26 knitwear programme" />
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Company" htmlFor="opp-company" error={err("crmCompanyId")}>
            <CrmRecordPicker<CompanyLookupRow> id="opp-company" lookupUrl="/api/v1/crm/companies/lookup" value={company} onChange={setCompany} toOption={companyOption} placeholder="Search companies…" invalid={Boolean(err("crmCompanyId"))} />
          </FormField>
          <FormField label="Contact" htmlFor="opp-contact" error={err("crmContactId")}>
            <CrmRecordPicker<ContactLookupRow>
              id="opp-contact"
              lookupUrl="/api/v1/crm/contacts/lookup"
              value={contact}
              onChange={(c) => {
                setContact(c);
                // Picking a contact fills in their company when none is chosen yet.
                if (c?.row?.crmCompany && !company) setCompany({ id: c.row.crmCompany.id, label: c.row.crmCompany.name });
              }}
              toOption={contactOption}
              placeholder="Search contacts…"
              invalid={Boolean(err("crmContactId"))}
            />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">A company, a contact, or both. Records are linked, never copied.</p>
        <DuplicatePanel matches={saveMatches || !hasName ? [] : liveMatches} mode="live" />
      </section>

      <section className={section}>
        <h2 className={heading}>Pipeline & value</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {pipelines.length > 1 && (
            <FormField label="Pipeline" htmlFor="opp-pipelineId" error={err("pipelineId")}>
              <select
                id="opp-pipelineId"
                className={textInputClass(Boolean(err("pipelineId")))}
                value={values.pipelineId}
                onChange={(e) => {
                  const p = pipelines.find((x) => x.id === e.target.value);
                  const first = p?.stages.find((s) => s.isActive && s.isDefault) ?? p?.stages.find((s) => s.isActive);
                  const followsStage = values.probability === "" || values.probability === String(stage?.probability ?? "");
                  setValues((prev) => ({ ...prev, pipelineId: e.target.value, stageId: first?.id ?? "", ...(followsStage && first?.probability != null ? { probability: String(first.probability) } : {}) }));
                }}
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Stage" htmlFor="opp-stageId" required error={err("stageId")}>
            <select id="opp-stageId" className={textInputClass(Boolean(err("stageId")))} value={values.stageId} onChange={(e) => changeStage(e.target.value)}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.probability !== null ? ` (${s.probability}%)` : ""}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Probability %" htmlFor="opp-probability" error={err("probability")}>
            <input
              id="opp-probability"
              type="number"
              min={0}
              max={100}
              step={1}
              className={textInputClass(Boolean(err("probability")))}
              value={values.probability}
              onChange={(e) => set("probability", e.target.value)}
              placeholder={stage?.probability !== null && stage?.probability !== undefined ? `${stage.probability} (stage default)` : "0–100"}
            />
          </FormField>
          <FormField label={`Estimated value (${values.currencyCode || meta.baseCurrencyCode})`} htmlFor="opp-amount" error={err("amount")}>
            <input id="opp-amount" type="number" min={0} step="0.01" className={textInputClass(Boolean(err("amount")))} value={values.amount} onChange={(e) => set("amount", e.target.value)} />
          </FormField>
          <FormField label="Currency" htmlFor="opp-currencyCode" error={err("currencyCode")}>
            <input id="opp-currencyCode" className={textInputClass(Boolean(err("currencyCode")))} value={values.currencyCode} maxLength={3} onChange={(e) => set("currencyCode", e.target.value.toUpperCase())} placeholder={meta.baseCurrencyCode} />
          </FormField>
          <FormField label="Expected close date" htmlFor="opp-expectedCloseDate" error={err("expectedCloseDate")}>
            <input id="opp-expectedCloseDate" type="date" className={textInputClass(Boolean(err("expectedCloseDate")))} value={values.expectedCloseDate} onChange={(e) => set("expectedCloseDate", e.target.value)} />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">The estimated CRM value — ERP sales orders or (future) quotations linked later keep their own amounts and never overwrite it.</p>
      </section>

      <section className={section}>
        <h2 className={heading}>Ownership & source</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Owner" htmlFor="opp-ownerUserId" error={err("ownerUserId")}>
            <SearchableSelect id="opp-ownerUserId" value={values.ownerUserId} onChange={(v) => set("ownerUserId", v)} options={ownerOptions} placeholder="Search people…" emptyOptionLabel="— Unassigned —" />
          </FormField>
          <FormField label="Source" htmlFor="opp-sourceId" error={err("sourceId")}>
            <select id="opp-sourceId" className={textInputClass(Boolean(err("sourceId")))} value={values.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
              <option value="">— None —</option>
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Description</h2>
        <FormField label="Requirement summary and deal context" htmlFor="opp-description" error={err("description")}>
          <textarea id="opp-description" rows={5} maxLength={5000} className={textInputClass(Boolean(err("description")))} value={values.description} onChange={(e) => set("description", e.target.value)} />
        </FormField>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Use custom fields for structured details (quantities, product, competitor…); use notes for running updates.</p>
      </section>

      {!opportunity && (
        <section className={section}>
          <h2 className={heading}>Tags</h2>
          <CrmTagInput id="opp-tags" value={tags} onChange={setTags} />
        </section>
      )}

      {meta.customFields.some((d) => d.isActive) && (
        <section className={section}>
          <h2 className={heading}>Additional information</h2>
          <CrmCustomFieldInputs definitions={meta.customFields} values={customFields} onChange={(k, v) => setCustomFields((c) => ({ ...c, [k]: v }))} errors={fieldErrors} />
        </section>
      )}

      {saveMatches && <DuplicatePanel matches={saveMatches} mode="warn" onConfirm={() => save(true)} busy={busy} />}
      {formError && !saveMatches && (
        <div className="space-y-2">
          <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          {conflict && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload latest version
            </Button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" isLoading={busy} loadingLabel="Saving…">
          {opportunity ? "Save changes" : "Create opportunity"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(opportunity ? `/crm/opportunities/${opportunity.id}` : "/crm/opportunities")} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
