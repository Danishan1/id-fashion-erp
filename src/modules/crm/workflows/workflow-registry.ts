/**
 * Client-safe constants of the Phase 18 workflow engine (no Prisma runtime /
 * server imports). Statuses, node types, waits, re-entry modes and the hard
 * limits the engine enforces. Shared by the API, the engine and the screens.
 */

export const WORKFLOW_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc", description: "Being built. Never runs." },
  PUBLISHED: { label: "Active", tone: "green", description: "Starts on its trigger and runs its steps." },
  PAUSED: { label: "Paused", tone: "amber", description: "New triggers are ignored; running executions hold where they are until resumed." },
  DISABLED: { label: "Disabled", tone: "red", description: "Switched off. New triggers are ignored; waiting executions were cancelled." },
  ARCHIVED: { label: "Archived", tone: "zinc", description: "Kept for history. Can't run." },
} as const;
export type WorkflowStatusKey = keyof typeof WORKFLOW_STATUSES;

/**
 * Lifecycle moves. Publishing (DRAFT → PUBLISHED, or a new version of an
 * already published workflow) is its own action, not listed here.
 */
export const WORKFLOW_TRANSITIONS: Record<WorkflowStatusKey, readonly WorkflowStatusKey[]> = {
  DRAFT: ["ARCHIVED"],
  PUBLISHED: ["PAUSED", "DISABLED", "ARCHIVED"],
  PAUSED: ["PUBLISHED", "DISABLED", "ARCHIVED"],
  DISABLED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export const EXECUTION_STATUSES = {
  QUEUED: { label: "Queued", tone: "zinc", final: false },
  RUNNING: { label: "Running", tone: "indigo", final: false },
  WAITING: { label: "Waiting", tone: "amber", final: false },
  PAUSED: { label: "Paused", tone: "amber", final: false },
  COMPLETED: { label: "Completed", tone: "green", final: true },
  FAILED: { label: "Failed", tone: "red", final: true },
  CANCELLED: { label: "Cancelled", tone: "zinc", final: true },
  EXITED: { label: "Exited", tone: "zinc", final: true },
} as const;
export type ExecutionStatusKey = keyof typeof EXECUTION_STATUSES;
export const ACTIVE_EXECUTION_STATUSES: ExecutionStatusKey[] = ["QUEUED", "RUNNING", "WAITING", "PAUSED"];

export const EXECUTION_OUTCOMES = {
  COMPLETED: "Finished every step",
  GOAL_REACHED: "Goal reached",
  EXITED: "Exited",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
} as const;
export type ExecutionOutcome = keyof typeof EXECUTION_OUTCOMES;

export const STEP_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "SKIPPED", "WAITING", "SIMULATED"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const NODE_TYPES = {
  CONDITION: { label: "If / else", description: "Checks conditions and follows the Yes or No path." },
  BRANCH: { label: "Branch", description: "Follows the first branch whose conditions match, or the default path." },
  ACTION: { label: "Action", description: "Does something: update a record, create a task, send a message…" },
  WAIT: { label: "Wait", description: "Pauses the execution for a time, until a time of day, or until a date on the record." },
  GOAL: { label: "Goal", description: "If its conditions match, the execution finishes as 'goal reached'; otherwise it continues." },
  EXIT: { label: "Exit", description: "Ends the execution here." },
} as const;
export type NodeType = keyof typeof NODE_TYPES;
export const NODE_TYPE_KEYS = Object.keys(NODE_TYPES) as NodeType[];

export const WAIT_UNITS = { MINUTES: 60_000, HOURS: 3_600_000, DAYS: 86_400_000 } as const;
export type WaitUnit = keyof typeof WAIT_UNITS;

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Can the same record enter the workflow again?
 *  ONCE          — never twice (any earlier execution blocks a new one).
 *  AFTER_FINISH  — again once its previous execution finished (default).
 *  ALWAYS        — every trigger starts a new execution (parallel runs allowed).
 */
export const REENTRY_MODES = {
  ONCE: "Only once per record",
  AFTER_FINISH: "Again after the previous run finished",
  ALWAYS: "Every time (runs can overlap)",
} as const;
export type ReentryMode = keyof typeof REENTRY_MODES;

export const WORKFLOW_LIMITS = {
  /** Nodes in one graph. */
  maxNodes: 100,
  /** Conditions (leaves) in one condition group, and nesting depth. */
  maxConditions: 50,
  maxConditionDepth: 4,
  /** Steps one execution may take in total — a backstop; graphs are acyclic. */
  maxStepsPerExecution: 300,
  /** Steps run in one scheduler pass before yielding to other executions. */
  maxStepsPerRun: 50,
  /** Executions started by actions of other executions: chains deeper than this are stopped (recursion protection). */
  maxDepth: 3,
  /** Longest single wait. */
  maxWaitDays: 365,
  /** Automatic retries of a failed retryable action (after the first attempt). */
  maxRetries: 3,
  /** Retry back-off, by retry number. */
  retryDelaysMs: [60_000, 5 * 60_000, 30 * 60_000] as readonly number[],
  /** A RUNNING execution whose lock is older than this is treated as interrupted. */
  staleLockMs: 10 * 60_000,
  /** Executions one workflow may start per record per hour (loop / storm protection). */
  maxStartsPerRecordPerHour: 20,
  /** Events the dispatcher evaluates per pass. */
  dispatchBatch: 200,
  /** How far back the dispatcher re-reads unprocessed events (late commits, a worker that was down). */
  dispatchLookbackMs: 24 * 3_600_000,
} as const;

/** Prefix of crm_events.correlation_id for events written by workflow actions. */
export const WORKFLOW_CORRELATION_PREFIX = "wfexec:";

export function isFinalExecutionStatus(status: string): boolean {
  return status in EXECUTION_STATUSES && EXECUTION_STATUSES[status as ExecutionStatusKey].final;
}
