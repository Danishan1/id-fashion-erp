"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { suggestCodeFromName } from "@/lib/code-suggest";
import { ELIGIBILITY_CHANNELS, ELIGIBILITY_CHANNEL_KEYS, SEGMENT_REFRESH, SEGMENT_SOURCES, SEGMENT_TYPES, type SegmentSourceKey } from "@/modules/sales-marketing/segments/segment-registry";
import { CARD, send, useApi } from "./segment-ui";

interface Options {
  owners: { id: string; label: string }[];
  sources: SegmentSourceKey[];
}

/** New segment (Phase 09): details only — rules / members are added on the segment page. */
export function SegmentForm({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const { data: opts } = useApi<Options>("/api/v1/sales-marketing/segments/options");
  const [v, setV] = useState({ code: "", name: "", description: "", purpose: "", sourceType: "" as SegmentSourceKey | "", segmentType: "DYNAMIC" as "DYNAMIC" | "STATIC", ownerUserId: currentUserId, refreshSchedule: "MANUAL" as "MANUAL" | "NIGHTLY", eligibilityChannel: "" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const sources = opts?.sources ?? [];
  const sourceType = v.sourceType || (sources.length === 1 ? sources[0] : "");

  return (
    <form
      className={`${CARD} max-w-3xl space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          idempotencyKey.current ??= `seg-${crypto.randomUUID()}`;
          const r = await send<{ id: string }>("/api/v1/sales-marketing/segments", "POST", {
            ...v,
            sourceType,
            eligibilityChannel: v.eligibilityChannel || null,
            refreshSchedule: v.segmentType === "STATIC" ? "MANUAL" : v.refreshSchedule,
            idempotencyKey: idempotencyKey.current,
          });
          router.push(`/sales-marketing/segments/${r.id}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name" htmlFor="s-name" required>
          <input id="s-name" required maxLength={200} value={v.name} onChange={(e) => set({ name: e.target.value, ...(codeTouched ? {} : { code: suggestCodeFromName(e.target.value).slice(0, 40) }) })} className={textInputClass()} />
        </FormField>
        <FormField label="Code" htmlFor="s-code" required>
          <input id="s-code" required maxLength={40} value={v.code} onChange={(e) => (setCodeTouched(true), set({ code: e.target.value }))} className={textInputClass()} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="s-desc">
        <textarea id="s-desc" rows={2} maxLength={2000} value={v.description} onChange={(e) => set({ description: e.target.value })} className={textInputClass()} />
      </FormField>
      <FormField label="Business purpose / who this audience is" htmlFor="s-purpose">
        <input id="s-purpose" maxLength={1000} value={v.purpose} onChange={(e) => set({ purpose: e.target.value })} className={textInputClass()} placeholder="e.g. Export buyers in the EU for the winter collection launch" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Records in this segment" htmlFor="s-source" required>
          <select id="s-source" required value={sourceType} onChange={(e) => set({ sourceType: e.target.value as SegmentSourceKey })} className={textInputClass()}>
            <option value="">Choose…</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_SOURCES[s].label}
              </option>
            ))}
          </select>
          {opts && !sources.length && <p className="mt-1 text-xs text-red-600">You need access to the CRM or the Customer master to build a segment.</p>}
        </FormField>
        <FormField label="Segment type" htmlFor="s-type" required>
          <select id="s-type" value={v.segmentType} onChange={(e) => set({ segmentType: e.target.value as "DYNAMIC" | "STATIC" })} className={textInputClass()}>
            <option value="DYNAMIC">{SEGMENT_TYPES.DYNAMIC.label}</option>
            <option value="STATIC">{SEGMENT_TYPES.STATIC.label}</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">{SEGMENT_TYPES[v.segmentType].hint} The type and record kind can&apos;t change later.</p>
        </FormField>
        <FormField label="Owner" htmlFor="s-owner" required>
          <SearchableSelect id="s-owner" required value={v.ownerUserId} onChange={(ownerUserId) => set({ ownerUserId })} options={opts?.owners ?? []} placeholder="Search people…" />
        </FormField>
        <FormField label="Meant for channel (eligibility check)" htmlFor="s-channel">
          <select id="s-channel" value={v.eligibilityChannel} onChange={(e) => set({ eligibilityChannel: e.target.value })} className={textInputClass()}>
            <option value="">No channel check</option>
            {ELIGIBILITY_CHANNEL_KEYS.map((k) => (
              <option key={k} value={k}>
                {ELIGIBILITY_CHANNELS[k]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Leaves out records with no address for the channel and, for CRM contacts, those who opted out.</p>
        </FormField>
        {v.segmentType === "DYNAMIC" && (
          <FormField label="Refresh" htmlFor="s-refresh">
            <select id="s-refresh" value={v.refreshSchedule} onChange={(e) => set({ refreshSchedule: e.target.value as "MANUAL" | "NIGHTLY" })} className={textInputClass()}>
              {(Object.keys(SEGMENT_REFRESH) as (keyof typeof SEGMENT_REFRESH)[]).map((k) => (
                <option key={k} value={k}>
                  {SEGMENT_REFRESH[k]}
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.push("/sales-marketing/segments")}>
          Cancel
        </Button>
        <Button type="submit" isLoading={busy} loadingLabel="Creating…" disabled={!sourceType}>
          Create segment
        </Button>
      </div>
    </form>
  );
}
