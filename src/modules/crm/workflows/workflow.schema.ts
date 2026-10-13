import { z } from "zod";
import { WORKFLOW_STATUSES, EXECUTION_STATUSES, type WorkflowStatusKey, type ExecutionStatusKey } from "./workflow-registry";
import { workflowDefinitionSchema } from "./workflow-definition";
import { WORKFLOW_TRIGGER_KEYS, type WorkflowTriggerKey } from "./workflow-triggers";

const uuid = z.string().uuid();
const version = z.number().int().min(1);

export const createWorkflowSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(1000).optional(),
    trigger: z.enum(WORKFLOW_TRIGGER_KEYS as [WorkflowTriggerKey, ...WorkflowTriggerKey[]]).default("lead.created"),
    /** Manual workflows: the record type. */
    entityType: z.string().optional(),
  })
  .strict();

export const updateWorkflowSchema = z
  .object({
    version,
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const saveDraftSchema = z
  .object({
    version,
    definition: workflowDefinitionSchema,
    changeNote: z.string().trim().max(300).optional(),
  })
  .strict();

export const publishSchema = z.object({ version, changeNote: z.string().trim().max(300).optional() }).strict();
export const lifecycleSchema = z.object({ version }).strict();
export const duplicateSchema = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict();

/** Test run: a dry run on a real record (nothing is changed or sent). */
export const testRunSchema = z
  .object({
    entityType: z.string(),
    entityId: uuid,
    /** "draft" (default when a draft exists) or "published". */
    source: z.enum(["draft", "published"]).optional(),
    /** Simulated trigger payload (e.g. { toStageId }) for conditions on trigger.* fields. */
    triggerPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();

/** Manual start on a real record (published workflows). */
export const manualRunSchema = z.object({ entityType: z.string(), entityId: uuid }).strict();

export const workflowFilterSchema = z.object({
  statuses: z.array(z.enum(Object.keys(WORKFLOW_STATUSES) as [WorkflowStatusKey, ...WorkflowStatusKey[]])).max(5).optional(),
  triggers: z.array(z.string()).max(50).optional(),
});
export type WorkflowFilters = z.infer<typeof workflowFilterSchema>;

export const executionFilterSchema = z.object({
  workflowId: uuid.optional(),
  statuses: z.array(z.enum(Object.keys(EXECUTION_STATUSES) as [ExecutionStatusKey, ...ExecutionStatusKey[]])).max(8).optional(),
  entityType: z.string().optional(),
  entityId: uuid.optional(),
  mode: z.enum(["LIVE", "TEST"]).optional(),
});
export type ExecutionFilters = z.infer<typeof executionFilterSchema>;

const list = (v: string | null) =>
  v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

export function parseWorkflowFilters(sp: URLSearchParams): WorkflowFilters {
  return workflowFilterSchema.parse({ statuses: list(sp.get("statuses")), triggers: list(sp.get("triggers")) });
}

export function parseExecutionFilters(sp: URLSearchParams): ExecutionFilters {
  return executionFilterSchema.parse({
    workflowId: sp.get("workflowId") || undefined,
    statuses: list(sp.get("statuses")),
    entityType: sp.get("entityType") || undefined,
    entityId: sp.get("entityId") || undefined,
    mode: sp.get("mode") || undefined,
  });
}
