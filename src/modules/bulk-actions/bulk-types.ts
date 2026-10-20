import type { z } from "zod";
import type { Action, Module } from "@/config/rbac";

/**
 * Phase 14 — Reusable Bulk Action Engine: the contracts a module implements to
 * plug an entity type and its bulk actions into the engine. See
 * docs/crm/PHASE_14_BULK_ACTION_ENGINE.md ("How to register a bulk action").
 *
 * The engine owns selection, persistence, batching, progress, cancellation,
 * retry, recovery, error reporting and the UI. A module owns only:
 *   - how to resolve a list filter into record ids (with its own visibility rules),
 *   - how to label a record,
 *   - per-record execution — always through the module's existing service layer.
 */

/** A user actor, same shape as every module's ActorContext. */
export interface BulkActor {
  companyId: string;
  userId: string;
  branchId: string | null;
}

export interface BulkPermission {
  module: Module;
  action: Action;
}

export type BulkSelectionMode = "IDS" | "PAGE" | "FILTER";

export type BulkActionKind = "update" | "assign" | "status" | "stage" | "tags" | "archive" | "restore" | "delete" | "export" | "workflow" | "sequence" | "communication";

/** Parameter inputs the generic bulk dialog knows how to render. Options are resolved per user. */
export type BulkParamField =
  | { key: string; label: string; type: "user"; required?: boolean; allowNone?: boolean; noneLabel?: string; help?: string; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "select"; required?: boolean; help?: string; placeholder?: string; options: { value: string; label: string; group?: string }[] }
  | { key: string; label: string; type: "tags"; help?: string; allowNew?: boolean; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "number"; min?: number; max?: number; help?: string }
  | { key: string; label: string; type: "date"; help?: string }
  | { key: string; label: string; type: "text"; maxLength?: number; help?: string; multiline?: boolean };

export interface BulkAvailability {
  available: boolean;
  reason?: string;
}

/** What the engine records for one processed record. Throw (any error) for FAILED. */
export interface BulkItemOutcome {
  status: "SUCCEEDED" | "SKIPPED";
  /** Short user-facing note ("Already assigned to this owner"). */
  message?: string;
  /** Small JSON output kept on the item (e.g. message id, workflow execution id, exported row). */
  result?: Record<string, unknown>;
}

export interface BulkItemContext<P> {
  actor: BulkActor;
  job: { id: string; companyId: string; entityType: string; actionKey: string };
  item: { id: string; entityId: string; sequence: number; attempt: number };
  params: P;
  /** Stable for a job item across retries/recovery: `bulk:<jobId>:<entityId>`. */
  idempotencyKey: string;
}

/** For actions that are much cheaper per batch than per record (exports). */
export interface BulkBatchContext<P> {
  actor: BulkActor;
  job: { id: string; companyId: string; entityType: string; actionKey: string };
  items: { id: string; entityId: string; sequence: number; attempt: number }[];
  params: P;
}

export interface BulkFinalizeContext<P> {
  actor: BulkActor;
  job: { id: string; companyId: string; entityType: string; actionKey: string; createdAt: Date };
  params: P;
}

export interface BulkPrepared<P> {
  params: P;
  /** Human summary stored on the job ("Owner → Priya Shah"). */
  summary: string;
  warnings?: string[];
}

/**
 * One bulk action. `executeItem` must call the module's existing service-layer
 * function for one record (never write tables directly) so validation,
 * permissions, visibility, audit and timeline events apply exactly as in the UI.
 */
export interface BulkActionDefinition<P = Record<string, unknown>> {
  key: string;
  entityType: string;
  kind: BulkActionKind;
  label: string;
  description: string;
  /** Every permission listed is required (checked at submit AND again when the job starts). */
  permissions: BulkPermission[];
  paramsSchema: z.ZodType<P>;
  fields?: (actor: BulkActor) => Promise<BulkParamField[]>;
  /** Changes or removes data in a way that is hard to reverse (archive, send). */
  destructive?: boolean;
  /** none: submit directly · confirm: confirmation step · type_count: user types the record count. */
  confirmation: "none" | "confirm" | "type_count";
  /**
   * true when re-running a record whose outcome is unknown (worker crashed mid-record)
   * cannot cause a duplicate effect. false → such items are failed as OUTCOME_UNKNOWN
   * instead of being re-run automatically.
   */
  retrySafe: boolean;
  cancellable: boolean;
  maxItems: number;
  /** Static "not available" (with the reason shown in the UI). */
  unavailableReason?: string;
  /** Dynamic availability (e.g. depends on configuration). */
  availability?: (actor: BulkActor) => Promise<BulkAvailability>;
  /** Validates referenced data (owner active, status exists…) and normalises params. Runs at submit and at job start. */
  prepare?: (actor: BulkActor, params: P) => Promise<BulkPrepared<P>>;
  executeItem?: (ctx: BulkItemContext<P>) => Promise<BulkItemOutcome>;
  /** Alternative to executeItem: one call per batch. Returns an outcome (or an Error) per item id; a thrown error fails the whole batch. */
  executeBatch?: (ctx: BulkBatchContext<P>) => Promise<Map<string, BulkItemOutcome | Error>>;
  /** Runs once after all items (e.g. builds the export file). Returns the job's `result`. */
  finalize?: (ctx: BulkFinalizeContext<P>) => Promise<Record<string, unknown> | null>;
}

export interface BulkEntityDefinition {
  entityType: string;
  label: string;
  pluralLabel: string;
  /** Needed to see bulk actions for this entity at all. */
  viewPermission: BulkPermission;
  /** Holders can see and manage every user's bulk jobs for this entity type. */
  adminPermission: BulkPermission;
  /** Validates the list page's query string (same format as the list API); throws on invalid input. */
  parseFilterQuery: (query: string) => Record<string, unknown>;
  /** Ids matching a parsed filter, as the actor sees them (visibility rules applied), in list order, up to `limit`. */
  resolveFilterIds: (actor: BulkActor, filter: Record<string, unknown>, limit: number) => Promise<{ ids: string[]; total: number }>;
  /** Which of these ids exist and are visible to the actor. */
  visibleIds: (actor: BulkActor, ids: string[]) => Promise<Set<string>>;
  /** Display labels for records (no visibility filtering — only used for ids already in a job). */
  recordLabels: (companyId: string, ids: string[]) => Promise<Map<string, string>>;
  recordHref: (id: string) => string;
  listHref: string;
}
