"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { suggestCodeFromName } from "@/lib/code-suggest";
import { CARD, send, useCampaignLookups, type Option } from "./campaign-ui";

export interface CampaignFormValues {
  id?: string;
  code: string;
  name: string;
  description: string;
  typeId: string;
  objectiveId: string;
  ownerUserId: string;
  departmentId: string;
  salesChannelId: string;
  parentCampaignId: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  plannedStartDate: string;
  plannedEndDate: string;
  plannedBudget: string;
  budgetNotes: string;
  version?: number;
}

/**
 * Create a campaign (draft) or edit one. `planLocked`: after the first
 * approval, dates and budget change only through a plan change.
 */
export function CampaignForm({
  initial,
  planLocked = false,
  parentOptions = [],
  currentLabels = {},
}: {
  initial: CampaignFormValues;
  planLocked?: boolean;
  parentOptions?: Option[];
  /** Labels for current values that may no longer be in the active lists. */
  currentLabels?: Partial<Record<"typeId" | "objectiveId" | "ownerUserId" | "departmentId" | "salesChannelId", string>>;
}) {
  const router = useRouter();
  const lookups = useCampaignLookups();
  const [v, setV] = useState(initial);
  const [codeTouched, setCodeTouched] = useState(Boolean(initial.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per form, made on the first submit, so a double-click or a retried request never creates two campaigns.
  const idempotencyKey = useRef<string | null>(null);
  const set = (patch: Partial<CampaignFormValues>) => setV((x) => ({ ...x, ...patch }));
  const withCurrent = (opts: Option[], key: keyof typeof currentLabels) => {
    const id = initial[key];
    return id && !opts.some((o) => o.id === id) ? [{ id, label: currentLabels[key] ?? "Current" }, ...opts] : opts;
  };

  return (
    <form
      className={`${CARD} max-w-3xl space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const details = {
          name: v.name,
          description: v.description,
          typeId: v.typeId,
          objectiveId: v.objectiveId,
          ownerUserId: v.ownerUserId,
          departmentId: v.departmentId,
          salesChannelId: v.salesChannelId,
          parentCampaignId: v.parentCampaignId,
          priority: v.priority,
        };
        const plan = { plannedStartDate: v.plannedStartDate, plannedEndDate: v.plannedEndDate, plannedBudget: v.plannedBudget, budgetNotes: v.budgetNotes };
        try {
          if (v.id) {
            await send(`/api/v1/sales-marketing/campaigns/${v.id}`, "PATCH", { ...details, ...(planLocked ? {} : plan), version: v.version });
            router.push(`/sales-marketing/campaigns/${v.id}`);
          } else {
            idempotencyKey.current ??= `cmp-${crypto.randomUUID()}`;
            const r = await send<{ id: string }>("/api/v1/sales-marketing/campaigns", "POST", { code: v.code, ...details, ...plan, idempotencyKey: idempotencyKey.current });
            router.push(`/sales-marketing/campaigns/${r.id}`);
          }
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Name" htmlFor="c-name" required>
          <input
            id="c-name"
            required
            maxLength={200}
            value={v.name}
            onChange={(e) => set({ name: e.target.value, ...(codeTouched ? {} : { code: suggestCodeFromName(e.target.value).slice(0, 40) }) })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Code" htmlFor="c-code" required>
          <input id="c-code" required disabled={Boolean(v.id)} maxLength={40} value={v.code} onChange={(e) => (setCodeTouched(true), set({ code: e.target.value }))} className={textInputClass()} />
        </FormField>
        <FormField label="Priority" htmlFor="c-priority">
          <select id="c-priority" value={v.priority} onChange={(e) => set({ priority: e.target.value as CampaignFormValues["priority"] })} className={textInputClass()}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
          </select>
        </FormField>
      </div>
      <FormField label="Description" htmlFor="c-desc">
        <textarea id="c-desc" rows={3} maxLength={4000} value={v.description} onChange={(e) => set({ description: e.target.value })} className={textInputClass()} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Type" htmlFor="c-type" required>
          <SearchableSelect id="c-type" required value={v.typeId} onChange={(typeId) => set({ typeId })} options={withCurrent(lookups.types, "typeId")} placeholder="Choose a type…" />
        </FormField>
        <FormField label="Primary objective" htmlFor="c-objective" required>
          <SearchableSelect id="c-objective" required value={v.objectiveId} onChange={(objectiveId) => set({ objectiveId })} options={withCurrent(lookups.objectives, "objectiveId")} placeholder="Choose an objective…" />
        </FormField>
        <FormField label="Owner" htmlFor="c-owner" required>
          <SearchableSelect id="c-owner" required value={v.ownerUserId} onChange={(ownerUserId) => set({ ownerUserId })} options={withCurrent(lookups.owners, "ownerUserId")} placeholder="Search people…" />
        </FormField>
        <FormField label="Responsible department" htmlFor="c-dept">
          <SearchableSelect id="c-dept" value={v.departmentId} onChange={(departmentId) => set({ departmentId })} options={withCurrent(lookups.departments, "departmentId")} placeholder="Search departments…" emptyOptionLabel="— None —" />
        </FormField>
        <FormField label="Sales channel" htmlFor="c-channel">
          <SearchableSelect id="c-channel" value={v.salesChannelId} onChange={(salesChannelId) => set({ salesChannelId })} options={withCurrent(lookups.channels, "salesChannelId")} placeholder="Search channels…" emptyOptionLabel="— None —" />
        </FormField>
        <FormField label="Part of campaign" htmlFor="c-parent">
          <SearchableSelect id="c-parent" value={v.parentCampaignId} onChange={(parentCampaignId) => set({ parentCampaignId })} options={parentOptions.filter((p) => p.id !== v.id)} placeholder="Search campaigns…" emptyOptionLabel="— None —" />
        </FormField>
      </div>
      <fieldset className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <legend className="text-sm font-semibold">Plan</legend>
        {planLocked && <p className="text-xs text-amber-700 dark:text-amber-300">This campaign is approved: its dates and budget change through &quot;Request plan change&quot; on the campaign page, which someone else approves.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Planned start" htmlFor="c-start" required>
            <input id="c-start" type="date" required disabled={planLocked} value={v.plannedStartDate} onChange={(e) => set({ plannedStartDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Planned end" htmlFor="c-end" required>
            <input id="c-end" type="date" required disabled={planLocked} min={v.plannedStartDate} value={v.plannedEndDate} onChange={(e) => set({ plannedEndDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Planned budget (₹, optional)" htmlFor="c-budget">
            <input id="c-budget" type="number" min={0} step="0.01" disabled={planLocked} value={v.plannedBudget} onChange={(e) => set({ plannedBudget: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Budget notes" htmlFor="c-bnotes">
            <input id="c-bnotes" maxLength={2000} disabled={planLocked} value={v.budgetNotes} onChange={(e) => set({ budgetNotes: e.target.value })} className={textInputClass()} />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500">The planned budget is a planning figure. Actual spend comes from Expenses linked to the campaign.</p>
      </fieldset>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" isLoading={busy}>
          {v.id ? "Save" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
