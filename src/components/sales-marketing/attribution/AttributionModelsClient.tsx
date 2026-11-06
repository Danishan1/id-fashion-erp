"use client";

import { SmBulkActions, bulkFilterQuery, toggleId } from "@/components/sales-marketing/bulk/SmBulkActions";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDateTime } from "@/lib/date-format";
import { MODEL_STATUSES, VERSION_STATUSES } from "@/modules/sales-marketing/attribution/attribution-registry";
import { Badge, CARD, FormButtons, FormField, RulesEditor, defaultRules, rulesPayload, rulesSummary, send, useApi, type Rules, type RulesDraft } from "./attribution-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  status: keyof typeof MODEL_STATUSES;
  isDefault: boolean;
  approved: (Rules & { id: string; number: number }) | null;
  openVersion: { number: number; status: keyof typeof VERSION_STATUSES } | null;
  lastRun: { finishedAt: string | null; from: string; to: string } | null;
}

/** Attribution models: list and create (Phase 13). */
export function AttributionModelsClient({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const { data, error, reload } = useApi<Row[]>(`/api/v1/sales-marketing/attribution/models${all ? "?all=1" : ""}`);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show retired models
        </label>
        <div className="flex items-center gap-2">
          <SmBulkActions entityType="ATTRIBUTION_MODEL" selectedIds={selected} filterQuery={bulkFilterQuery({ all: all && "1" })} onDone={() => setSelected([])} />
          {canCreate && !creating && <Button onClick={() => setCreating(true)}>New model</Button>}
        </div>
      </div>
      {creating && <CreateModel onCancel={() => setCreating(false)} onCreated={(id) => router.push(`/sales-marketing/attribution/models/${id}`)} />}
      {data.length === 0 && !creating ? (
        <p className={`${CARD} text-sm text-zinc-500`}>No attribution models yet. A model needs approval by someone other than its author before it can be calculated.</p>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="w-8 py-1.5 pr-2">
                  <input type="checkbox" aria-label="Select all models" checked={data.length > 0 && data.every((m) => selected.includes(m.id))} onChange={(e) => setSelected(e.target.checked ? data.map((m) => m.id) : [])} />
                </th>
                <th className="py-1.5 pr-3 font-medium">Model</th>
                <th className="py-1.5 pr-3 font-medium">Approved rules</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">Last calculation</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label={`Select ${m.code}`} checked={selected.includes(m.id)} onChange={(e) => setSelected(toggleId(selected, m.id, e.target.checked))} />
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/sales-marketing/attribution/models/${m.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {m.code}
                    </Link>
                    <div className="text-xs text-zinc-500">{m.name}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {m.approved ? `v${m.approved.number}: ${rulesSummary(m.approved)}` : <span className="text-zinc-400">Nothing approved yet</span>}
                    {m.openVersion && (
                      <div className="mt-1">
                        <Badge tone={m.openVersion.status === "PENDING_APPROVAL" ? "amber" : "zinc"}>
                          v{m.openVersion.number} {VERSION_STATUSES[m.openVersion.status].label.toLowerCase()}
                        </Badge>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={MODEL_STATUSES[m.status].tone}>{MODEL_STATUSES[m.status].label}</Badge> {m.isDefault && <Badge tone="indigo">Default</Badge>}
                  </td>
                  <td className="py-2 text-xs text-zinc-500">{m.lastRun ? `${m.lastRun.from} – ${m.lastRun.to}, ${m.lastRun.finishedAt ? formatDateTime(m.lastRun.finishedAt) : ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateModel({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<RulesDraft>(defaultRules());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = textInputClass();
  return (
    <form
      className={`${CARD} space-y-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          onCreated((await send<{ id: string }>("/api/v1/sales-marketing/attribution/models", "POST", { code, name, description, rules: rulesPayload(rules) })).id);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Code" htmlFor="m-code" required>
          <input id="m-code" required maxLength={30} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={input} />
        </FormField>
        <FormField label="Name" htmlFor="m-name" required>
          <input id="m-name" required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Description" htmlFor="m-desc">
            <textarea id="m-desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
          </FormField>
        </div>
      </div>
      <RulesEditor value={rules} onChange={setRules} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="Save as draft" />
    </form>
  );
}
