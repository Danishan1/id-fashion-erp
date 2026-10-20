"use client";

import Link from "next/link";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { formatDateTime } from "@/lib/date-format";
import { toneOf, type ExecutionDetailDto, type WorkflowMetaDto } from "./workflow-types";

const STEP_TONE: Record<string, CrmBadgeTone> = { COMPLETED: "green", SIMULATED: "indigo", FAILED: "red", WAITING: "amber", RUNNING: "indigo", SKIPPED: "neutral" };

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length)) return null;
  return <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900">{JSON.stringify(value, null, 2)}</pre>;
}

/** Phase 18 — an execution and its step-by-step trace (input, output, branch, error). */
export function ExecutionTrace({ execution: e, meta }: { execution: ExecutionDetailDto; meta: WorkflowMetaDto }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CrmBadge label={e.statusLabel} tone={toneOf(meta.executionStatuses.find((s) => s.key === e.status)?.tone)} />
        {e.mode === "TEST" && <CrmBadge label="Test — nothing was changed or sent" tone="indigo" />}
        <span className="text-zinc-500">
          <Link className="hover:underline" href={`/crm/workflows/${e.workflow.id}`}>
            {e.workflow.name}
          </Link>{" "}
          v{e.versionNumber} · {e.triggerLabel}
          {e.record ? (
            <>
              {" "}
              · {e.record.href ? <Link className="hover:underline" href={e.record.href}>{e.record.label}</Link> : e.record.label}
            </>
          ) : null}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        Started {formatDateTime(e.createdAt)}
        {e.finishedAt ? ` · finished ${formatDateTime(e.finishedAt)}` : ""}
        {e.nextRunAt && !e.finishedAt ? ` · next step at ${formatDateTime(e.nextRunAt)}` : ""} · {e.stepCount} step(s) · run as {e.runAs?.name ?? "—"}
        {e.startedBy ? ` · started by ${e.startedBy.name ?? "—"}` : ""}
        {e.depth > 0 ? ` · started by another workflow (depth ${e.depth})` : ""}
      </p>
      {e.error && (
        <p className="rounded bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {e.error.code ? <strong>{e.error.code}: </strong> : null}
          {e.error.message}
        </p>
      )}
      {e.exitReason && !e.error && <p className="text-sm text-zinc-600 dark:text-zinc-400">{e.exitReason}</p>}
      <ol className="space-y-2">
        {e.steps.map((s) => (
          <li key={s.id} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">#{s.sequence}</span>
              <span className="font-medium">{s.nodeName}</span>
              <span className="font-mono text-xs text-zinc-400">{s.nodeId}</span>
              <CrmBadge label={s.status.toLowerCase()} tone={STEP_TONE[s.status] ?? "neutral"} />
              {s.branch && <CrmBadge label={`→ ${s.branch}`} tone="neutral" />}
              {s.attempt > 1 && <span className="text-xs text-zinc-500">attempt {s.attempt}</span>}
              <span className="ml-auto text-xs text-zinc-400">{formatDateTime(s.startedAt)}</span>
            </div>
            {s.error && <p className="mt-1 text-xs text-red-600">{s.error.code ? `${s.error.code}: ` : ""}{s.error.message}</p>}
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-zinc-500">Input / output</summary>
              <Json value={s.input} />
              <Json value={s.output} />
            </details>
          </li>
        ))}
        {!e.steps.length && <li className="text-sm text-zinc-500">No steps yet.</li>}
      </ol>
    </div>
  );
}
