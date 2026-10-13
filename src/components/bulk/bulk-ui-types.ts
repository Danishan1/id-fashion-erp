/** Phase 14 — client-side shapes of the bulk engine API (see src/modules/bulk-actions). */

export const BULK_JOBS_API = "/api/v1/bulk-jobs";
export const BULK_CAPABILITIES_API = "/api/v1/bulk-actions/capabilities";
export const BULK_PREVIEW_API = "/api/v1/bulk-actions/preview";
export const BULK_JOBS_PAGE = "/crm/bulk-jobs";

export type BulkParamFieldDto =
  | { key: string; label: string; type: "user"; required?: boolean; allowNone?: boolean; noneLabel?: string; help?: string; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "select"; required?: boolean; help?: string; placeholder?: string; options: { value: string; label: string; group?: string }[] }
  | { key: string; label: string; type: "tags"; help?: string; allowNew?: boolean; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "number"; min?: number; max?: number; help?: string }
  | { key: string; label: string; type: "date"; help?: string }
  | { key: string; label: string; type: "text"; maxLength?: number; help?: string; multiline?: boolean };

export interface BulkActionCapabilityDto {
  key: string;
  kind: string;
  label: string;
  description: string;
  available: boolean;
  unavailableReason: string | null;
  destructive: boolean;
  confirmation: "none" | "confirm" | "type_count";
  cancellable: boolean;
  retrySafe: boolean;
  maxItems: number;
  fields: BulkParamFieldDto[];
}

export interface BulkCapabilitiesDto {
  entity: { entityType: string; label: string; pluralLabel: string };
  actions: BulkActionCapabilityDto[];
}

export interface BulkPreviewDto {
  count: number;
  requested: number;
  maxItems: number;
  actionLabel: string;
  summary: string;
  warnings: string[];
  destructive: boolean;
  confirmation: "none" | "confirm" | "type_count";
  sample: string[];
}

export type BulkJobStatusKey = "QUEUED" | "VALIDATING" | "RUNNING" | "CANCEL_REQUESTED" | "CANCELLED" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED";

export interface BulkJobDto {
  id: string;
  entityType: string;
  entityLabel: string;
  listHref: string | null;
  actionKey: string;
  actionLabel: string;
  kind: string | null;
  status: BulkJobStatusKey;
  statusLabel: string;
  statusTone: "neutral" | "info" | "warning" | "success" | "danger";
  selectionMode: string;
  summary: string | null;
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  progress: number;
  error: { code: string | null; message: string | null } | null;
  requestedBy: { id: string; name: string | null };
  isMine: boolean;
  retryOfJobId: string | null;
  canCancel: boolean;
  canRetry: boolean;
  download: { fileName: string; mimeType: string; sizeBytes: number; rowCount: number; expiresAt: string; expired: boolean; available: boolean } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  cancelRequestedAt: string | null;
  updatedAt: string;
  queued?: boolean;
  duplicate?: boolean;
  warnings?: string[];
}

export interface BulkJobDetailDto extends BulkJobDto {
  selection: { filterQuery: string } | null;
  retries: { id: string; status: BulkJobStatusKey; statusLabel: string; createdAt: string }[];
  itemCounts: Partial<Record<"PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELLED", number>>;
  action: { destructive: boolean; retrySafe: boolean; description: string } | null;
}

export interface BulkJobItemDto {
  id: string;
  sequence: number;
  entityId: string;
  label: string;
  href: string | null;
  status: string;
  statusLabel: string;
  message: string | null;
  errorCode: string | null;
  attempts: number;
  processedAt: string | null;
}

export const TONE_TO_BADGE = { neutral: "neutral", info: "indigo", warning: "amber", success: "green", danger: "red" } as const;

export const ACTIVE_STATUSES: BulkJobStatusKey[] = ["QUEUED", "VALIDATING", "RUNNING", "CANCEL_REQUESTED"];
