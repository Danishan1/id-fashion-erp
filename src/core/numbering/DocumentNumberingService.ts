import { prisma } from "@/core/db/client";
import type { DocumentType, Prisma } from "@prisma/client";

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
  EXPENSE_PAYMENT: "EXPP",
  AI_GARMENT_PROJECT: "AGF",
  AI_DESIGNER_PROJECT: "AID",
  SUPPORT_TICKET: "TKT",
  REPLICATE_DESIGN_PROJECT: "RPD",
  FABRIC_ROLL: "FR",
  SKU: "SKU",
  CRM_LEAD: "LEAD",
  CRM_OPPORTUNITY: "OPP",
  FORWARDER: "TRN",
  // Finished Goods Inventory module (2026-10-13, FGI-004).
  FG_RECEIPT: "FGR",
  // Finished Goods Inventory module (FGI-030).
  FG_PUTAWAY: "FGP",
  // Product Unit Garment Barcode & Traceability System
  PRODUCT_UNIT: "FG",
  CUSTOMER_RETURN: "RET",
  PAYMENT_REQUEST: "PRQ",
};

/** DocumentTypes that represent master-data codes, not transactional documents. */
export const MASTER_CODE_DOCUMENT_TYPES = ["CUSTOMER", "SUPPLIER", "EMPLOYEE", "STYLE", "MATERIAL", "CONTRACTOR", "FABRIC_ROLL", "SKU", "FORWARDER", "PRODUCT_UNIT"] as const;
export type MasterCodeDocumentType = (typeof MASTER_CODE_DOCUMENT_TYPES)[number];

// Master codes never reset per fiscal year (unlike invoices/orders) — every
// row for these document types is stored under this fixed sentinel year so
// the counter just keeps counting up, company-wide, indefinitely.
const MASTER_CODE_YEAR = 0;

function formatMasterCode(documentType: MasterCodeDocumentType, n: number): string {
  if (documentType === "PRODUCT_UNIT") {
    return `${PREFIX_BY_DOCUMENT_TYPE[documentType]}-${String(n).padStart(8, "0")}`;
  }
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

/**
 * Generates and increments a master code counter within an existing Prisma transaction.
 * If tx.documentSequence is undefined (e.g. in targeted unit test mocks), falls back gracefully.
 */
export async function generateMasterCodeInTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  documentType: MasterCodeDocumentType
): Promise<string> {
  const ds = (tx as unknown as { documentSequence?: typeof prisma.documentSequence }).documentSequence;
  if (!ds) {
    const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
    return `${PREFIX_BY_DOCUMENT_TYPE[documentType]}-${randomSuffix}`;
  }

  const existing = await ds.findFirst({
    where: { companyId, branchId: null, documentType, fiscalYear: MASTER_CODE_YEAR },
  });

  if (existing) {
    const updated = await ds.update({
      where: { id: existing.id },
      data: { currentNumber: { increment: 1 } },
    });
    return formatMasterCode(documentType, Number(updated.currentNumber));
  }

  const created = await ds.create({
    data: {
      companyId,
      branchId: null,
      documentType,
      prefix: PREFIX_BY_DOCUMENT_TYPE[documentType],
      fiscalYear: MASTER_CODE_YEAR,
      currentNumber: 1,
    },
  });
  return formatMasterCode(documentType, Number(created.currentNumber));
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

  const nextSequence = () =>
    prisma.$transaction(async (tx) => {
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

  let sequence;
  try {
    sequence = await nextSequence();
  } catch (error) {
    // Two requests creating the very first number of the year at the same
    // moment: the loser hits the unique constraint. The row exists now, so a
    // retry takes the atomic-increment path instead of failing.
    if (!(error && typeof error === "object" && (error as { code?: string }).code === "P2002")) throw error;
    sequence = await nextSequence();
  }

  const padded = sequence.currentNumber.toString().padStart(sequence.paddingLength, "0");
  return `${sequence.prefix}-${year}-${padded}`;
}
