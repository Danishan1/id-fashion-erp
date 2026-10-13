"use client";

import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { executionColumns } from "./WorkflowDetailClient";
import { WORKFLOW_EXECUTIONS_API, useWorkflowMeta, type ExecutionRowDto } from "./workflow-types";

/** Phase 18 — every execution across workflows (monitoring). */
export function ExecutionsListClient() {
  const { meta, error, reload } = useWorkflowMeta();
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!meta) return <CrmLoadingState />;
  return (
    <CrmTable<ExecutionRowDto>
      fetchUrl={WORKFLOW_EXECUTIONS_API}
      filters={[
        { type: "select", key: "statuses", label: "Status", options: meta.executionStatuses.map((s) => ({ value: s.key, label: s.label })) },
        { type: "select", key: "mode", label: "Mode", options: [{ value: "LIVE", label: "Live" }, { value: "TEST", label: "Tests" }], anyLabel: "Live" },
      ]}
      rowHref={(r) => `/crm/workflows/executions/${r.id}`}
      initialSort={{ sortBy: "createdAt", sortOrder: "desc" }}
      columns={executionColumns(meta, true)}
    />
  );
}
