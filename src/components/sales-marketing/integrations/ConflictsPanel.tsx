"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { CONFLICT_STATUSES } from "@/modules/sales-marketing/integrations/integration-registry";
import { INT_API, StatusBadge, fmtValue, send, useApi, type ConflictRow } from "./integration-ui";

type Action = "keep_erp" | "apply_external" | "dismiss";
const ACTION_LABEL: Record<Action, string> = { keep_erp: "Keep the ERP value", apply_external: "Apply the external value", dismiss: "Dismiss" };

/** Phase 16 — sync conflicts: external changes the intake refused to apply silently. */
export function ConflictsPanel({ canApprove }: { canApprove: boolean }) {
  const [status, setStatus] = useState("OPEN");
  const { data, error, reload } = useApi<{ rows: ConflictRow[]; totalCount: number }>(`${INT_API}/conflicts?take=50${status ? `&status=${status}` : ""}`);
  const [resolving, setResolving] = useState<{ c: ConflictRow; action: Action } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;

  const resolve = async () => {
    if (!resolving) return;
    setBusy(true);
    setMsg(null);
    try {
      await send(`${INT_API}/conflicts/${resolving.c.id}`, "POST", { action: resolving.action, note });
      setResolving(null);
      setNote("");
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Once an external system has created an enquiry, the ERP owns it. A later external change is applied only to the subject, remarks or priority, only while the enquiry is still New or Under review, and only if nobody changed that field here. Anything else lands here for a person to decide — nothing is overwritten silently.
      </p>
      <select aria-label="Conflict status" className={`${textInputClass()} max-w-xs`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option>
        {Object.entries(CONFLICT_STATUSES).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      {msg && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {msg}
        </p>
      )}
      {data.rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No conflicts.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">ERP value</th>
                <th className="px-3 py-2 font-medium">External value</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((c) => {
                const st = CONFLICT_STATUSES[c.status as keyof typeof CONFLICT_STATUSES];
                return (
                  <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">
                      <Link href={c.record.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {c.record.number ?? "Enquiry"}
                      </Link>
                      <div className="text-xs text-zinc-500">
                        {c.external.system} · {c.external.id}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs">{c.field}</code>
                      <div className="text-xs text-zinc-500">{c.reasonLabel}</div>
                    </td>
                    <td className="max-w-xs break-words px-3 py-2 text-xs">{fmtValue(c.erpValue)}</td>
                    <td className="max-w-xs break-words px-3 py-2 text-xs">
                      {fmtValue(c.externalValue)}
                      {c.sourceUpdatedAt && (
                        <div className="text-zinc-500">
                          sent <ClientDateTime value={c.sourceUpdatedAt} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge label={st?.label ?? c.status} tone={st?.tone ?? "zinc"} />
                      {c.resolvedBy && (
                        <div className="text-xs text-zinc-500">
                          {c.resolvedBy}
                          {c.resolutionNote ? `: ${c.resolutionNote}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {canApprove && c.status === "OPEN" && (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="xs" variant="secondary" onClick={() => setResolving({ c, action: "keep_erp" })}>
                            Keep ERP
                          </Button>
                          {c.canApply && (
                            <Button size="xs" variant="secondary" onClick={() => setResolving({ c, action: "apply_external" })}>
                              Apply external
                            </Button>
                          )}
                          <Button size="xs" variant="secondary" onClick={() => setResolving({ c, action: "dismiss" })}>
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={resolving !== null} onClose={() => !busy && setResolving(null)} title={resolving ? `${ACTION_LABEL[resolving.action]}?` : ""}>
        {resolving && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {resolving.action === "apply_external"
                ? `The enquiry's ${resolving.c.field} becomes "${fmtValue(resolving.c.externalValue)}" — saved as you, with the enquiry's own rules.`
                : resolving.action === "keep_erp"
                  ? "The ERP value stays. The external system's value is kept here for the record."
                  : "Closes the conflict without a decision on the value."}
            </p>
            <label className="block text-sm">
              <span className="block font-medium">Note (optional)</span>
              <input className={textInputClass()} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setResolving(null)}>
                Back
              </Button>
              <Button disabled={busy} onClick={resolve}>
                {ACTION_LABEL[resolving.action]}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
