"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { CHANNEL_LABELS } from "./statusLabels";

interface Option {
  id: string;
  fullName?: string;
}

export interface InitialCampaign {
  id: string;
  name: string;
  objective: string | null;
  channel: keyof typeof CHANNEL_LABELS;
  startDate: string | null;
  endDate: string | null;
  budget: string;
  owner: { id: string } | null;
  notes: string | null;
}

export function CampaignForm({ initialCampaign }: { initialCampaign?: InitialCampaign } = {}) {
  const router = useRouter();
  const [name, setName] = useState(initialCampaign?.name ?? "");
  const [objective, setObjective] = useState(initialCampaign?.objective ?? "");
  const [channel, setChannel] = useState<keyof typeof CHANNEL_LABELS>(initialCampaign?.channel ?? "META_ADS");
  const [startDate, setStartDate] = useState(initialCampaign?.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(initialCampaign?.endDate?.slice(0, 10) ?? "");
  const [budget, setBudget] = useState(initialCampaign?.budget ?? "0");
  const [ownerUserId, setOwnerUserId] = useState(initialCampaign?.owner?.id ?? "");
  const [notes, setNotes] = useState(initialCampaign?.notes ?? "");
  const [users, setUsers] = useState<Option[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/users?pageSize=200")
      .then((res) => res.json())
      .then((body) => setUsers(body.data ?? []));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const url = initialCampaign ? `/api/v1/campaigns/${initialCampaign.id}` : "/api/v1/campaigns";
    const res = await fetch(url, {
      method: initialCampaign ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        objective: objective || undefined,
        channel,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        budget: Number(budget),
        ownerUserId: ownerUserId || undefined,
        notes: notes || undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this campaign.");
      return;
    }

    const { data } = await res.json();
    router.push(`/campaigns/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <FormField label="Name" htmlFor="name" required>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={textInputClass()} />
      </FormField>

      <FormField label="Objective" htmlFor="objective">
        <input id="objective" value={objective} onChange={(e) => setObjective(e.target.value)} className={textInputClass()} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Channel" htmlFor="channel" required>
          <select id="channel" required value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className={textInputClass()}>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Budget" htmlFor="budget">
          <input id="budget" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Start Date" htmlFor="startDate">
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="End Date" htmlFor="endDate">
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <FormField label="Owner" htmlFor="ownerUserId">
        <SearchableSelect
          id="ownerUserId"
          value={ownerUserId}
          onChange={setOwnerUserId}
          options={users.map((u) => ({ id: u.id, label: u.fullName ?? "" }))}
          placeholder="Search user…"
        />
      </FormField>

      {!initialCampaign && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
          New campaigns start as Draft, pending approval. Status and approval are managed from the campaign&apos;s own page after it&apos;s created.
        </p>
      )}

      <FormField label="Notes" htmlFor="notes">
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} rows={3} />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : initialCampaign ? "Save Changes" : "Create Campaign"}
      </button>
    </form>
  );
}
