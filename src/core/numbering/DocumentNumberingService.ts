import { prisma } from "@/core/db/client";
import type { DocumentType } from "@prisma/client";

const PREFIX_BY_DOCUMENT_TYPE: Record<DocumentType, string> = {
  SAMPLE_REQUEST: "SAM",
  BUYER_ENQUIRY: "ENQ",
  SALES_ORDER: "ORD",
  PRODUCTION_ORDER: "PROD",
  SALES_INVOICE: "INV",
  PURCHASE_INVOICE: "PINV",
  PURCHASE_ORDER: "PO",
  MATERIAL_REQUEST: "MR",
  GOODS_RECEIPT: "REC",
  DISPATCH: "DSP",
  PAYMENT: "PAY",
  EXPENSE: "EXP",
  STOCK_MOVEMENT: "STK",
  JOURNAL: "JRN",
  CUSTOMER: "CUST",
  SUPPLIER: "SUP",
  EMPLOYEE: "EMP",
  STYLE: "ST",
  MATERIAL: "MAT",
  CONTRACTOR: "CONTR",
  JOB_WORK_ORDER: "JWO",
  JOB_WORK_RECEIPT: "JWR",
  CUSTOM_INVOICE_CREDIT_NOTE: "CN",
  INTERNAL_TRANSFER: "TRF",
  EMPLOYEE_ADVANCE: "ADV",
  EMPLOYEE_ADVANCE_SETTLEMENT: "ADVS",
  AI_GARMENT_PROJECT: "AGF",
  AI_DESIGNER_PROJECT: "AID",
  REPLICATE_DESIGN_PROJECT: "RPD",
  FABRIC_ROLL: "FR",
  SKU: "SKU",
  CRM_LEAD: "LEAD",
  CRM_OPPORTUNITY: "OPP",
  CAMPAIGN: "CAMP",
  FORWARDER: "FWD",
};

/** DocumentTypes that represent master-data codes, not transactional documents. */
export const MASTER_CODE_DOCUMENT_TYPES = ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "STYLE", "MATERIAL", "CONTRACTOR", "FABRIC_ROLL", "SKU", "FORWARDER"] as const;
export type MasterCodeDocumentType = (typeof MASTER_CODE_DOCUMENT_TYPES)[number];

// Master codes never reset per fiscal year (unlike invoices/orders) — every
// row for these document types is stored under this fixed sentinel year so
// the counter just keeps counting up, company-wide, indefinitely.
const MASTER_CODE_YEAR = 0;

function formatMasterCode(documentType: MasterCodeDocumentType, n: number): string {
  return `${PREFIX_BY_DOCUMENT_TYPE[documentType]}-${String(n).padStart(5, "0")}`;
}

/**
 * Read-only preview of the next master code (e.g. "CUST-00006") — safe to call
 * repeatedly (form loads, retries) since it never writes to document_sequences.
 * The Code field it fills stays a normal editable input (external numbering).
 */
export async function previewNextMasterCode(companyId: string, documentType: MasterCodeDocumentType): Promise<string> {
  const existing = await prisma.documentSequence.findFirst({
    where: { companyId, branchId: null, documentType, fiscalYear: MASTER_CODE_YEAR },
  });
  const next = (existing ? Number(existing.currentNumber) : 0) + 1;
  return formatMasterCode(documentType, next);
}

/**
 * Atomically advances the master-code counter by one. Call once per successful
 * create, regardless of whether the caller kept the previewed code or typed
 * their own — this just keeps future previews moving forward.
 */
export async function advanceMasterCodeSequence(companyId: string, documentType: MasterCodeDocumentType): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.documentSequence.findFirst({
      where: { companyId, branchId: null, documentType, fiscalYear: MASTER_CODE_YEAR },
    });

    if (existing) {
      await tx.documentSequence.update({ where: { id: existing.id }, data: { currentNumber: { increment: 1 } } });
      return;
    }

    await tx.documentSequence.create({
      data: {
        companyId,
        branchId: null,
        documentType,
        prefix: PREFIX_BY_DOCUMENT_TYPE[documentType],
        fiscalYear: MASTER_CODE_YEAR,
        currentNumber: 1,
      },
    });
  });
}

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
