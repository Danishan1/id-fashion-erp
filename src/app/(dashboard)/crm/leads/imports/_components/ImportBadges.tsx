import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import type { ImportRowDto, ImportStatus, RowOutcome } from "./import-types";

const STATUS: Record<ImportStatus, { label: string; tone: CrmBadgeTone }> = {
  PENDING: { label: "Mapping", tone: "neutral" },
  VALIDATING: { label: "Checking", tone: "indigo" },
  READY: { label: "Checked", tone: "indigo" },

  PROCESSING: { label: "Importing", tone: "indigo" },
  COMPLETED: { label: "Completed", tone: "green" },
  PARTIALLY_COMPLETED: { label: "Completed with errors", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};
export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  return <CrmBadge label={STATUS[status].label} tone={STATUS[status].tone} />;
}

const OUTCOME: Record<RowOutcome, { label: string; tone: CrmBadgeTone }> = {
  PENDING: { label: "Waiting", tone: "neutral" },
  IMPORTED: { label: "Imported", tone: "green" },
  UPDATED: { label: "Updated", tone: "indigo" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  FLAGGED: { label: "Flagged", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
};
export function RowStatusBadge({ row }: { row: Pick<ImportRowDto, "outcome" | "validation"> }) {
  if (row.outcome !== "PENDING") return <CrmBadge label={OUTCOME[row.outcome].label} tone={OUTCOME[row.outcome].tone} />;
  if (row.validation === "ERROR") return <CrmBadge label="Error" tone="red" />;
  if (row.validation === "WARNING") return <CrmBadge label="Warning" tone="amber" />;
  if (row.validation === "VALID") return <CrmBadge label="Valid" tone="green" />;
  return <CrmBadge label="Not checked" tone="neutral" />;
}
