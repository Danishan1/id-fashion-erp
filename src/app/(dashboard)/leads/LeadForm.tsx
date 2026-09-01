"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SOURCE_LABELS, STATUS_LABELS } from "./statusLabels";

interface Option {
  id: string;
  fullName?: string;
  name?: string;
}

interface CampaignOption {
  id: string;
  name: string;
  campaignNumber: string;
}

export interface InitialLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: keyof typeof SOURCE_LABELS;
  status: keyof typeof STATUS_LABELS;
  leadScore: string;
  value: string;
  expectedCloseDate: string | null;
  assignedTo: { id: string } | null;
  campaign: { id: string } | null;
  notes: string | null;
}

export function LeadForm({ initialLead }: { initialLead?: InitialLead } = {}) {
  const router = useRouter();
  const [name, setName] = useState(initialLead?.name ?? "");
  const [email, setEmail] = useState(initialLead?.email ?? "");
  const [phone, setPhone] = useState(initialLead?.phone ?? "");
  const [companyName, setCompanyName] = useState(initialLead?.companyName ?? "");
  const [source, setSource] = useState<keyof typeof SOURCE_LABELS>(initialLead?.source ?? "OTHER");
  const [status, setStatus] = useState<keyof typeof STATUS_LABELS>(initialLead?.status ?? "NEW");
  const [leadScore, setLeadScore] = useState(initialLead?.leadScore ?? "0");
  const [value, setValue] = useState(initialLead?.value ?? "0");
  const [expectedCloseDate, setExpectedCloseDate] = useState(initialLead?.expectedCloseDate?.slice(0, 10) ?? "");
  const [assignedToUserId, setAssignedToUserId] = useState(initialLead?.assignedTo?.id ?? "");
  const [campaignId, setCampaignId] = useState(initialLead?.campaign?.id ?? "");
  const [notes, setNotes] = useState(initialLead?.notes ?? "");
  const [users, setUsers] = useState<Option[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string; leadNumber: string }> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/users?pageSize=200")
      .then((res) => res.json())
      .then((body) => setUsers(body.data ?? []));
    fetch("/api/v1/campaigns?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCampaigns(body.data ?? []));
  }, []);

  const submit = async (overrideDuplicateCheck: boolean) => {
    setIsSubmitting(true);
    setError(null);

    const url = initialLead ? `/api/v1/leads/${initialLead.id}` : "/api/v1/leads";
    const res = await fetch(url, {
      method: initialLead ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email || undefined,
        phone: phone || undefined,
        companyName: companyName || undefined,
        source,
        status: initialLead ? status : undefined,
        campaignId: campaignId || undefined,
        leadScore: Number(leadScore),
        value: Number(value),
        expectedCloseDate: expectedCloseDate || undefined,
        assignedToUserId: assignedToUserId || undefined,
        notes: notes || undefined,
        overrideDuplicateCheck,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === "DUPLICATE_LEAD_EXISTS") {
        setDuplicates(body.error.details?.duplicates ?? []);
        setError(body.error.message);
        return;
      }
      setError(body?.error?.message ?? "Failed to save this lead.");
      return;
    }

    const { data } = await res.json();
    router.push(`/leads/${data.id}`);
    router.refresh();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setDuplicates(null);
    submit(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Name" htmlFor="name" required>
          <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Company" htmlFor="companyName">
          <input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email" htmlFor="email">
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Source" htmlFor="source" required>
          <select id="source" required value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={textInputClass()}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        {initialLead ? (
          <FormField label="Status" htmlFor="status">
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={textInputClass()}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        ) : (
          <FormField label="Assigned To (optional — auto-assigned if blank)" htmlFor="assignedToUserId">
            <select id="assignedToUserId" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} className={textInputClass()}>
              <option value="">Auto Assign</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>

      {initialLead && (
        <FormField label="Assigned To" htmlFor="assignedToUserId">
          <select id="assignedToUserId" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} className={textInputClass()}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <FormField label="Campaign (optional)" htmlFor="campaignId">
        <select id="campaignId" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className={textInputClass()}>
          <option value="">— None —</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.campaignNumber})
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Lead Score (0-100)" htmlFor="leadScore">
          <input id="leadScore" type="number" min={0} max={100} value={leadScore} onChange={(e) => setLeadScore(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Potential Value" htmlFor="value">
          <input id="value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Expected Close Date" htmlFor="expectedCloseDate">
          <input id="expectedCloseDate" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="notes">
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} rows={3} />
      </FormField>

      {error && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p>{error}</p>
          {duplicates && duplicates.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <a href={`/leads/${d.id}`} className="underline">
                    {d.name} ({d.leadNumber})
                  </a>
                </li>
              ))}
            </ul>
          )}
          {duplicates && (
            <button
              type="button"
              onClick={() => submit(true)}
              className="mt-3 rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
            >
              Save Anyway
            </button>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : initialLead ? "Save Changes" : "Create Lead"}
      </button>
    </form>
  );
}
