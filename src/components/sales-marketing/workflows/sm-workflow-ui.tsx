"use client";

import type { ConditionGroup } from "@/modules/crm/workflows/workflow-conditions";
import type { WorkflowFieldDef } from "@/modules/crm/workflows/workflow-fields";
import type { SmWfSettingField } from "@/modules/sales-marketing/workflows/sm-workflow-registry";
import { Badge } from "../pricing/pricing-ui";

export { Badge, CARD } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";

/** Phase 15 — shared bits of the S&M workflow screens (DTOs mirror sm-workflows.service.ts). */

export const SM_WF_API = "/api/v1/sales-marketing/workflows";
export const SM_WF_PAGE = "/sales-marketing/workflows";

type Tone = "zinc" | "green" | "amber" | "indigo" | "red";
const TONES: Record<string, Tone> = { zinc: "zinc", green: "green", amber: "amber", indigo: "indigo", red: "red", sky: "indigo" };
export const toneOf = (t: string | null | undefined): Tone => TONES[t ?? "zinc"] ?? "zinc";

export function WfStatusBadge({ label, tone }: { label: string; tone: string }) {
  return <Badge tone={toneOf(tone)}>{label}</Badge>;
}

export interface DefinitionRow {
  key: string;
  name: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
  activeVersion: number | null;
  hasDraft: boolean;
  runAs: string | null;
  activatedAt: string | null;
  live: number;
  attention: number;
  completed: number;
}

export interface VersionDto {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  settings: Record<string, unknown>;
  conditions: { entry: ConditionGroup };
  changeNote: string | null;
  createdBy: string | null;
  createdAt: string;
  activatedAt: string | null;
  activatedBy: string | null;
}

export interface DefinitionDto {
  key: string;
  definitionId: string;
  name: string;
  description: string;
  entityLabel: string;
  triggers: string[];
  steps: { key: string; label: string; kind: string }[];
  boundaries: string[];
  settingFields: SmWfSettingField[];
  conditionFields: WorkflowFieldDef[];
  requiredPermissions: { module: string; action: string }[];
  taskPermissions: { module: string; action: string }[];
  status: "ACTIVE" | "INACTIVE";
  version: number;
  runAs: { id: string; name: string | null } | null;
  runAsIssue: string | null;
  activatedAt: string | null;
  activeVersion: VersionDto | null;
  draft: VersionDto | null;
  versions: VersionDto[];
  canEdit: boolean;
}

export interface InstanceRow {
  id: string;
  workflowKey: string;
  workflowName: string;
  version: number;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  entityHref: string | null;
  status: string;
  statusLabel: string;
  statusTone: string;
  currentStep: string;
  currentStepLabel: string;
  outcome: string | null;
  outcomeLabel: string | null;
  errorMessage: string | null;
  nextRunAt: string | null;
  startedAt: string;
  updatedAt: string;
  triggerSource: string;
}

export interface InstanceDto {
  id: string;
  workflowKey: string;
  workflowName: string;
  version: number;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  entityHref: string | null;
  status: string;
  statusLabel: string;
  statusTone: string;
  currentStep: string;
  plan: { key: string; label: string; kind: string; state: "done" | "current" | "pending" }[];
  nextRunAt: string | null;
  waitingSince: string | null;
  attempts: number;
  outcome: string | null;
  outcomeLabel: string | null;
  outcomeMessage: string | null;
  error: { code: string; message: string | null } | null;
  compensationStatus: string | null;
  triggerSource: string;
  triggerEventKey: string | null;
  trigger: { type: string; at: string } | null;
  initiatedBy: string | null;
  correlationId: string;
  checklist: { key: string; label: string; ok: boolean; detail: string }[] | null;
  references: { quotationId: string | null; quotationNumber: string | null; orderId: string | null; orderNumber: string | null; exception: string | null; kind: string | null };
  tasks: { id: string; subject: string; status: string; dueAt: string | null; assignee: string | null }[];
  steps: {
    id: string;
    sequence: number;
    stepKey: string;
    label: string;
    kind: string;
    status: string;
    attempt: number;
    summary: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    actor: string | null;
    startedAt: string;
    lastCheckAt: string | null;
    finishedAt: string | null;
  }[];
  actions: { key: string; label: string; help: string }[];
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface MetricsDto {
  running: number;
  waiting: number;
  waitingApproval: number;
  needsAttention: number;
  completed30d: number;
  failed30d: number;
  completionRate30d: number | null;
  avgApprovalWaitHours: number | null;
  retries30d: number;
  compensationFailed: number;
  overdueRuns: number;
  maxQueueLatencySeconds: number;
  eventLagSeconds: number | null;
  byWorkflow: { key: string; name: string; live: number; attention: number }[];
}

export const STEP_STATUS: Record<string, { label: string; tone: Tone }> = {
  RUNNING: { label: "Running", tone: "indigo" },
  WAITING: { label: "Waiting", tone: "amber" },
  DONE: { label: "Done", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SKIPPED: { label: "Skipped", tone: "zinc" },
  COMPENSATED: { label: "Undone", tone: "zinc" },
  COMPENSATION_FAILED: { label: "Undo failed", tone: "red" },
};

export const TRIGGER_SOURCE: Record<string, string> = { EVENT: "Event", MANUAL: "Started by a person" };

export const permText = (p: { module: string; action: string }) => `${p.module}.${p.action}`;
