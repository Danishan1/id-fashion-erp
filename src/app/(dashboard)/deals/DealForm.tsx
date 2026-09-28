"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface Option {
  id: string;
  fullName?: string;
  name?: string;
  leadNumber?: string;
}

export interface InitialDeal {
  id: string;
  title: string;
  lead: { id: string } | null;
  customer: { id: string } | null;
  value: string;
  probabilityPercent: string;
  assignedTo: { id: string } | null;
  salesAgent: { id: string } | null;
  expectedCloseDate: string | null;
  notes: string | null;
}

export function DealForm({
  initialDeal,
  defaultLeadId,
  defaultTitle,
  defaultValue,
}: { initialDeal?: InitialDeal; defaultLeadId?: string; defaultTitle?: string; defaultValue?: string } = {}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialDeal?.title ?? defaultTitle ?? "");
  const [leadId, setLeadId] = useState(initialDeal?.lead?.id ?? defaultLeadId ?? "");
  const [customerId, setCustomerId] = useState(initialDeal?.customer?.id ?? "");
  const [value, setValue] = useState(initialDeal?.value ?? defaultValue ?? "0");
  const [probabilityPercent, setProbabilityPercent] = useState(initialDeal?.probabilityPercent ?? "0");
  const [assignedToUserId, setAssignedToUserId] = useState(initialDeal?.assignedTo?.id ?? "");
  const [salesAgentId, setSalesAgentId] = useState(initialDeal?.salesAgent?.id ?? "");
  const [expectedCloseDate, setExpectedCloseDate] = useState(initialDeal?.expectedCloseDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(initialDeal?.notes ?? "");

  const [leads, setLeads] = useState<Option[]>([]);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [salesAgents, setSalesAgents] = useState<Option[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/leads?pageSize=200")
      .then((res) => res.json())
      .then((body) => setLeads(body.data ?? []));
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/users?pageSize=200")
      .then((res) => res.json())
      .then((body) => setUsers(body.data ?? []));
    fetch("/api/v1/sales-agents?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSalesAgents(body.data ?? []));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const url = initialDeal ? `/api/v1/deals/${initialDeal.id}` : "/api/v1/deals";
    const res = await fetch(url, {
      method: initialDeal ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        leadId: leadId || undefined,
        customerId: customerId || undefined,
        value: Number(value),
        probabilityPercent: Number(probabilityPercent),
        assignedToUserId: assignedToUserId || undefined,
        salesAgentId: salesAgentId || undefined,
        expectedCloseDate: expectedCloseDate || undefined,
        notes: notes || undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this deal.");
      return;
    }

    const { data } = await res.json();
    router.push(`/deals/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <FormField label="Title" htmlFor="title" required>
        <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} className={textInputClass()} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Lead (optional)" htmlFor="leadId">
          <SearchableSelect
            id="leadId"
            value={leadId}
            onChange={setLeadId}
            options={leads.map((l) => ({ id: l.id, label: l.name ?? "", sublabel: l.leadNumber }))}
            placeholder="Search lead…"
          />
        </FormField>
        <FormField label="Customer (optional)" htmlFor="customerId">
          <SearchableSelect
            id="customerId"
            value={customerId}
            onChange={setCustomerId}
            options={customers.map((c) => ({ id: c.id, label: c.name ?? "" }))}
            placeholder="Search customer…"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Value" htmlFor="value">
          <input id="value" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Probability (%)" htmlFor="probabilityPercent">
          <input
            id="probabilityPercent"
            type="number"
            min={0}
            max={100}
            value={probabilityPercent}
            onChange={(e) => setProbabilityPercent(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Owner (User)" htmlFor="assignedToUserId">
          <SearchableSelect
            id="assignedToUserId"
            value={assignedToUserId}
            onChange={setAssignedToUserId}
            options={users.map((u) => ({ id: u.id, label: u.fullName ?? "" }))}
            placeholder="Search user…"
          />
        </FormField>
        <FormField label="Sales Agent (commission)" htmlFor="salesAgentId">
          <SearchableSelect
            id="salesAgentId"
            value={salesAgentId}
            onChange={setSalesAgentId}
            options={salesAgents.map((s) => ({ id: s.id, label: s.name ?? "" }))}
            placeholder="Search sales agent…"
          />
        </FormField>
      </div>

      <FormField label="Expected Close Date" htmlFor="expectedCloseDate">
        <input id="expectedCloseDate" type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} className={textInputClass()} />
      </FormField>

      <FormField label="Notes" htmlFor="notes">
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} rows={3} />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : initialDeal ? "Save Changes" : "Create Deal"}
      </button>
    </form>
  );
}
