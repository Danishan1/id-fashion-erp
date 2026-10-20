"use client";

import { useCallback, useEffect, useState } from "react";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ExecutionTrace } from "./ExecutionTrace";
import { WORKFLOW_EXECUTIONS_API, useWorkflowMeta, type ExecutionDetailDto } from "./workflow-types";

/** Phase 18 — one execution: trace plus cancel / pause / resume / retry. */
export function ExecutionDetailClient({ id, canEdit }: { id: string; canEdit: boolean }) {
  const { meta, error: metaError } = useWorkflowMeta();
  const [ex, setEx] = useState<ExecutionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(
    () =>
      crmRequest<ExecutionDetailDto>(`${WORKFLOW_EXECUTIONS_API}/${id}`).then((r) => {
        if (r.ok) setEx(r.data);
        else setError(r.error.message);
      }),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);
  if (error || metaError) return <CrmErrorState message={(error ?? metaError)!} onRetry={load} />;
  if (!ex || !meta) return <CrmLoadingState />;
  const act = async (a: "cancel" | "pause" | "resume" | "retry") => {
    setBusy(a);
    const r = await crmRequest<ExecutionDetailDto>(`${WORKFLOW_EXECUTIONS_API}/${id}/${a}`, { method: "POST", successMessage: `Execution ${a === "retry" ? "retried" : a === "cancel" ? "cancelled" : `${a}d`}` });
    setBusy(null);
    if (r.ok) setEx(r.data);
  };
  const live = ex.mode === "LIVE";
  return (
    <div className="space-y-4">
      {canEdit && live && (
        <div className="flex flex-wrap gap-2">
          {["QUEUED", "WAITING", "PAUSED"].includes(ex.status) && (
            <Button variant="danger" onClick={() => act("cancel")} isLoading={busy === "cancel"}>
              Cancel
            </Button>
          )}
          {["QUEUED", "WAITING"].includes(ex.status) && (
            <Button variant="secondary" onClick={() => act("pause")} isLoading={busy === "pause"}>
              Pause
            </Button>
          )}
          {ex.status === "PAUSED" && (
            <Button onClick={() => act("resume")} isLoading={busy === "resume"}>
              Resume
            </Button>
          )}
          {ex.status === "FAILED" && (
            <Button onClick={() => act("retry")} isLoading={busy === "retry"}>
              Retry from the failed step
            </Button>
          )}
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>
      )}
      <ExecutionTrace execution={ex} meta={meta} />
    </div>
  );
}
