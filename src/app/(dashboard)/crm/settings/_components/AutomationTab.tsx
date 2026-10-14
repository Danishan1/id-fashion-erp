"use client";

import Link from "next/link";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { useWorkflowMeta } from "@/components/crm/workflows/workflow-types";
import { WEBHOOK_EVENTS } from "@/modules/crm/webhooks-out/webhook-events";
import type { CrmSettingsTab } from "./CrmSettingsClient";

/**
 * Phase 22 — CRM Settings → Workflows & events: what automation can react to
 * and do, straight from the workflow registry (GET /workflows/meta) and the
 * CRM event registry. Configuration itself stays in the Workflows module.
 */

const linkCls = "text-indigo-700 hover:underline dark:text-indigo-300";

function group<T extends { group: string }>(items: T[]) {
  return items.reduce<Record<string, T[]>>((acc, i) => {
    (acc[i.group] ??= []).push(i);
    return acc;
  }, {});
}

export function AutomationTab({ onSelect }: { onSelect: (t: CrmSettingsTab) => void }) {
  const { meta, error, reload } = useWorkflowMeta();
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!meta) return <CrmLoadingState />;
  const unavailableTriggers = new Map(meta.unavailableTriggers.map((t) => [t.key, t.reason]));
  return (
    <div className="space-y-6 text-sm">
      <div className="flex flex-wrap gap-4">
        <Link className={linkCls} href="/crm/workflows">
          Open workflows
        </Link>
        <Link className={linkCls} href="/crm/workflows?new=1">
          Create a workflow
        </Link>
        <Link className={linkCls} href="/crm/workflows/executions">
          Execution history
        </Link>
        <button type="button" className={linkCls} onClick={() => onSelect("webhooks-out")}>
          Outgoing webhooks
        </button>
      </div>
      <p className="max-w-3xl text-zinc-600 dark:text-zinc-300">
        Workflows run in the background worker: a trigger starts a run for a record, conditions decide the path and actions do the work. Every run is recorded with its steps. Developer guides are in <code>docs/crm/workflows/</code>.
      </p>

      <section className="space-y-2">
        <h3 className="font-semibold">Triggers ({meta.triggers.length})</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(group(meta.triggers)).map(([g, items]) => (
            <div key={g} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">{g}</p>
              <ul className="space-y-1">
                {items.map((t) => (
                  <li key={t.key}>
                    <span className="font-medium">{t.label}</span> <code className="text-[11px] text-zinc-500">{t.key}</code>
                    {unavailableTriggers.has(t.key) && <span className="ml-1 text-xs text-amber-700 dark:text-amber-300">— {unavailableTriggers.get(t.key)}</span>}
                    <div className="text-xs text-zinc-500">{t.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Actions ({meta.actions.length})</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(group(meta.actions)).map(([g, items]) => (
            <div key={g} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">{g}</p>
              <ul className="space-y-1">
                {items.map((a) => (
                  <li key={a.key}>
                    <span className="font-medium">{a.label}</span>
                    <div className="text-xs text-zinc-500">{a.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {meta.unavailableActions.length > 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
            <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">Not available</p>
            <ul className="space-y-1">
              {meta.unavailableActions.map((a) => (
                <li key={a.key}>
                  <CrmBadge label="Not available" /> <span className="font-medium">{a.label}</span> — <span className="text-xs text-zinc-500">{a.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">CRM events ({WEBHOOK_EVENTS.length})</h3>
        <p className="max-w-3xl text-zinc-600 dark:text-zinc-300">
          Recorded on every record&apos;s timeline when the change happens. Each can be sent to another system with an{" "}
          <button type="button" className={linkCls} onClick={() => onSelect("webhooks-out")}>
            outgoing webhook
          </button>
          .
        </p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {WEBHOOK_EVENTS.map((e) => (
            <div key={e.type}>
              {e.label} <code className="text-[11px] text-zinc-500">{e.type}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
