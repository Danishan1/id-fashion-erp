import { prisma } from "@/core/db/client";
import type { DocumentType } from "@prisma/client";

const PREFIX_BY_DOCUMENT_TYPE: Record<DocumentType, string> = {
  SAMPLE_REQUEST: "SAM",
  SALES_ORDER: "ORD",
  PRODUCTION_ORDER: "PROD",
  SALES_INVOICE: "INV",
  PURCHASE_INVOICE: "PINV",
  PURCHASE_ORDER: "PO",
  PURCHASE_REQUEST: "PR",
  GOODS_RECEIPT: "REC",
  DISPATCH: "DSP",
  PAYMENT: "PAY",
  EXPENSE: "EXP",
  STOCK_MOVEMENT: "STK",
  JOURNAL: "JRN",
};

interface GenerateOptions {
  companyId: string;
  branchId?: string | null;
  documentType: DocumentType;
  /** Defaults to the current calendar year. */
  fiscalYear?: number;
}

/**
 * Generates unique, gapless document numbers (e.g. SAM-2026-00001) via an
 * atomic UPDATE...RETURNING on document_sequences — never SELECT MAX()+1,
 * which races under concurrent inserts.
 */
export async function generateDocumentNumber({
  companyId,
  branchId = null,
  documentType,
  fiscalYear,
}: GenerateOptions): Promise<string> {
  const year = fiscalYear ?? new Date().getFullYear();
  const prefix = PREFIX_BY_DOCUMENT_TYPE[documentType];

  const sequence = await prisma.$transaction(async (tx) => {
    // findFirst (not findUnique) because Prisma's compound-unique lookup type
    // requires branchId to be non-null even though the column is nullable —
    // the @@unique constraint in the schema still guarantees correctness.
    const existing = await tx.documentSequence.findFirst({
      where: { companyId, branchId, documentType, fiscalYear: year },
    });

    if (existing) {
      return tx.documentSequence.update({
        where: { id: existing.id },
        data: { currentNumber: { increment: 1 } },
      });
    }

    return tx.documentSequence.create({
      data: {
        companyId,
        branchId,
        documentType,
        prefix,
        fiscalYear: year,
        currentNumber: 1,
      },
    });
  });

  const padded = sequence.currentNumber.toString().padStart(sequence.paddingLength, "0");
  return `${sequence.prefix}-${year}-${padded}`;
}
