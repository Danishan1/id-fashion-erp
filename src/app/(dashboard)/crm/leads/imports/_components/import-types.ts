import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";

export type ImportStatus = "PENDING" | "VALIDATING" | "READY" | "PROCESSING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED" | "CANCELLED";
export type DuplicatePolicy = "SKIP" | "UPDATE" | "CREATE" | "FLAG_FOR_REVIEW";
export type RowOutcome = "PENDING" | "IMPORTED" | "UPDATED" | "SKIPPED" | "FLAGGED" | "FAILED";

export interface ImportJobDto {
  id: string;
  fileName: string;
  fileType: "CSV" | "XLSX";
  fileSizeBytes: number;
  status: ImportStatus;
  sourceId: string | null;
  duplicatePolicy: DuplicatePolicy;
  headers: string[];
  mapping: Record<string, string>;
  options: { defaultOwnerUserId?: string | null; tagNames?: string[]; dateOrder?: "DMY" | "MDY"; fixNameCase?: boolean; emptyTokens?: string[]; encoding?: string | null; delimiter?: string | null };
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  processedRows: number;
  importedRows: number;
  updatedRows: number;
  skippedRows: number;
  flaggedRows: number;
  failedRows: number;
  percent: number;
  errorSummary: string | null;
  validatedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  source: { id: string; name: string } | null;
  createdBy: { id: string; fullName: string };
}

export interface ImportJobDetailDto extends ImportJobDto {
  customFields: CrmCustomFieldDefinitionDto[];
  sample: Record<string, string>[];
  mappingIssues: { level: "error" | "warning"; message: string }[];
}

export interface ImportRowDto {
  id: string;
  rowNumber: number;
  raw: Record<string, string>;
  mapped: Record<string, unknown> | null;
  externalId: string | null;
  validation: "PENDING" | "VALID" | "WARNING" | "ERROR";
  messages: { level: "error" | "warning" | "info"; field?: string; message: string }[];
  duplicates: {
    leads: { id: string; leadNumber: string; fullName: string; rules: string[]; archived: boolean }[];
    contacts: { id: string; fullName: string }[];
    external: { leadId: string; leadNumber: string } | null;
  } | null;
  inFileDuplicateOf: number | null;
  outcome: RowOutcome;
  outcomeReason: string | null;
  lead: { id: string; leadNumber: string; fullName: string } | null;
  reviewedAt: string | null;
}

export const ACTIVE_STATUSES: ImportStatus[] = ["VALIDATING", "PROCESSING"];
export const FINISHED_STATUSES: ImportStatus[] = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"];

export const POLICY_INFO: Record<DuplicatePolicy, { label: string; help: string }> = {
  SKIP: { label: "Skip duplicates", help: "Rows that match an existing lead are not imported. Each skipped row is listed with the lead it matched." },
  UPDATE: { label: "Update existing leads", help: "Fill in only the empty fields of the matching lead. Nothing already entered is overwritten, source attribution is kept, and a different requirement is added as a note." },
  CREATE: { label: "Create anyway", help: "Create a new lead even when a possible duplicate exists (duplicate rules set to Block still prevent it)." },
  FLAG_FOR_REVIEW: { label: "Flag for review", help: "Don't create or update matching rows — hold them so you can decide row by row after the import." },
};
