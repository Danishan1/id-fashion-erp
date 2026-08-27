import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import type { InvoiceSeriesInput } from "./invoice-series.schema";
import { InvoiceSeriesRepository } from "./invoice-series.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listInvoiceSeries(companyId: string) {
  return InvoiceSeriesRepository.findMany(companyId);
}

export async function createInvoiceSeries(actor: ActorContext, input: InvoiceSeriesInput) {
  try {
    const series = await InvoiceSeriesRepository.create({
      companyId: actor.companyId,
      name: input.name,
      prefix: input.prefix,
      fiscalYearLabel: input.fiscalYearLabel,
      isActive: input.isActive,
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "invoice_series",
      recordId: series.id,
      action: "CREATE",
      newValues: series,
    });

    return series;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "name")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `An invoice series named "${input.name}" already exists.`);
    }
    if (isUniqueConstraintViolationOnColumn(error, "prefix")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `An invoice series with prefix "${input.prefix}" already exists.`);
    }
    throw error;
  }
}

export async function updateInvoiceSeries(actor: ActorContext, id: string, input: InvoiceSeriesInput) {
  const existing = await InvoiceSeriesRepository.findById(id, actor.companyId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Invoice series not found.", { id });

  try {
    const updated = await InvoiceSeriesRepository.update(id, {
      name: input.name,
      prefix: input.prefix,
      fiscalYearLabel: input.fiscalYearLabel,
      isActive: input.isActive,
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "invoice_series",
      recordId: id,
      action: "UPDATE",
      oldValues: existing,
      newValues: updated,
    });

    return updated;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "name")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `An invoice series named "${input.name}" already exists.`);
    }
    if (isUniqueConstraintViolationOnColumn(error, "prefix")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `An invoice series with prefix "${input.prefix}" already exists.`);
    }
    throw error;
  }
}

// Pure read — never mutates nextNumber. The suggested number is always
// re-editable on the create form (matches the reference tool's own "Edit"
// button); the series counter only actually advances inside
// createCustomInvoice's own transaction, at real creation time.
export async function previewNextInvoiceNumber(companyId: string, seriesId: string) {
  const series = await InvoiceSeriesRepository.findById(seriesId, companyId);
  if (!series) throw new BusinessRuleError("NOT_FOUND", "Invoice series not found.", { seriesId });
  return { invoiceNumber: `${series.prefix}/${series.fiscalYearLabel}/${series.nextNumber}` };
}
