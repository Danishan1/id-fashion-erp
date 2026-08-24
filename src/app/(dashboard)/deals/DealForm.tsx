"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

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

export function DealForm({ initialDeal }: { initialDeal?: InitialDeal } = {}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialDeal?.title ?? "");
  const [leadId, setLeadId] = useState(initialDeal?.lead?.id ?? "");
  const [customerId, setCustomerId] = useState(initialDeal?.customer?.id ?? "");
  const [value, setValue] = useState(initialDeal?.value ?? "0");
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
          <select id="leadId" value={leadId} onChange={(e) => setLeadId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.leadNumber})
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Customer (optional)" htmlFor="customerId">
          <select id="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
          <select id="assignedToUserId" value={assignedToUserId} onChange={(e) => setAssignedToUserId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Sales Agent (commission)" htmlFor="salesAgentId">
          <select id="salesAgentId" value={salesAgentId} onChange={(e) => setSalesAgentId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {salesAgents.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
