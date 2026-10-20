import { z } from "zod";

/** Hard ceiling for any action, regardless of its own maxItems. */
export const BULK_ABSOLUTE_MAX_ITEMS = 20_000;

const uuid = z.string().uuid();

export const bulkSelectionSchema = z.discriminatedUnion("mode", [
  // Rows the user ticked / the rows of the page they are on.
  z.object({ mode: z.literal("IDS"), ids: z.array(uuid).min(1).max(BULK_ABSOLUTE_MAX_ITEMS) }).strict(),
  z.object({ mode: z.literal("PAGE"), ids: z.array(uuid).min(1).max(500) }).strict(),
  // Every record matching the list's current filters: the list API's own query string.
  z.object({ mode: z.literal("FILTER"), filterQuery: z.string().max(4000) }).strict(),
]);
export type BulkSelectionInput = z.infer<typeof bulkSelectionSchema>;

const key = z.string().trim().min(1).max(80);

export const bulkPreviewSchema = z
  .object({
    entityType: key,
    actionKey: key,
    selection: bulkSelectionSchema,
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const createBulkJobSchema = bulkPreviewSchema
  .extend({
    /** The same request sent twice (double click, network retry) creates one job. */
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
    /** For actions that ask the user to type the number of records. */
    confirmCount: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateBulkJobInput = z.infer<typeof createBulkJobSchema>;

export const retryBulkJobSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(100).optional() }).strict();

export const BULK_JOB_STATUSES = {
  QUEUED: { label: "Queued", tone: "neutral" },
  VALIDATING: { label: "Validating", tone: "info" },
  RUNNING: { label: "Running", tone: "info" },
  CANCEL_REQUESTED: { label: "Cancelling", tone: "warning" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "success" },
  COMPLETED_WITH_ERRORS: { label: "Completed with errors", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
} as const;

export const BULK_ITEM_STATUSES = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  CANCELLED: "Not processed",
} as const;

export const bulkJobFilterSchema = z
  .object({
    statuses: z.array(z.enum(Object.keys(BULK_JOB_STATUSES) as [keyof typeof BULK_JOB_STATUSES, ...(keyof typeof BULK_JOB_STATUSES)[]])).max(8).optional(),
    entityType: z.string().max(40).optional(),
    mine: z.boolean().optional(),
  })
  .strict();
export type BulkJobFilters = z.infer<typeof bulkJobFilterSchema>;

export function parseBulkJobFilters(sp: URLSearchParams): BulkJobFilters {
  const statuses = sp.get("statuses")?.split(",").map((s) => s.trim()).filter(Boolean);
  return bulkJobFilterSchema.parse({
    statuses: statuses?.length ? statuses : undefined,
    entityType: sp.get("entityType")?.trim() || undefined,
    mine: sp.get("mine") === "true" ? true : undefined,
  });
}

export const bulkItemFilterSchema = z.object({ statuses: z.array(z.enum(["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"])).max(6).optional() }).strict();

export function parseBulkItemFilters(sp: URLSearchParams) {
  const statuses = sp.get("statuses")?.split(",").map((s) => s.trim()).filter(Boolean);
  return bulkItemFilterSchema.parse({ statuses: statuses?.length ? statuses : undefined });
}
