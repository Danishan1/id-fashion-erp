"use client";

import { useCallback, useEffect, useState } from "react";
import type { CrmBadgeTone } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import type { ActionParamDef } from "@/modules/crm/workflows/workflow-action-catalog";
import type { WorkflowDefinition } from "@/modules/crm/workflows/workflow-definition";
import type { WorkflowFieldDef } from "@/modules/crm/workflows/workflow-fields";

/** Phase 18 — client DTOs for the workflow screens (mirror crm-workflows.service.ts). */

export const WORKFLOWS_API = "/api/v1/crm/workflows";
export const WORKFLOW_EXECUTIONS_API = "/api/v1/crm/workflow-executions";

export interface LookupOption {
  value: string;
  label: string;
  kind?: string;
  channelType?: string;
}

export interface WorkflowMetaDto {
  statuses: { key: string; label: string; tone: string; description: string }[];
  executionStatuses: { key: string; label: string; tone: string; final: boolean }[];
  nodeTypes: { key: string; label: string; description: string }[];
  reentryModes: { key: string; label: string }[];
  triggers: { key: string; label: string; group: string; description: string; entity: string; payloadFields?: WorkflowFieldDef[] }[];
  unavailableTriggers: { key: string; reason: string }[];
  actions: { key: string; label: string; group: string; description: string; entities: string[]; params: ActionParamDef[]; sideEffect: string; retryable: boolean }[];
  unavailableActions: { key: string; label: string; reason: string }[];
  entities: { key: string; label: string; plural: string }[];
  recordFields: Record<string, WorkflowFieldDef[]>;
  commonFields: WorkflowFieldDef[];
  customFields: Record<string, WorkflowFieldDef[]>;
  limits: Record<string, unknown>;
  lookups: Record<string, LookupOption[]>;
}

export interface WorkflowVersionDto {
  id: string;
  versionNumber: number;
  status: string;
  definition: WorkflowDefinition;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
  createdBy: { name: string | null };
  publishedBy: { name: string | null } | null;
  executions?: number;
}

export interface WorkflowStats {
  active: number;
  completed: number;
  failed: number;
  total: number;
}

export interface WorkflowListRowDto {
  id: string;
  name: string;
  description: string | null;
  status: string;
  statusLabel: string;
  triggerLabel: string;
  publishedVersionNumber: number | null;
  hasDraft: boolean;
  runAs: { name: string | null } | null;
  lastTriggeredAt: string | null;
  updatedAt: string;
  stats: WorkflowStats;
}

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  status: string;
  statusLabel: string;
  version: number;
  triggerType: string | null;
  triggerLabel: string;
  runAs: { id: string; name: string | null } | null;
  hasWebhookSecret: boolean;
  draft: WorkflowVersionDto | null;
  published: WorkflowVersionDto | null;
  lastTriggeredAt: string | null;
  publishedAt: string | null;
  publishedBy: { name: string | null } | null;
  createdBy: { name: string | null };
  updatedAt: string;
  stats: WorkflowStats;
  allowedTransitions: string[];
}

export interface DefinitionIssueDto {
  path: string;
  nodeId?: string;
  message: string;
}

export interface ExecutionRowDto {
  id: string;
  workflow: { id: string; name: string };
  versionNumber: number;
  status: string;
  statusLabel: string;
  mode: string;
  triggerLabel: string;
  record: { entityType: string; entityId: string; label: string; href: string | null } | null;
  depth: number;
  currentNodeId: string | null;
  nextRunAt: string | null;
  stepCount: number;
  outcome: string | null;
  exitReason: string | null;
  error: { code: string | null; message: string | null } | null;
  runAs: { name: string | null } | null;
  startedBy: { name: string | null } | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExecutionStepDto {
  id: string;
  sequence: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  actionLabel: string | null;
  status: string;
  attempt: number;
  input: unknown;
  output: unknown;
  branch: string | null;
  error: { code: string | null; message: string | null } | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ExecutionDetailDto extends ExecutionRowDto {
  trigger: unknown;
  steps: ExecutionStepDto[];
}

const TONE: Record<string, CrmBadgeTone> = { zinc: "neutral", green: "green", amber: "amber", red: "red", indigo: "indigo" };
export const toneOf = (t: string | undefined): CrmBadgeTone => TONE[t ?? ""] ?? "neutral";

export function useWorkflowMeta() {
  const [meta, setMeta] = useState<WorkflowMetaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    crmRequest<WorkflowMetaDto>(`${WORKFLOWS_API}/meta`).then((r) => {
      if (r.ok) {
        setMeta(r.data);
        setError(null);
      } else setError(r.error.message);
    });
  }, []);
  useEffect(load, [load]);
  return { meta, error, reload: load };
}
